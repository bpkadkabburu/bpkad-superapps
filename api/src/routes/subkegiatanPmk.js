import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { syncSubkegiatanPmk } from './sync.js'

const router = new Hono()
router.use('*', requireAuth)

// Upload manual dari dashboard (JWT). Extension pakai POST /api/sync/subkegiatan-pmk.
router.post('/', syncSubkegiatanPmk)

router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT s.kode_sub_kegiatan, s.sub_kegiatan, s.bidang
     FROM subkegiatan_pmk s
     INNER JOIN tahun_anggaran ta ON s.tahun_id = ta.id
     WHERE ta.tahun = ?
     ORDER BY s.kode_sub_kegiatan`,
    [tahun]
  )
  return c.json({ data: rows })
})

router.delete('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  await db.query(
    `DELETE s FROM subkegiatan_pmk s
     INNER JOIN tahun_anggaran ta ON s.tahun_id = ta.id
     WHERE ta.tahun = ?`,
    [tahun]
  )
  return c.json({ success: true })
})

export default router
