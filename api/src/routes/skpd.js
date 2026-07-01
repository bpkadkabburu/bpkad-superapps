import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { syncSkpd } from './sync.js'

const router = new Hono()
router.use('*', requireAuth)

// Upload manual dari dashboard (JWT). Extension pakai POST /api/sync/skpd.
router.post('/', syncSkpd)

router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT s.*
     FROM skpd s
     INNER JOIN tahun_anggaran ta ON s.tahun_id = ta.id
     WHERE ta.tahun = ?
     ORDER BY s.kode_skpd`,
    [tahun]
  )
  return c.json({ data: rows })
})

router.delete('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  const [taRows] = await db.query(
    'SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun]
  )
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  await db.query('DELETE FROM skpd WHERE tahun_id = ?', [tahun_id])
  await db.query(
    'UPDATE tahun_anggaran SET skpd_synced_at = NULL WHERE id = ?',
    [tahun_id]
  )

  return c.json({ success: true })
})

export default router
