export const name = '2026_01_01_000001_create_users_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            CHAR(36)     NOT NULL DEFAULT (UUID()),
      username      VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role          ENUM('admin', 'superadmin') DEFAULT 'admin',
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    )
  `)
}
