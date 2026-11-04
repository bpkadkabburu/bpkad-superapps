export const name = '2026_01_01_000015_create_sipd_dpa_tables'

// Data DPA yang dikirim penat-extension (POST /api/sync/jadwal, /tim-tapd, /dpa).
// Extension tidak mengolah apa-apa: respons SIPD disimpan MENTAH di kolom `data`.
// Kolom di luar `data` hanya kunci untuk upsert dan pencarian; parsing isi JSON
// ke kolom-kolom dilakukan nanti, kalau sudah ada yang membutuhkannya.
//
// sipd_jadwal menyimpan DUA ID untuk jadwal yang sama, dan keduanya wajib:
// halaman DPA dirujuk lewat id_jadwal (mis. 63), sedangkan rincian belanja
// lewat id_jadwal_sipd (mis. 513). Mencocokkan lewat nama tidak aman — ada
// nama yang mirip, dan nama jadwal bisa diubah di SIPD.
//
// Tabel DPA tidak menyimpan tahun: tahunnya ikut lewat sipd_jadwal.
const DPA_PER_SKPD = [
  'dpa_persetujuan_depan',
  'dpa_skpd',
  'dpa_pendapatan',
  'dpa_belanja',
  'dpa_pembiayaan',
]

export async function up(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS sipd_jadwal (
      id              CHAR(36)     NOT NULL DEFAULT (UUID()),
      tahun_id        CHAR(36)     NOT NULL,
      id_jadwal       INT          NOT NULL,
      id_jadwal_sipd  INT          NULL,
      nama            VARCHAR(500),
      tahapan         VARCHAR(500),
      synced_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_sipd_jadwal (tahun_id, id_jadwal),
      KEY idx_sipd_jadwal_sipd (tahun_id, id_jadwal_sipd),
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS sipd_tim_tapd (
      id         CHAR(36)     NOT NULL DEFAULT (UUID()),
      tahun_id   CHAR(36)     NOT NULL,
      no_urut    INT,
      nama       VARCHAR(255),
      nip        VARCHAR(50),
      jabatan    VARCHAR(500),
      synced_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_sipd_tim_tapd_tahun (tahun_id, no_urut),
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)

  for (const tabel of DPA_PER_SKPD) {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${tabel} (
        id              CHAR(36)     NOT NULL DEFAULT (UUID()),
        sipd_jadwal_id  CHAR(36)     NOT NULL,
        id_skpd         INT          NOT NULL,
        kode_skpd       VARCHAR(50),
        nama_skpd       VARCHAR(255),
        data            JSON         NOT NULL,
        synced_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_${tabel} (sipd_jadwal_id, id_skpd),
        FOREIGN KEY (sipd_jadwal_id) REFERENCES sipd_jadwal(id) ON DELETE CASCADE
      )
    `)
  }

  // Rincian belanja diambil per sub kegiatan, jadi kuncinya ikut memuat sub
  // SKPD dan sub kegiatan — tanpa itu semua sub kegiatan dalam satu SKPD saling
  // menimpa. Keduanya NOT NULL (default 0): di MySQL dua NULL tidak dianggap
  // sama, sehingga UNIQUE KEY tidak akan mencegah duplikat.
  await db.query(`
    CREATE TABLE IF NOT EXISTS dpa_rincian_belanja (
      id              CHAR(36)     NOT NULL DEFAULT (UUID()),
      sipd_jadwal_id  CHAR(36)     NOT NULL,
      id_skpd         INT          NOT NULL,
      kode_skpd       VARCHAR(50),
      nama_skpd       VARCHAR(255),
      id_sub_skpd     INT          NOT NULL DEFAULT 0,
      nama_sub_skpd   VARCHAR(255),
      id_sub_giat     INT          NOT NULL DEFAULT 0,
      kode_sub_giat   VARCHAR(100),
      nama_sub_giat   VARCHAR(500),
      data            JSON         NOT NULL,
      synced_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_dpa_rincian_belanja (sipd_jadwal_id, id_skpd, id_sub_skpd, id_sub_giat),
      FOREIGN KEY (sipd_jadwal_id) REFERENCES sipd_jadwal(id) ON DELETE CASCADE
    )
  `)
}
