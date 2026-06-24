import { Hono } from 'hono'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import db from '../db.js'

const router = new Hono()

router.post('/login', async (c) => {
  const { username, password } = await c.req.json()
  const [rows] = await db.query(
    'SELECT * FROM users WHERE username = ?', [username]
  )
  const user = rows[0]
  if (!user || !await bcrypt.compare(password, user.password_hash))
    return c.json({ error: 'Username atau password salah' }, 401)

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  )
  return c.json({
    token,
    user: { id: user.id, username: user.username, role: user.role }
  })
})

export default router
