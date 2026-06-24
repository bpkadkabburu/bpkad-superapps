import 'dotenv/config'
import { readdir } from 'fs/promises'
import { pathToFileURL } from 'url'
import { join } from 'path'
import db from './src/db.js'

await db.query(`
  CREATE TABLE IF NOT EXISTS migrations (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    name       VARCHAR(255) UNIQUE NOT NULL,
    run_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`)

const [ran] = await db.query('SELECT name FROM migrations')
const ranSet = new Set(ran.map(r => r.name))

const files = (await readdir(new URL('./migrations', import.meta.url)))
  .filter(f => f.endsWith('.js'))
  .sort()

let count = 0
for (const file of files) {
  const { name, up } = await import(pathToFileURL(join(process.cwd(), 'migrations', file)).href)

  if (ranSet.has(name)) {
    console.log(`  skip  ${name}`)
    continue
  }

  process.stdout.write(`  run   ${name} ... `)
  await up(db)
  await db.query('INSERT INTO migrations (name) VALUES (?)', [name])
  console.log('OK')
  count++
}

console.log(count ? `\n${count} migration(s) applied.` : '\nNothing to migrate.')
process.exit(0)
