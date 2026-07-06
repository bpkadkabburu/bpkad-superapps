export const name = '2026_01_01_000010_create_sub_kegiatan_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS sub_kegiatan (
      id                  CHAR(36)     NOT NULL DEFAULT (UUID()),
      tahun_id            CHAR(36)     NOT NULL,
      id_unit             INT,
      id_skpd             INT,
      kode_skpd           VARCHAR(50),
      nama_skpd           VARCHAR(255),
      id_sub_skpd         INT,
      kode_sub_skpd       VARCHAR(50),
      nama_sub_skpd       VARCHAR(255),
      id_urusan           INT,
      kode_urusan         VARCHAR(50),
      nama_urusan         VARCHAR(255),
      id_bidang_urusan    INT,
      kode_bidang_urusan  VARCHAR(50),
      nama_bidang_urusan  VARCHAR(255),
      id_program          INT,
      kode_program        VARCHAR(50),
      nama_program        VARCHAR(255),
      id_giat             INT,
      kode_giat           VARCHAR(50),
      nama_giat           VARCHAR(500),
      id_sub_giat         INT          NOT NULL,
      kode_sub_giat       VARCHAR(50),
      nama_sub_giat       VARCHAR(500),
      synced_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
