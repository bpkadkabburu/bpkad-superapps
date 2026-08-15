export const name = '2026_01_01_000013_create_sumber_dana_table'

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS sumber_dana (
      id          CHAR(36)     NOT NULL DEFAULT (UUID()),
      tahun_id    CHAR(36)     NOT NULL,
      id_dana     INT,
      kode_dana   VARCHAR(50),
      nama_dana   VARCHAR(255),
      is_locked   TINYINT      DEFAULT 0,
      sumber_dana VARCHAR(500),
      set_input   VARCHAR(10),
      synced_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_sumber_dana_tahun_kode (tahun_id, kode_dana),
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
