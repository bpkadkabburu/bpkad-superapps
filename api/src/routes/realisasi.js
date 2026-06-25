// api/src/routes/realisasi.js
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
    `SELECT r.data FROM realisasi r
     INNER JOIN tahun_anggaran ta ON r.tahun_id = ta.id
     WHERE r.user_id = ? AND ta.tahun = ?
     LIMIT 1`,
    [user.id, tahun]
  )
  return c.json({ data: rows[0]?.data || [] })
})

router.post('/', async (c) => {
  const user = c.get('user')
  const { data, tahun } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  const [taRows] = await db.query(
    'SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun]
  )
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)
  const [existing] = await db.query(
    'SELECT id FROM realisasi WHERE user_id = ? AND tahun_id = ?',
    [user.id, tahun_id]
  )
  if (existing[0]) {
    await db.query(
      'UPDATE realisasi SET data = ?, updated_at = NOW() WHERE user_id = ? AND tahun_id = ?',
      [JSON.stringify(data), user.id, tahun_id]
    )
  } else {
    await db.query(
      'INSERT INTO realisasi (user_id, tahun_id, data) VALUES (?, ?, ?)',
      [user.id, tahun_id, JSON.stringify(data)]
    )
  }
  return c.json({ success: true })
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
