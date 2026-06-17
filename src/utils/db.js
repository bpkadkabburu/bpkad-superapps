import Database from '@tauri-apps/plugin-sql'
import { invoke } from '@tauri-apps/api/core'

let _db = null

export async function getDb() {
  if (!_db) {
    const dbPath = await invoke('get_db_path')
    _db = await Database.load(dbPath)
  }
  return _db
}
