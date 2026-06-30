export const name = '2026_01_01_000006_create_anggaran_rekap_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS anggaran_rekap (
      id                   CHAR(36)  NOT NULL DEFAULT (UUID()),
      user_id              CHAR(36)  NOT NULL,
      tahun_id             CHAR(36)  NOT NULL,
      no                   INT,
      tahun_file           INT,
      kode_urusan          VARCHAR(20),
      nama_urusan          VARCHAR(255),
      kode_skpd            VARCHAR(50),
      nama_skpd            VARCHAR(255),
      kode_sub_unit        VARCHAR(50),
      nama_sub_unit        VARCHAR(255),
      kode_bidang_urusan   VARCHAR(20),
      nama_bidang_urusan   VARCHAR(255),
      kode_program         VARCHAR(50),
      nama_program         VARCHAR(255),
      kode_kegiatan        VARCHAR(50),
      nama_kegiatan        VARCHAR(500),
      kode_sub_kegiatan    VARCHAR(50),
      nama_sub_kegiatan    VARCHAR(500),
      kode_sumber_dana     VARCHAR(50),
      nama_sumber_dana     VARCHAR(255),
      kode_rekening        VARCHAR(50),
      nama_rekening        VARCHAR(500),
      paket_kelompok       VARCHAR(50),
      nama_paket_kelompok  VARCHAR(500),
      pagu                 BIGINT DEFAULT 0,
      uploaded_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
