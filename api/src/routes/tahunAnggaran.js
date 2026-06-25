import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

router.get('/', async (c) => {
  const [rows] = await db.query(
    'SELECT id, tahun FROM tahun_anggaran ORDER BY tahun DESC'
  )
  return c.json({ data: rows })
})

router.post('/', async (c) => {
  const user = c.get('user')
  if (user.role !== 'superadmin') {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const { tahun } = await c.req.json()
  if (!tahun || isNaN(Number(tahun))) {
    return c.json({ error: 'Tahun tidak valid' }, 400)
  }
  try {
    const [result] = await db.query(
      'INSERT INTO tahun_anggaran (tahun) VALUES (?)',
      [Number(tahun)]
    )
    return c.json({ id: result.insertId, tahun: Number(tahun) })
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return c.json({ error: 'Tahun sudah ada' }, 409)
    }
    throw e
  }
})

export default router
