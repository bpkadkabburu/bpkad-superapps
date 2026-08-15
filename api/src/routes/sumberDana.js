import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { syncSumberDana } from './sync.js'

const router = new Hono()
router.use('*', requireAuth)

// Upload manual dari dashboard (JWT). Extension pakai POST /api/sync/sumber-dana.
router.post('/', syncSumberDana)

router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  // Urutan final ditentukan di sisi klien (perbandingan per segmen kode),
  // di sini cukup deterministik biar hasilnya stabil.
  const [rows] = await db.query(
    `SELECT sd.id, sd.id_dana, sd.kode_dana, sd.nama_dana,
            sd.is_locked, sd.sumber_dana, sd.set_input, sd.synced_at
     FROM sumber_dana sd
     INNER JOIN tahun_anggaran ta ON sd.tahun_id = ta.id
     WHERE ta.tahun = ?
     ORDER BY sd.kode_dana`,
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

  await db.query('DELETE FROM sumber_dana WHERE tahun_id = ?', [tahun_id])

  return c.json({ success: true })
})

export default router
