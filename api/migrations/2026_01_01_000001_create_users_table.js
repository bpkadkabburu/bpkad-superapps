export const name = '2026_01_01_000001_create_users_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      username      VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role          ENUM('admin', 'superadmin') DEFAULT 'admin',
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)
}
