export const name = '2026_01_01_000008_add_bulan_to_dokumen_realisasi'

export async function up(db) {
  await db.query(`
    ALTER TABLE dokumen_realisasi
    ADD COLUMN bulan TINYINT NULL AFTER tahun_id
  `)
  await db.query(`
    CREATE INDEX idx_dokumen_realisasi_bulan
    ON dokumen_realisasi (user_id, tahun_id, bulan)
  `)
}
