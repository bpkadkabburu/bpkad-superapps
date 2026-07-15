import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { syncAnggaran } from './sync.js'

const router = new Hono()
router.use('*', requireAuth)

// Upload manual dari dashboard (JWT). Extension pakai POST /api/sync/anggaran.
router.post('/', syncAnggaran)

router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT ar.*
     FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ta.tahun = ?
     ORDER BY ar.no`,
    [tahun]
  )
  return c.json({ data: rows })
})

// Rekap pagu anggaran per sumber dana (group by), diurut dari terbesar.
router.get('/rekap-sumber-dana', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [], total: 0 })

  const [rows] = await db.query(
    `SELECT
       ar.kode_sumber_dana AS kode,
       COALESCE(NULLIF(TRIM(ar.nama_sumber_dana), ''), '(Tanpa Sumber Dana)') AS nama,
       SUM(ar.pagu) AS pagu,
       COUNT(*) AS jumlah_baris
     FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ta.tahun = ?
     GROUP BY ar.kode_sumber_dana, nama
     ORDER BY pagu DESC`,
    [tahun]
  )

  const total = rows.reduce((sum, r) => sum + Number(r.pagu || 0), 0)
  return c.json({ data: rows, total })
})

router.delete('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  await db.query(
    `DELETE ar FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ta.tahun = ?`,
    [tahun]
  )
  return c.json({ success: true })
})

export default router
