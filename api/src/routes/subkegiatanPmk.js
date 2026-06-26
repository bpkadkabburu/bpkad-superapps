import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

router.get('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT s.kode_subkegiatan, s.subkegiatan, s.bidang
     FROM subkegiatan_pmk s
     INNER JOIN tahun_anggaran ta ON s.tahun_id = ta.id
     WHERE s.user_id = ? AND ta.tahun = ?
     ORDER BY s.kode_subkegiatan`,
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

  await db.query(
    'DELETE FROM subkegiatan_pmk WHERE user_id = ? AND tahun_id = ?',
    [user.id, tahun_id]
  )

  const BATCH = 500
  for (let i = 0; i < data.length; i += BATCH) {
    const chunk = data.slice(i, i + BATCH)
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ')
    const values = chunk.flatMap(row => [
      user.id,
      tahun_id,
      row.kode_subkegiatan ?? null,
      row.subkegiatan ?? null,
      row.bidang ?? null,
    ])
    await db.query(
      `INSERT INTO subkegiatan_pmk (user_id, tahun_id, kode_subkegiatan, subkegiatan, bidang)
       VALUES ${placeholders}`,
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
    `DELETE s FROM subkegiatan_pmk s
     INNER JOIN tahun_anggaran ta ON s.tahun_id = ta.id
     WHERE s.user_id = ? AND ta.tahun = ?`,
    [user.id, tahun]
  )
  return c.json({ success: true })
})

export default router
