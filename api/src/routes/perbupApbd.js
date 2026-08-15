import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

async function tahunId(c) {
  const tahun = c.req.query('tahun')
  if (!tahun) return null
  const [rows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  return rows.length ? rows[0].id : null
}

// Kolom JSON dikembalikan mysql2 sudah ter-parse, tapi bisa juga berupa string
// tergantung versi server. Ditangani dua-duanya supaya aman.
const parse = (nilai, bawaan) => {
  if (nilai === null || nilai === undefined) return bawaan
  if (typeof nilai === 'string') {
    try { return JSON.parse(nilai) } catch { return bawaan }
  }
  return nilai
}

/** Seluruh state satu tahun: pengaturan + dokumen dasar + rantai pergeseran. */
router.get('/', async (c) => {
  const id = await tahunId(c)
  if (!id) return c.json({ pengaturan: null, dasar: null, arsip: [] })

  const [dok] = await db.query(
    `SELECT urutan, nama_file, kolom_nilai, baris, registry, updated_at
     FROM perbup_dokumen WHERE tahun_id = ? ORDER BY urutan`,
    [id]
  )
  const [set] = await db.query(
    'SELECT pasal_mulai, nomor_klausul, meta, template_akun FROM perbup_pengaturan WHERE tahun_id = ?',
    [id]
  )

  const dasarRow = dok.find(d => d.urutan === 0) || null
  const dasar = dasarRow
    ? {
        nama: dasarRow.nama_file,
        kolomNilai: dasarRow.kolom_nilai,
        rows: parse(dasarRow.baris, []),
        reg: parse(dasarRow.registry, {}),
        updatedAt: dasarRow.updated_at
      }
    : null

  const arsip = dok
    .filter(d => d.urutan > 0)
    .map(d => ({
      urutan: d.urutan,
      nama: d.nama_file,
      kolomNilai: d.kolom_nilai,
      rows: parse(d.baris, []),
      updatedAt: d.updated_at
    }))

  const pengaturan = set.length
    ? {
        pasalMulai: set[0].pasal_mulai,
        nomorKlausul: !!set[0].nomor_klausul,
        meta: parse(set[0].meta, null),
        templateAkun: parse(set[0].template_akun, null)
      }
    : null

  return c.json({ pengaturan, dasar, arsip })
})

router.put('/pengaturan', async (c) => {
  const id = await tahunId(c)
  if (!id) return c.json({ error: 'Tahun anggaran tidak ditemukan' }, 404)

  const body = await c.req.json()
  await db.query(
    `INSERT INTO perbup_pengaturan (tahun_id, pasal_mulai, nomor_klausul, meta, template_akun)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       pasal_mulai = VALUES(pasal_mulai),
       nomor_klausul = VALUES(nomor_klausul),
       meta = VALUES(meta),
       template_akun = VALUES(template_akun)`,
    [
      id,
      Number(body.pasalMulai) || 3,
      body.nomorKlausul ? 1 : 0,
      JSON.stringify(body.meta ?? null),
      JSON.stringify(body.templateAkun ?? null)
    ]
  )
  return c.json({ success: true })
})

/**
 * Simpan dokumen dasar. Registry dikirim dari klien apa adanya — kalau berisi
 * nomor pasal yang sudah terbit, nomor itulah yang dipakai. Seluruh rantai
 * pergeseran dihapus karena dokumen dasar baru berarti penomoran dimulai ulang
 * (yang terjadi saat Perbup Penjabaran Perubahan APBD).
 */
router.put('/dasar', async (c) => {
  const id = await tahunId(c)
  if (!id) return c.json({ error: 'Tahun anggaran tidak ditemukan' }, 404)

  const body = await c.req.json()
  if (!Array.isArray(body.rows) || !body.rows.length) {
    return c.json({ error: 'Baris rekening kosong' }, 400)
  }

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    if (body.hapusRantai !== false) {
      await conn.query('DELETE FROM perbup_dokumen WHERE tahun_id = ? AND urutan > 0', [id])
    }
    await conn.query(
      `INSERT INTO perbup_dokumen (tahun_id, urutan, nama_file, kolom_nilai, baris, registry)
       VALUES (?, 0, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         nama_file = VALUES(nama_file),
         kolom_nilai = VALUES(kolom_nilai),
         baris = VALUES(baris),
         registry = VALUES(registry)`,
      [
        id,
        body.nama || 'dokumen-dasar',
        body.kolomNilai || 'jumlah',
        JSON.stringify(body.rows),
        JSON.stringify(body.reg || {})
      ]
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }

  return c.json({ success: true })
})

/** Tambah satu pergeseran di ujung rantai. */
router.post('/pergeseran', async (c) => {
  const id = await tahunId(c)
  if (!id) return c.json({ error: 'Tahun anggaran tidak ditemukan' }, 404)

  const body = await c.req.json()
  if (!Array.isArray(body.rows) || !body.rows.length) {
    return c.json({ error: 'Baris rekening kosong' }, 400)
  }

  const [dasar] = await db.query(
    'SELECT id FROM perbup_dokumen WHERE tahun_id = ? AND urutan = 0',
    [id]
  )
  if (!dasar.length) return c.json({ error: 'Dokumen dasar belum ada' }, 400)

  const [max] = await db.query(
    'SELECT COALESCE(MAX(urutan), 0) AS n FROM perbup_dokumen WHERE tahun_id = ?',
    [id]
  )
  const urutan = Number(max[0].n) + 1

  await db.query(
    `INSERT INTO perbup_dokumen (tahun_id, urutan, nama_file, kolom_nilai, baris)
     VALUES (?, ?, ?, ?, ?)`,
    [id, urutan, body.nama || `P${urutan}`, body.kolomNilai || 'setelah_perubahan', JSON.stringify(body.rows)]
  )

  return c.json({ success: true, urutan })
})

/** Hapus satu pergeseran beserta seluruh pergeseran sesudahnya. */
router.delete('/pergeseran/:urutan', async (c) => {
  const id = await tahunId(c)
  if (!id) return c.json({ error: 'Tahun anggaran tidak ditemukan' }, 404)

  const urutan = Number(c.req.param('urutan'))
  if (!Number.isInteger(urutan) || urutan < 1) {
    return c.json({ error: 'Urutan tidak valid' }, 400)
  }

  await db.query(
    'DELETE FROM perbup_dokumen WHERE tahun_id = ? AND urutan >= ?',
    [id, urutan]
  )
  return c.json({ success: true })
})

/** Reset total: dokumen dasar, rantai, dan pengaturan tahun itu. */
router.delete('/', async (c) => {
  const id = await tahunId(c)
  if (!id) return c.json({ error: 'Tahun anggaran tidak ditemukan' }, 404)

  await db.query('DELETE FROM perbup_dokumen WHERE tahun_id = ?', [id])
  await db.query('DELETE FROM perbup_pengaturan WHERE tahun_id = ?', [id])
  return c.json({ success: true })
})

export default router
