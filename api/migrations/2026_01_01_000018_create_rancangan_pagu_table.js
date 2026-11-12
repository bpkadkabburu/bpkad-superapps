export const name = '2026_01_01_000018_create_rancangan_pagu_table'

// Rancangan pagu BPKAD (Gaji/TPP/PPPK Paruh Waktu) — dipakai tab "Cek
// Rancangan Pagu" sebagai pembanding tetap terhadap anggaran_rekap.pagu, jadi
// tidak perlu diunggah ulang tiap kali halaman dibuka. Berbeda dari file
// pembanding di tab "Cek Inputan" (Proyeksi Gaji) yang sengaja TIDAK disimpan
// — rancangan pagu ini bukan derivasi dari anggaran_rekap, jadi menyimpannya
// tidak mengubah apa yang sedang dibandingkan.
//
// Satu upload menimpa SELURUH rancangan kategori itu untuk tahun tsb (bukan
// per-SKPD seperti sim_gaji), karena rancangan pagu BPKAD selalu direvisi utuh
// sekali per siklus anggaran.
export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS rancangan_pagu (
      id            CHAR(36)      NOT NULL DEFAULT (UUID()),
      tahun_id      CHAR(36)      NOT NULL,
      kategori      VARCHAR(20)   NOT NULL,
      kode_skpd     VARCHAR(50)   NOT NULL,
      nama_skpd     VARCHAR(255),
      kode_rekening VARCHAR(50)   NOT NULL,
      nama_rekening VARCHAR(500),
      pagu          BIGINT        NOT NULL DEFAULT 0,
      nama_berkas   VARCHAR(255),
      uploaded_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_rancangan_pagu (tahun_id, kategori, kode_skpd, kode_rekening),
      KEY idx_rancangan_pagu_tahun_kategori (tahun_id, kategori),
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
