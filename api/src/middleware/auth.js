import jwt from 'jsonwebtoken'
import { createMiddleware } from 'hono/factory'

export const requireAuth = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer '))
    return c.json({ error: 'Unauthorized' }, 401)

  try {
    const token = header.slice(7)
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    c.set('user', payload)
    await next()
  } catch {
    return c.json({ error: 'Token invalid' }, 401)
  }
})
