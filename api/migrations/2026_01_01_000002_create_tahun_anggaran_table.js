export const name = '2026_01_01_000002_create_tahun_anggaran_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tahun_anggaran (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      tahun           INT NOT NULL UNIQUE,
      skpd_synced_at  TIMESTAMP NULL DEFAULT NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
}
