export const name = '003_realisasi_rows'

export async function up(db) {
  await db.query(`DROP TABLE IF EXISTS realisasi`)

  await db.query(`
    CREATE TABLE realisasi (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      user_id            INT NOT NULL,
      tahun_id           INT NOT NULL,
      no                 INT,
      kode_skpd          VARCHAR(50),
      nama_skpd          VARCHAR(255),
      kode_sub_unit      VARCHAR(50),
      nama_sub_unit      VARCHAR(255),
      kode_bidang_urusan VARCHAR(50),
      nama_bidang_urusan VARCHAR(255),
      kode_program       VARCHAR(50),
      nama_program       VARCHAR(255),
      kode_kegiatan      VARCHAR(50),
      nama_kegiatan      VARCHAR(500),
      kode_sub_kegiatan  VARCHAR(50),
      nama_sub_kegiatan  VARCHAR(500),
      kode_rekening      VARCHAR(50),
      nama_rekening      VARCHAR(500),
      pagu               BIGINT DEFAULT 0,
      realisasi          BIGINT DEFAULT 0,
      akun               VARCHAR(20),
      kelompok           VARCHAR(20),
      jenis              VARCHAR(20),
      objek              VARCHAR(20),
      rincian_objek      VARCHAR(20),
      sub_rincian_objek  VARCHAR(50),
      uploaded_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
