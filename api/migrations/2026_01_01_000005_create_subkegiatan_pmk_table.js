export const name = '2026_01_01_000005_create_subkegiatan_pmk_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS subkegiatan_pmk (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      user_id             INT NOT NULL,
      tahun_id            INT NOT NULL,
      kode_sub_kegiatan   VARCHAR(50),
      sub_kegiatan        VARCHAR(500),
      bidang              VARCHAR(100),
      uploaded_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
