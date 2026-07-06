import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { syncSubKegiatan } from './sync.js'

const router = new Hono()
router.use('*', requireAuth)

// Upload manual dari dashboard (JWT). Extension pakai POST /api/sync/sub-kegiatan.
router.post('/', syncSubKegiatan)

router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT sk.*
     FROM sub_kegiatan sk
     INNER JOIN tahun_anggaran ta ON sk.tahun_id = ta.id
     WHERE ta.tahun = ?
     ORDER BY sk.kode_sub_giat`,
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

  await db.query('DELETE FROM sub_kegiatan WHERE tahun_id = ?', [tahun_id])

  return c.json({ success: true })
})

export default router
