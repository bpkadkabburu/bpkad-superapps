export const name = '2026_01_01_000011_create_dokumen_aklap_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS dokumen_aklap (
      id                       CHAR(36)  NOT NULL DEFAULT (UUID()),
      tahun_id                 CHAR(36)  NOT NULL,
      kode_sub_skpd            VARCHAR(50),
      nama_sub_skpd            VARCHAR(255),
      kode_urusan              VARCHAR(20),
      nama_urusan              VARCHAR(255),
      kode_bidang_urusan       VARCHAR(20),
      nama_bidang_urusan       VARCHAR(255),
      kode_program             VARCHAR(50),
      nama_program             VARCHAR(255),
      kode_kegiatan            VARCHAR(50),
      nama_kegiatan            VARCHAR(500),
      kode_sub_kegiatan        VARCHAR(50),
      nama_sub_kegiatan        VARCHAR(500),
      kode_rekening            VARCHAR(50),
      nama_rekening            VARCHAR(500),
      nilai_realisasi          DECIMAL(20,2) DEFAULT 0,
      uploaded_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      INDEX idx_tahun (tahun_id),
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
