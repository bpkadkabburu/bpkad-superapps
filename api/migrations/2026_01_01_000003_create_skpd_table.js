export const name = '2026_01_01_000003_create_skpd_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS skpd (
      id           CHAR(36)     NOT NULL DEFAULT (UUID()),
      tahun_id     CHAR(36)     NOT NULL,
      id_skpd      INT          NOT NULL,
      id_daerah    INT,
      kode_skpd    VARCHAR(50),
      nama_skpd    VARCHAR(255),
      nip_kepala   VARCHAR(30),
      nama_kepala  VARCHAR(255),
      id_unit      INT,
      is_skpd      TINYINT(1)   DEFAULT 0,
      status       VARCHAR(50),
      setup_unit   TINYINT(1)   DEFAULT 0,
      kunci_skpd   TINYINT(1)   DEFAULT 0,
      posisi       VARCHAR(100),
      synced_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_skpd_per_tahun (tahun_id, id_skpd),
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
