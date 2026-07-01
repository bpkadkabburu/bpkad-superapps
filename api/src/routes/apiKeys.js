import { Hono } from 'hono'
import { randomBytes } from 'crypto'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { hashKey } from '../middleware/apiKey.js'

const router = new Hono()
router.use('*', requireAuth)

// GET / — daftar key (tanpa key asli, hanya prefix + status)
router.get('/', async (c) => {
  const [rows] = await db.query(
    `SELECT id, name, key_prefix, last_used_at, revoked_at, created_at
     FROM api_keys ORDER BY created_at DESC`
  )
  return c.json({ data: rows })
})

// POST / — terbitkan key baru. Key penuh HANYA dikembalikan sekali di sini.
router.post('/', async (c) => {
  const { name } = await c.req.json()
  if (!name?.trim()) return c.json({ error: 'name diperlukan' }, 400)

  const key = `bpkad_live_${randomBytes(24).toString('hex')}`
  const prefix = key.slice(0, 18) // "bpkad_live_" + 7 char

  await db.query(
    'INSERT INTO api_keys (name, key_prefix, key_hash) VALUES (?, ?, ?)',
    [name.trim(), prefix, hashKey(key)]
  )

  const [rows] = await db.query(
    'SELECT id, name, key_prefix, created_at FROM api_keys WHERE key_hash = ?',
    [hashKey(key)]
  )

  // `key` hanya ada di respons ini — tidak disimpan, tidak bisa dilihat lagi
  return c.json({ ...rows[0], key }, 201)
})

// DELETE /:id — cabut key (soft-revoke)
router.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const [result] = await db.query(
    'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
    [new Date(), id]
  )
  if (result.affectedRows === 0)
    return c.json({ error: 'Key tidak ditemukan atau sudah dicabut' }, 404)
  return c.json({ success: true })
})

export default router
