import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

const FIELD_MAP = {
  'NO':                   'no',
  'TAHUN':                'tahun_file',
  'KODE URUSAN':          'kode_urusan',
  'NAMA URUSAN':          'nama_urusan',
  'KODE SKPD':            'kode_skpd',
  'NAMA SKPD':            'nama_skpd',
  'KODE SUB UNIT':        'kode_sub_unit',
  'NAMA SUB UNIT':        'nama_sub_unit',
  'KODE BIDANG URUSAN':   'kode_bidang_urusan',
  'NAMA BIDANG URUSAN':   'nama_bidang_urusan',
  'KODE PROGRAM':         'kode_program',
  'NAMA PROGRAM':         'nama_program',
  'KODE KEGIATAN':        'kode_kegiatan',
  'NAMA KEGIATAN':        'nama_kegiatan',
  'KODE SUB KEGIATAN':    'kode_sub_kegiatan',
  'NAMA SUB KEGIATAN':    'nama_sub_kegiatan',
  'KODE SUMBER DANA':     'kode_sumber_dana',
  'NAMA SUMBER DANA':     'nama_sumber_dana',
  'KODE REKENING':        'kode_rekening',
  'NAMA REKENING':        'nama_rekening',
  'PAKET/KELOMPOK':       'paket_kelompok',
  'NAMA PAKET/KELOMPOK':  'nama_paket_kelompok',
  'PAGU':                 'pagu',
}

const cols = Object.values(FIELD_MAP)

router.get('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT ar.*
     FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ar.user_id = ? AND ta.tahun = ?
     ORDER BY ar.no`,
    [user.id, tahun]
  )
  return c.json({ data: rows })
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

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    await conn.query(
      'DELETE FROM anggaran_rekap WHERE user_id = ? AND tahun_id = ?',
      [user.id, tahun_id]
    )

    const placeholders = cols.map(() => '?').join(', ')
    const BATCH = 200
    for (let i = 0; i < data.length; i += BATCH) {
      const chunk = data.slice(i, i + BATCH)
      const rowPlaceholders = chunk.map(() => `(?, ?, ${placeholders})`).join(', ')
      const values = chunk.flatMap(row => [
        user.id,
        tahun_id,
        ...Object.entries(FIELD_MAP).map(([excelKey]) => {
          const val = row[excelKey] ?? null
          return val === '' ? null : val
        }),
      ])
      await conn.query(
        `INSERT INTO anggaran_rekap (user_id, tahun_id, ${cols.join(', ')}) VALUES ${rowPlaceholders}`,
        values
      )
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  return c.json({ success: true, inserted: data.length })
})

router.delete('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  await db.query(
    `DELETE ar FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ar.user_id = ? AND ta.tahun = ?`,
    [user.id, tahun]
  )
  return c.json({ success: true })
})

export default router
