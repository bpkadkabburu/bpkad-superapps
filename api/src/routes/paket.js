import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

router.get('/', async (c) => {
  const user = c.get('user')
  const [rows] = await db.query(
    'SELECT data FROM paket_anggaran WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
    [user.id]
  )
  return c.json({ data: rows[0]?.data || [] })
})

router.post('/', async (c) => {
  const user = c.get('user')
  const { data } = await c.req.json()
  const [existing] = await db.query(
    'SELECT id FROM paket_anggaran WHERE user_id = ?', [user.id]
  )
  if (existing[0]) {
    await db.query(
      'UPDATE paket_anggaran SET data = ?, updated_at = NOW() WHERE user_id = ?',
      [JSON.stringify(data), user.id]
    )
  } else {
    await db.query(
      'INSERT INTO paket_anggaran (user_id, data) VALUES (?, ?)',
      [user.id, JSON.stringify(data)]
    )
  }
  return c.json({ success: true })
})

router.delete('/', async (c) => {
  const user = c.get('user')
  await db.query('DELETE FROM paket_anggaran WHERE user_id = ?', [user.id])
  return c.json({ success: true })
})

export default router
