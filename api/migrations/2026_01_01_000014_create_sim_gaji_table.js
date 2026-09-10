export const name = '2026_01_01_000014_create_sim_gaji_table'

// Nilai "satu bulan gaji" versi SIM Gaji, diketik manual di kolom kuning file
// export Proyeksi Gaji lalu diunggah balik. Gunanya sebagai PEMBANDING terhadap
// angka yang ditebak dari realisasi SP2D (rataRata = sp2d ÷ dibayar) — bukan
// pengganti: perhitungan proyeksi tetap berjalan seperti sebelumnya, tabel ini
// hanya menambah kolom untuk mengukur seberapa jauh rumusnya meleset.
//
// Tidak menyimpan riwayat: satu tahun anggaran hanya punya satu set nilai, yang
// terbaru menimpa yang lama. Karena itu `bulan` disimpan sebagai keterangan
// (set ini berasal dari bulan berapa), bukan bagian dari kunci — dipakai untuk
// memperingatkan pemakai kalau angkanya sudah tertinggal dari bulan realisasi
// terakhir.
//
// `komponen` menampung rincian yang di SIM Gaji terpecah sementara rekeningnya
// cuma satu — tunjangan keluarga tercetak sebagai Tunjangan Istri dan Tunjangan
// Anak. Baris induk rekening memakai string kosong, bukan NULL: di MySQL dua
// NULL tidak dianggap sama, sehingga UNIQUE KEY-nya tidak akan mencegah duplikat.
export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS sim_gaji (
      id            CHAR(36)      NOT NULL DEFAULT (UUID()),
      tahun_id      CHAR(36)      NOT NULL,
      bulan         TINYINT       NOT NULL,
      kode_skpd     VARCHAR(50)   NOT NULL,
      nama_skpd     VARCHAR(255),
      kode_rekening VARCHAR(50)   NOT NULL,
      nama_rekening VARCHAR(500),
      komponen      VARCHAR(100)  NOT NULL DEFAULT '',
      nilai         DECIMAL(20,2) NOT NULL DEFAULT 0,
      uploaded_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_sim_gaji (tahun_id, kode_skpd, kode_rekening, komponen),
      KEY idx_sim_gaji_tahun_skpd (tahun_id, kode_skpd),
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
