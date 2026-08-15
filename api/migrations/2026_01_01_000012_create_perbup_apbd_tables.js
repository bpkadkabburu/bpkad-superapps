export const name = '2026_01_01_000012_create_perbup_apbd_tables'

export async function up(db) {
  // Satu baris per dokumen dalam rantai. urutan 0 = dokumen dasar (APBD Murni atau
  // Penjabaran Perubahan APBD), 1..n = pergeseran P1, P2, dst.
  //
  // `baris` menyimpan SNAPSHOT LENGKAP rekening pada dokumen itu, bukan hanya yang
  // berubah — pembanding antar tahap adalah state, bukan kolom sebelum_perubahan.
  // `registry` hanya diisi pada urutan 0: peta kode -> nomor pasal dokumen dasar,
  // yang tidak boleh dinomori ulang selama rantai masih berjalan. Nomor pasal
  // sisipan tidak disimpan karena diturunkan ulang secara deterministik dari rantai.
  await db.query(`
    CREATE TABLE IF NOT EXISTS perbup_dokumen (
      id           CHAR(36)     NOT NULL DEFAULT (UUID()),
      tahun_id     CHAR(36)     NOT NULL,
      urutan       INT          NOT NULL,
      nama_file    VARCHAR(255) NOT NULL,
      kolom_nilai  VARCHAR(30)  NOT NULL,
      baris        JSON         NOT NULL,
      registry     JSON         NULL,
      created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_tahun_urutan (tahun_id, urutan),
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)

  // Identitas dokumen dan preferensi penyusunan, satu baris per tahun anggaran.
  await db.query(`
    CREATE TABLE IF NOT EXISTS perbup_pengaturan (
      tahun_id       CHAR(36)  NOT NULL,
      pasal_mulai    INT       NOT NULL DEFAULT 3,
      nomor_klausul  TINYINT(1) NOT NULL DEFAULT 0,
      meta           JSON      NULL,
      template_akun  JSON      NULL,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (tahun_id),
      FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
    )
  `)
}
