// api/src/routes/mapping.js
import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

router.get('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ pagu_per_bidang: {}, results: [] })
  const [rows] = await db.query(
    `SELECT m.pagu_per_bidang, m.results FROM mapping_pmk m
     INNER JOIN tahun_anggaran ta ON m.tahun_id = ta.id
     WHERE m.user_id = ? AND ta.tahun = ?`,
    [user.id, tahun]
  )
  return c.json({
    pagu_per_bidang: rows[0]?.pagu_per_bidang || {},
    results: rows[0]?.results || [],
  })
})

router.put('/pagu', async (c) => {
  const user = c.get('user')
  const { pagu_per_bidang, tahun } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  const [taRows] = await db.query(
    'SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun]
  )
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)
  const [existing] = await db.query(
    'SELECT id FROM mapping_pmk WHERE user_id = ? AND tahun_id = ?',
    [user.id, tahun_id]
  )
  if (existing[0]) {
    await db.query(
      'UPDATE mapping_pmk SET pagu_per_bidang = ?, updated_at = NOW() WHERE user_id = ? AND tahun_id = ?',
      [JSON.stringify(pagu_per_bidang), user.id, tahun_id]
    )
  } else {
    await db.query(
      'INSERT INTO mapping_pmk (user_id, tahun_id, pagu_per_bidang, results) VALUES (?, ?, ?, ?)',
      [user.id, tahun_id, JSON.stringify(pagu_per_bidang), JSON.stringify([])]
    )
  }
  return c.json({ success: true })
})

router.put('/results', async (c) => {
  const user = c.get('user')
  const { results, tahun } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  const [taRows] = await db.query(
    'SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun]
  )
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)
  const [existing] = await db.query(
    'SELECT id FROM mapping_pmk WHERE user_id = ? AND tahun_id = ?',
    [user.id, tahun_id]
  )
  if (existing[0]) {
    await db.query(
      'UPDATE mapping_pmk SET results = ?, updated_at = NOW() WHERE user_id = ? AND tahun_id = ?',
      [JSON.stringify(results), user.id, tahun_id]
    )
  } else {
    await db.query(
      'INSERT INTO mapping_pmk (user_id, tahun_id, pagu_per_bidang, results) VALUES (?, ?, ?, ?)',
      [user.id, tahun_id, JSON.stringify({}), JSON.stringify(results)]
    )
  }
  return c.json({ success: true })
})

router.delete('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  await db.query(
    `DELETE m FROM mapping_pmk m
     INNER JOIN tahun_anggaran ta ON m.tahun_id = ta.id
     WHERE m.user_id = ? AND ta.tahun = ?`,
    [user.id, tahun]
  )
  return c.json({ success: true })
})

export default router
