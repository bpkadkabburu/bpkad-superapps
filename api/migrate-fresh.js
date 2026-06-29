import 'dotenv/config'
import { readdir } from 'fs/promises'
import { pathToFileURL } from 'url'
import { join } from 'path'
import db from './src/db.js'

// Drop all known tables in reverse dependency order
const DROP_ORDER = [
  'dokumen_realisasi',
  'anggaran_rekap',
  'subkegiatan_pmk',
  'realisasi',
  'skpd',
  'tahun_anggaran',
  'users',
  'migrations',
]

console.log('Dropping all tables...')
await db.query('SET FOREIGN_KEY_CHECKS = 0')
for (const table of DROP_ORDER) {
  await db.query(`DROP TABLE IF EXISTS \`${table}\``)
  console.log(`  dropped  ${table}`)
}
await db.query('SET FOREIGN_KEY_CHECKS = 1')
console.log()

// Re-run all migrations from scratch
await db.query(`
  CREATE TABLE IF NOT EXISTS migrations (
    id     INT AUTO_INCREMENT PRIMARY KEY,
    name   VARCHAR(255) UNIQUE NOT NULL,
    run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`)

const files = (await readdir(new URL('./migrations', import.meta.url)))
  .filter(f => f.endsWith('.js'))
  .sort()

let count = 0
for (const file of files) {
  const { name, up } = await import(pathToFileURL(join(process.cwd(), 'migrations', file)).href)
  process.stdout.write(`  run   ${name} ... `)
  await up(db)
  await db.query('INSERT INTO migrations (name) VALUES (?)', [name])
  console.log('OK')
  count++
}

console.log(`\n${count} migration(s) applied.`)
process.exit(0)
