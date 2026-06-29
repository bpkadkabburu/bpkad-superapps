import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

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

router.post('/', async (c) => {
  const { data, tahun } = await c.req.json()

  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const [taRows] = await db.query(
    'SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun]
  )
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    await conn.query('DELETE FROM skpd WHERE tahun_id = ?', [tahun_id])

    const BATCH = 500
    for (let i = 0; i < data.length; i += BATCH) {
      const chunk = data.slice(i, i + BATCH)
      const placeholders = chunk.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
      const values = chunk.flatMap(row => [
        tahun_id,
        row.id_skpd ?? null,
        row.id_daerah ?? null,
        row.kode_skpd ?? null,
        row.nama_skpd ?? null,
        row.nip_kepala ?? null,
        row.nama_kepala ?? null,
        row.id_unit ?? null,
        row.is_skpd ?? 0,
        row.status ?? null,
        row.setup_unit ?? 0,
        row.kunci_skpd ?? 0,
        row.posisi ?? null,
      ])
      await conn.query(
        `INSERT INTO skpd
          (id, tahun_id, id_skpd, id_daerah, kode_skpd, nama_skpd, nip_kepala, nama_kepala,
           id_unit, is_skpd, status, setup_unit, kunci_skpd, posisi)
         VALUES ${placeholders}`,
        values
      )
    }

    const now = new Date()
    await conn.query(
      'UPDATE tahun_anggaran SET skpd_synced_at = ? WHERE id = ?',
      [now, tahun_id]
    )

    await conn.commit()
    return c.json({ success: true, count: data.length, synced_at: now.toISOString() })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
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
