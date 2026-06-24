import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

router.get('/', async (c) => {
  const user = c.get('user')
  const [rows] = await db.query(
    'SELECT pagu_per_bidang, results FROM mapping_pmk WHERE user_id = ?',
    [user.id]
  )
  return c.json({
    pagu_per_bidang: rows[0]?.pagu_per_bidang || {},
    results: rows[0]?.results || [],
  })
})

router.put('/pagu', async (c) => {
  const user = c.get('user')
  const { pagu_per_bidang } = await c.req.json()
  const [existing] = await db.query(
    'SELECT id FROM mapping_pmk WHERE user_id = ?', [user.id]
  )
  if (existing[0]) {
    await db.query(
      'UPDATE mapping_pmk SET pagu_per_bidang = ?, updated_at = NOW() WHERE user_id = ?',
      [JSON.stringify(pagu_per_bidang), user.id]
    )
  } else {
    await db.query(
      'INSERT INTO mapping_pmk (user_id, pagu_per_bidang, results) VALUES (?, ?, ?)',
      [user.id, JSON.stringify(pagu_per_bidang), JSON.stringify([])]
    )
  }
  return c.json({ success: true })
})

router.put('/results', async (c) => {
  const user = c.get('user')
  const { results } = await c.req.json()
  const [existing] = await db.query(
    'SELECT id FROM mapping_pmk WHERE user_id = ?', [user.id]
  )
  if (existing[0]) {
    await db.query(
      'UPDATE mapping_pmk SET results = ?, updated_at = NOW() WHERE user_id = ?',
      [JSON.stringify(results), user.id]
    )
  } else {
    await db.query(
      'INSERT INTO mapping_pmk (user_id, pagu_per_bidang, results) VALUES (?, ?, ?)',
      [user.id, JSON.stringify({}), JSON.stringify(results)]
    )
  }
  return c.json({ success: true })
})

router.delete('/', async (c) => {
  const user = c.get('user')
  await db.query('DELETE FROM mapping_pmk WHERE user_id = ?', [user.id])
  return c.json({ success: true })
})

export default router
