import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { syncDokumenRealisasi } from './sync.js'

const router = new Hono()
router.use('*', requireAuth)

// Upload manual dari dashboard (JWT). Extension pakai POST /api/sync/dokumen-realisasi.
router.post('/', syncDokumenRealisasi)

router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT dr.*
     FROM dokumen_realisasi dr
     INNER JOIN tahun_anggaran ta ON dr.tahun_id = ta.id
     WHERE ta.tahun = ?
     ORDER BY dr.id`,
    [tahun]
  )
  return c.json({ data: rows })
})

router.delete('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  await db.query(
    `DELETE dr FROM dokumen_realisasi dr
     INNER JOIN tahun_anggaran ta ON dr.tahun_id = ta.id
     WHERE ta.tahun = ?`,
    [tahun]
  )
  return c.json({ success: true })
})

export default router
