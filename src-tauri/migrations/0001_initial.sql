-- Users
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('superadmin', 'user')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- Default superadmin (password: admin123 - harus diganti setelah login pertama)
INSERT OR IGNORE INTO users (username, password_hash, role)
VALUES ('admin', 'admin123', 'superadmin');
