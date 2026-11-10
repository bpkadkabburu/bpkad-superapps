export const name = '2026_01_01_000017_add_tanggal_to_sipd_jadwal'

// tanggal — tanggal jadwal (penetapan/penandatanganan DPA), diisi manual dari
//           halaman DPA → Jadwal. Respons jadwal SIPD tidak membawa tanggal,
//           dan tanggal di dokumen DPA berbeda-beda antar dinas. Seperti
//           `aktif`, kolom ini TIDAK ditimpa oleh sinkron jadwal.
export async function up(db) {
  await db.query(`
    ALTER TABLE sipd_jadwal
      ADD COLUMN tanggal DATE NULL AFTER tahapan
  `)
}
