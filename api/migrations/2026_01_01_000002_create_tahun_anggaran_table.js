export const name = '2026_01_01_000002_create_tahun_anggaran_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tahun_anggaran (
      id              CHAR(36)  NOT NULL DEFAULT (UUID()),
      tahun           INT NOT NULL UNIQUE,
      skpd_synced_at  TIMESTAMP NULL DEFAULT NULL,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    )
  `)
}
