import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

const KATEGORI_SAH = ['gaji', 'tpp', 'pppk_pw']

async function tahunId(tahun) {
  if (!tahun) return null
  const [rows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  return rows[0]?.id ?? null
}

// Rancangan pagu BPKAD (Gaji/TPP/PPPK Paruh Waktu), dipakai tab "Cek Rancangan
// Pagu" sebagai pembanding TETAP — disimpan supaya tidak perlu diunggah ulang
// tiap buka halaman. Satu upload menimpa seluruh rancangan kategori itu.

router.get('/', async (c) => {
  const kategori = c.req.query('kategori')
  const id = await tahunId(c.req.query('tahun'))
  if (!id || !KATEGORI_SAH.includes(kategori)) return c.json({ data: null })

  const [rows] = await db.query(
    `SELECT kode_skpd, nama_skpd, kode_rekening, nama_rekening, pagu, nama_berkas, uploaded_at
     FROM rancangan_pagu WHERE tahun_id = ? AND kategori = ?
     ORDER BY kode_skpd, kode_rekening`,
    [id, kategori]
  )
  if (!rows.length) return c.json({ data: null })

  return c.json({
    data: {
      namaBerkas: rows[0].nama_berkas,
      uploadedAt: rows[0].uploaded_at,
      baris: rows.map(r => ({
        kodeSkpd: r.kode_skpd, namaSkpd: r.nama_skpd,
        kodeRekening: r.kode_rekening, namaRekening: r.nama_rekening,
        pagu: Number(r.pagu) || 0,
      })),
    },
  })
})

router.post('/', async (c) => {
  const { tahun, kategori, namaBerkas, data } = await c.req.json()
  if (!KATEGORI_SAH.includes(kategori)) {
    return c.json({ error: 'kategori harus gaji, tpp, atau pppk_pw' }, 400)
  }
  if (!Array.isArray(data) || !data.length) {
    return c.json({ error: 'data tidak boleh kosong' }, 400)
  }

  const id = await tahunId(tahun)
  if (!id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const rows = []
  for (const row of data) {
    const kodeSkpd = String(row.kodeSkpd ?? '').trim()
    const kodeRekening = String(row.kodeRekening ?? '').trim()
    if (!kodeSkpd || !kodeRekening) continue
    rows.push([
      id, kategori, kodeSkpd,
      String(row.namaSkpd ?? '').trim() || null,
      kodeRekening,
      String(row.namaRekening ?? '').trim() || null,
      Number(row.pagu) || 0,
      String(namaBerkas ?? '').trim() || null,
    ])
  }
  if (!rows.length) return c.json({ error: 'Tidak ada baris dengan Kode SKPD dan kode rekening yang sah' }, 400)

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM rancangan_pagu WHERE tahun_id = ? AND kategori = ?', [id, kategori])

    const BATCH = 500
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      const placeholders = chunk.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
      await conn.query(
        `INSERT INTO rancangan_pagu
           (id, tahun_id, kategori, kode_skpd, nama_skpd, kode_rekening, nama_rekening, pagu, nama_berkas)
         VALUES ${placeholders}`,
        chunk.flat()
      )
    }

    await conn.commit()
    return c.json({ success: true, count: rows.length, dinas: new Set(rows.map(r => r[2])).size })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
})

router.delete('/', async (c) => {
  const kategori = c.req.query('kategori')
  const id = await tahunId(c.req.query('tahun'))
  if (!id || !KATEGORI_SAH.includes(kategori)) return c.json({ error: 'tahun/kategori diperlukan' }, 400)

  const [hasil] = await db.query(
    'DELETE FROM rancangan_pagu WHERE tahun_id = ? AND kategori = ?', [id, kategori]
  )
  return c.json({ success: true, count: hasil.affectedRows })
})

export default router
