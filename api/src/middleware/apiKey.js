import { createHash } from 'crypto'
import { createMiddleware } from 'hono/factory'
import db from '../db.js'

export const hashKey = (key) => createHash('sha256').update(key).digest('hex')

export const requireApiKey = createMiddleware(async (c, next) => {
  const key = c.req.header('X-API-Key')
  if (!key) return c.json({ error: 'API key diperlukan' }, 401)

  const [rows] = await db.query(
    'SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL',
    [hashKey(key)]
  )
  const apiKey = rows[0]
  if (!apiKey) return c.json({ error: 'API key tidak valid' }, 401)

  c.set('apiKey', apiKey)

  // fire-and-forget: catat pemakaian terakhir tanpa memblok request
  db.query('UPDATE api_keys SET last_used_at = ? WHERE id = ?', [new Date(), apiKey.id])
    .catch(() => {})

  await next()
})
