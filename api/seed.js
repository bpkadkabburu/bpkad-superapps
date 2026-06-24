import 'dotenv/config'
import bcrypt from 'bcryptjs'
import db from './src/db.js'

const username = 'admin'
const password = 'admin123'
const role = 'superadmin'

const hash = await bcrypt.hash(password, 10)
await db.query(
  'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)',
  [username, hash, role]
)

console.log(`User "${username}" berhasil dibuat/diupdate.`)
console.log('Ganti password setelah login pertama!')
process.exit(0)
