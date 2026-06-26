import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

const FIELD_MAP = {
  'NO':                 'no',
  'KODE SKPD':          'kode_skpd',
  'NAMA SKPD':          'nama_skpd',
  'KODE SUB UNIT':      'kode_sub_unit',
  'NAMA SUB UNIT':      'nama_sub_unit',
  'KODE BIDANG URUSAN': 'kode_bidang_urusan',
  'NAMA BIDANG URUSAN': 'nama_bidang_urusan',
  'KODE PROGRAM':       'kode_program',
  'NAMA PROGRAM':       'nama_program',
  'KODE KEGIATAN':      'kode_kegiatan',
  'NAMA KEGIATAN':      'nama_kegiatan',
  'KODE SUB KEGIATAN':  'kode_sub_kegiatan',
  'NAMA SUB KEGIATAN':  'nama_sub_kegiatan',
  'KODE REKENING':      'kode_rekening',
  'NAMA REKENING':      'nama_rekening',
  'PAGU':               'pagu',
  'REALISASI':          'realisasi',
  'AKUN':               'akun',
  'KELOMPOK':           'kelompok',
  'JENIS':              'jenis',
  'OBJEK':              'objek',
  'RINCIAN OBJEK':      'rincian_objek',
  'SUB RINCIAN OBJEK':  'sub_rincian_objek',
}

// Reverse map: snake_case kolom DB → key JSON asli (uppercase dengan spasi)
const REVERSE_MAP = Object.fromEntries(
  Object.entries(FIELD_MAP).map(([jsonKey, col]) => [col, jsonKey])
)

function toJsonFormat(row) {
  return Object.fromEntries(
    Object.entries(row).map(([col, val]) => [REVERSE_MAP[col] ?? col, val])
  )
}

router.get('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT r.no, r.kode_skpd, r.nama_skpd, r.kode_sub_unit, r.nama_sub_unit,
            r.kode_bidang_urusan, r.nama_bidang_urusan, r.kode_program, r.nama_program,
            r.kode_kegiatan, r.nama_kegiatan, r.kode_sub_kegiatan, r.nama_sub_kegiatan,
            r.kode_rekening, r.nama_rekening, r.pagu, r.realisasi,
            r.akun, r.kelompok, r.jenis, r.objek, r.rincian_objek, r.sub_rincian_objek
     FROM realisasi r
     INNER JOIN tahun_anggaran ta ON r.tahun_id = ta.id
     WHERE r.user_id = ? AND ta.tahun = ?
     ORDER BY r.no`,
    [user.id, tahun]
  )
  return c.json({ data: rows.map(toJsonFormat) })
})

router.post('/', async (c) => {
  const user = c.get('user')
  const { data, tahun } = await c.req.json()

  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const [taRows] = await db.query(
    'SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun]
  )
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  // Validasi: semua baris TAHUN harus cocok dengan tahun yang dipilih
  const mismatch = data.find(row => String(row['TAHUN']) !== String(tahun))
  if (mismatch) {
    return c.json({
      error: `Data mengandung TAHUN yang tidak sesuai. Dipilih: ${tahun}, ditemukan: ${mismatch['TAHUN']}`,
    }, 422)
  }

  const cols = Object.values(FIELD_MAP)
  const placeholders = cols.map(() => '?').join(', ')

  await db.query(
    'DELETE FROM realisasi WHERE user_id = ? AND tahun_id = ?',
    [user.id, tahun_id]
  )

  const BATCH = 500
  for (let i = 0; i < data.length; i += BATCH) {
    const chunk = data.slice(i, i + BATCH)
    const rowPlaceholders = chunk.map(() => `(?, ?, ${placeholders})`).join(', ')
    const values = chunk.flatMap(row => [
      user.id,
      tahun_id,
      ...Object.entries(FIELD_MAP).map(([jsonKey]) => row[jsonKey] ?? null),
    ])
    await db.query(
      `INSERT INTO realisasi (user_id, tahun_id, ${cols.join(', ')}) VALUES ${rowPlaceholders}`,
      values
    )
  }

  return c.json({ success: true, inserted: data.length })
})

router.delete('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  await db.query(
    `DELETE r FROM realisasi r
     INNER JOIN tahun_anggaran ta ON r.tahun_id = ta.id
     WHERE r.user_id = ? AND ta.tahun = ?`,
    [user.id, tahun]
  )
  return c.json({ success: true })
})

export default router
