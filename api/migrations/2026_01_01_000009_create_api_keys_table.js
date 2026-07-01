export const name = '2026_01_01_000009_create_api_keys_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id           CHAR(36)     NOT NULL DEFAULT (UUID()),
      name         VARCHAR(100) NOT NULL,
      key_prefix   VARCHAR(20)  NOT NULL,
      key_hash     CHAR(64)     UNIQUE NOT NULL,
      last_used_at TIMESTAMP    NULL,
      revoked_at   TIMESTAMP    NULL,
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    )
  `)
}
