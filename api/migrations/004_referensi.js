export const name = '004_referensi'

export async function up(db) {
  await db.query(`DROP TABLE IF EXISTS mapping_pmk`)

  await db.query(`
    CREATE TABLE subkegiatan_pmk (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      user_id           INT NOT NULL,
      tahun_id          INT NOT NULL,
      kode_subkegiatan  VARCHAR(50),
      subkegiatan       VARCHAR(500),
      bidang            VARCHAR(100),
      uploaded_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
