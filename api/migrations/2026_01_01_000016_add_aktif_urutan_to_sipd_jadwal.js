export const name = '2026_01_01_000016_add_aktif_urutan_to_sipd_jadwal'

// aktif  — jadwal nonaktif disembunyikan dari pilihan download di extension
//          (GET /api/sync/jadwal). Diatur dari halaman DPA → Jadwal, dan TIDAK
//          ditimpa oleh sinkron: jadwal baru masuk aktif, jadwal lama tetap
//          mengikuti setelan yang sudah ada.
// urutan — posisi jadwal di respons SIPD, supaya extension bisa menampilkan
//          urutan yang sama dengan SIPD. Ditimpa tiap sinkron.
export async function up(db) {
  await db.query(`
    ALTER TABLE sipd_jadwal
      ADD COLUMN aktif  BOOLEAN NOT NULL DEFAULT TRUE AFTER tahapan,
      ADD COLUMN urutan INT     NULL AFTER aktif
  `)

  // TA 2024 id_jadwal 62 ("HIBAH REHABILITASI DAN REKONSTRUKSI PASCABENCANA")
  // adalah jadwal gagal yang digantikan versi "... PENYESUAIAN". Barisnya
  // disisipkan sekarang walau jadwal 2024 belum tersinkron: kalau hanya
  // di-UPDATE, baris itu belum ada dan nanti masuk sebagai aktif. Sinkron
  // berikutnya melengkapi id_jadwal_sipd/nama/tahapan tanpa menyentuh aktif.
  await db.query(`
    INSERT INTO sipd_jadwal (id, tahun_id, id_jadwal, nama, aktif)
    SELECT UUID(), id, 62, 'HIBAH REHABILITASI DAN REKONSTRUKSI PASCABENCANA', FALSE
    FROM tahun_anggaran WHERE tahun = 2024
    ON DUPLICATE KEY UPDATE aktif = FALSE
  `)
}
