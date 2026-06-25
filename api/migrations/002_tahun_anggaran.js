export const name = '002_tahun_anggaran'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS tahun_anggaran (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      tahun      INT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await db.query(`
    ALTER TABLE realisasi
      ADD COLUMN tahun_id INT NULL,
      ADD CONSTRAINT fk_realisasi_tahun
        FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
  `)

  await db.query(`
    ALTER TABLE paket_anggaran
      ADD COLUMN tahun_id INT NULL,
      ADD CONSTRAINT fk_paket_tahun
        FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
  `)

  await db.query(`
    ALTER TABLE mapping_pmk
      ADD COLUMN tahun_id INT NULL,
      ADD CONSTRAINT fk_mapping_tahun
        FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
  `)
}
