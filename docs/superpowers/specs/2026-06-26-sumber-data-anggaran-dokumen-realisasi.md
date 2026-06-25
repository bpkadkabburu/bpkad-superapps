# Sumber Data: Anggaran Rekap & Dokumen Realisasi

**Date:** 2026-06-26
**Status:** Approved

## Context

Sistem membutuhkan dua sumber data baru sebagai fondasi monitoring anggaran:

1. **Anggaran Rekap** — upload dari rekap5.xlsx (atau rekap4), berisi pagu per sub kegiatan + paket/kelompok + sumber dana per rekening belanja, semua SKPD.
2. **Dokumen Realisasi** — upload dari Laporan Realisasi Per Dokumen.xlsx, berisi transaksi realisasi atomik per SP2D, detail sampai nomor SPD/SPP/SPM/SP2D.

Menu **Paket Anggaran** yang lama dihapus sepenuhnya (tabel + route + view + sidebar).

---

## Database — Migration 005

### Drop

```sql
DROP TABLE IF EXISTS paket_anggaran;
```

### Tabel `anggaran_rekap`

Semua 23 kolom dari rekap5. Upload = delete semua milik `user_id + tahun_id`, lalu insert batch baru.

```sql
CREATE TABLE anggaran_rekap (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  user_id              INT NOT NULL,
  tahun_id             INT NOT NULL,
  no                   INT,
  tahun_file           INT,
  kode_urusan          VARCHAR(20),
  nama_urusan          VARCHAR(255),
  kode_skpd            VARCHAR(50),
  nama_skpd            VARCHAR(255),
  kode_sub_unit        VARCHAR(50),
  nama_sub_unit        VARCHAR(255),
  kode_bidang_urusan   VARCHAR(20),
  nama_bidang_urusan   VARCHAR(255),
  kode_program         VARCHAR(50),
  nama_program         VARCHAR(255),
  kode_kegiatan        VARCHAR(50),
  nama_kegiatan        VARCHAR(500),
  kode_sub_kegiatan    VARCHAR(50),
  nama_sub_kegiatan    VARCHAR(500),
  kode_sumber_dana     VARCHAR(50),
  nama_sumber_dana     VARCHAR(255),
  kode_rekening        VARCHAR(50),
  nama_rekening        VARCHAR(500),
  paket_kelompok       VARCHAR(50),
  nama_paket_kelompok  VARCHAR(500),
  pagu                 BIGINT DEFAULT 0,
  uploaded_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
);
```

**Parser notes:**
- Header di row 1
- Skip baris yang `KODE REKENING` null/kosong (baris hierarchy header di Excel)
- Mapping header Excel → kolom DB:

| Header Excel        | Kolom DB            |
|---------------------|---------------------|
| NO                  | no                  |
| TAHUN               | tahun_file          |
| KODE URUSAN         | kode_urusan         |
| NAMA URUSAN         | nama_urusan         |
| KODE SKPD           | kode_skpd           |
| NAMA SKPD           | nama_skpd           |
| KODE SUB UNIT       | kode_sub_unit       |
| NAMA SUB UNIT       | nama_sub_unit       |
| KODE BIDANG URUSAN  | kode_bidang_urusan  |
| NAMA BIDANG URUSAN  | nama_bidang_urusan  |
| KODE PROGRAM        | kode_program        |
| NAMA PROGRAM        | nama_program        |
| KODE KEGIATAN       | kode_kegiatan       |
| NAMA KEGIATAN       | nama_kegiatan       |
| KODE SUB KEGIATAN   | kode_sub_kegiatan   |
| NAMA SUB KEGIATAN   | nama_sub_kegiatan   |
| KODE SUMBER DANA    | kode_sumber_dana    |
| NAMA SUMBER DANA    | nama_sumber_dana    |
| KODE REKENING       | kode_rekening       |
| NAMA REKENING       | nama_rekening       |
| PAKET/KELOMPOK      | paket_kelompok      |
| NAMA PAKET/KELOMPOK | nama_paket_kelompok |
| PAGU                | pagu                |

---

### Tabel `dokumen_realisasi`

Semua 45 kolom dari Laporan Realisasi Per Dokumen. Upload = delete semua milik `user_id + tahun_id`, lalu insert batch baru.

```sql
CREATE TABLE dokumen_realisasi (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  user_id                  INT NOT NULL,
  tahun_id                 INT NOT NULL,
  kode_skpd                VARCHAR(50),
  nama_skpd                VARCHAR(255),
  kode_sub_skpd            VARCHAR(50),
  nama_sub_skpd            VARCHAR(255),
  kode_fungsi              VARCHAR(20),
  nama_fungsi              VARCHAR(255),
  kode_sub_fungsi          VARCHAR(20),
  nama_sub_fungsi          VARCHAR(255),
  kode_urusan              VARCHAR(20),
  nama_urusan              VARCHAR(255),
  kode_bidang_urusan       VARCHAR(20),
  nama_bidang_urusan       VARCHAR(255),
  kode_program             VARCHAR(50),
  nama_program             VARCHAR(255),
  kode_kegiatan            VARCHAR(50),
  nama_kegiatan            VARCHAR(500),
  kode_sub_kegiatan        VARCHAR(50),
  nama_sub_kegiatan        VARCHAR(500),
  kode_rekening            VARCHAR(50),
  nama_rekening            VARCHAR(500),
  nomor_dokumen            VARCHAR(100),
  jenis_dokumen            VARCHAR(50),
  jenis_transaksi          VARCHAR(50),
  nomor_dpt                VARCHAR(100),
  tanggal_dokumen          VARCHAR(50),
  keterangan_dokumen       TEXT,
  nilai_realisasi          BIGINT DEFAULT 0,
  nilai_setoran            BIGINT DEFAULT 0,
  nip_pegawai              VARCHAR(30),
  nama_pegawai             VARCHAR(255),
  tanggal_simpan           VARCHAR(50),
  nomor_spd                VARCHAR(100),
  periode_spd              VARCHAR(100),
  nilai_spd                BIGINT DEFAULT 0,
  tahapan_spd              VARCHAR(100),
  nama_sub_tahapan_jadwal  VARCHAR(255),
  tahapan_apbd             VARCHAR(100),
  nomor_spp                VARCHAR(100),
  tanggal_spp              VARCHAR(50),
  nomor_spm                VARCHAR(100),
  tanggal_spm              VARCHAR(50),
  nomor_sp2d               VARCHAR(100),
  tanggal_sp2d             VARCHAR(50),
  tanggal_transfer         VARCHAR(50),
  nilai_sp2d               BIGINT DEFAULT 0,
  uploaded_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tahun_id) REFERENCES tahun_anggaran(id) ON DELETE CASCADE
);
```

**Parser notes:**
- Baris 1–4 adalah metadata (judul laporan, nama kabupaten, tahun, baris kosong) — skip
- Row 5 adalah header kolom
- Data mulai row 6
- Kolom tanggal disimpan sebagai VARCHAR karena format bervariasi dari Excel ("7 Januari 2026", dll)
- Mapping header Excel → kolom DB:

| Header Excel              | Kolom DB                  |
|---------------------------|---------------------------|
| Kode SKPD                 | kode_skpd                 |
| Nama SKPD                 | nama_skpd                 |
| Kode Sub SKPD             | kode_sub_skpd             |
| Nama Sub SKPD             | nama_sub_skpd             |
| Kode Fungsi               | kode_fungsi               |
| Nama Fungsi               | nama_fungsi               |
| Kode Sub Fungsi           | kode_sub_fungsi           |
| Nama Sub Fungsi           | nama_sub_fungsi           |
| Kode Urusan               | kode_urusan               |
| Nama Urusan               | nama_urusan               |
| Kode Bidang Urusan        | kode_bidang_urusan        |
| Nama Bidang Urusan        | nama_bidang_urusan        |
| Kode Program              | kode_program              |
| Nama Program              | nama_program              |
| Kode Kegiatan             | kode_kegiatan             |
| Nama Kegiatan             | nama_kegiatan             |
| Kode Sub Kegiatan         | kode_sub_kegiatan         |
| Nama Sub Kegiatan         | nama_sub_kegiatan         |
| Kode Rekening             | kode_rekening             |
| Nama Rekening             | nama_rekening             |
| Nomor Dokumen             | nomor_dokumen             |
| Jenis Dokumen             | jenis_dokumen             |
| Jenis Transaksi           | jenis_transaksi           |
| Nomor DPT                 | nomor_dpt                 |
| Tanggal Dokumen           | tanggal_dokumen           |
| Keterangan Dokumen        | keterangan_dokumen        |
| Nilai Realisasi           | nilai_realisasi           |
| Nilai Setoran             | nilai_setoran             |
| NIP Pegawai               | nip_pegawai               |
| Nama Pegawai              | nama_pegawai              |
| Tanggal Simpan            | tanggal_simpan            |
| Nomor SPD                 | nomor_spd                 |
| Periode SPD               | periode_spd               |
| Nilai SPD                 | nilai_spd                 |
| Tahapan SPD               | tahapan_spd               |
| Nama Sub Tahapan Jadwal   | nama_sub_tahapan_jadwal   |
| Tahapan APBD              | tahapan_apbd              |
| Nomor SPP                 | nomor_spp                 |
| Tanggal SPP               | tanggal_spp               |
| Nomor SPM                 | nomor_spm                 |
| Tanggal SPM               | tanggal_spm               |
| Nomor SP2D                | nomor_sp2d                |
| Tanggal SP2D              | tanggal_sp2d              |
| Tanggal Transfer          | tanggal_transfer          |
| Nilai SP2D                | nilai_sp2d                |

---

## API Routes

### File baru: `api/src/routes/anggaranRekap.js`

```
GET    /api/sumber-data/anggaran?tahun=2026   → list semua rows milik user + tahun
POST   /api/sumber-data/anggaran              → { data: [...], tahun: "2026" } — delete+insert
DELETE /api/sumber-data/anggaran?tahun=2026   → hapus semua milik user + tahun
```

### File baru: `api/src/routes/dokumenRealisasi.js`

```
GET    /api/sumber-data/dokumen-realisasi?tahun=2026
POST   /api/sumber-data/dokumen-realisasi     → { data: [...], tahun: "2026" }
DELETE /api/sumber-data/dokumen-realisasi?tahun=2026
```

### Daftarkan di `api/src/index.js`

```js
app.route('/api/sumber-data/anggaran', anggaranRekap)
app.route('/api/sumber-data/dokumen-realisasi', dokumenRealisasiRoutes)
```

### Hapus dari `api/src/index.js`

```js
// Hapus:
import paketRoutes from './routes/paket.js'
app.route('/api/paket-anggaran', paketRoutes)
```

---

## Frontend

### Router (`src/router/index.js`)

- Hapus route `paket-anggaran`
- Tambah di bawah `tahun/:tahun/children`:

```js
{
  path: 'sumber-data',
  children: [
    { path: 'anggaran', name: 'AnggaranRekap', component: () => import('../views/AnggaranRekapView.vue') },
    { path: 'dokumen-realisasi', name: 'DokumenRealisasi', component: () => import('../views/DokumenRealisasiView.vue') }
  ]
}
```

### Sidebar (`src/views/LayoutView.vue`)

- Hapus `el-menu-item` Paket Anggaran
- Hapus import icon `Folder`
- Tambah sub-menu "Sumber Data" dengan icon `FolderOpened`:

```
Sumber Data
  ├── Anggaran Rekap   → /tahun/:tahun/sumber-data/anggaran
  └── Dokumen Realisasi → /tahun/:tahun/sumber-data/dokumen-realisasi
```

### View baru: `src/views/AnggaranRekapView.vue`

Pola identik SubkegiatanPMKView:
- Header: judul + row count + tombol Import Excel + tombol Hapus Semua
- Empty state jika belum ada data
- Search input (filter by kode_sub_kegiatan / nama_sub_kegiatan / kode_skpd / paket_kelompok)
- Tabel dengan kolom utama yang ditampilkan: No, Kode Sub Unit, Kode Sub Kegiatan, Nama Sub Kegiatan, Paket/Kelompok, Kode Rekening, Nama Rekening, Sumber Dana, Pagu
- Parser: header row 1, skip baris dengan `KODE REKENING` null/kosong

### View baru: `src/views/DokumenRealisasiView.vue`

Pola identik SubkegiatanPMKView:
- Header: judul + row count + tombol Import Excel + tombol Hapus Semua
- Empty state jika belum ada data
- Search input (filter by kode_sub_kegiatan / nomor_sp2d / kode_skpd / nomor_dokumen)
- Tabel dengan kolom utama: Kode Sub SKPD, Kode Sub Kegiatan, Nama Sub Kegiatan, Kode Rekening, Nomor Dokumen, Jenis Dokumen, Tanggal Dokumen, Nilai Realisasi, Nomor SP2D
- Parser: skip 4 baris awal, row 5 = header, data mulai row 6

---

## File yang Diubah / Dibuat

| Aksi   | File                                                       |
|--------|------------------------------------------------------------|
| Buat   | `api/migrations/005_sumber_data.js`                        |
| Buat   | `api/src/routes/anggaranRekap.js`                          |
| Buat   | `api/src/routes/dokumenRealisasi.js`                       |
| Ubah   | `api/src/index.js`                                         |
| Buat   | `src/views/AnggaranRekapView.vue`                          |
| Buat   | `src/views/DokumenRealisasiView.vue`                       |
| Ubah   | `src/router/index.js`                                      |
| Ubah   | `src/views/LayoutView.vue`                                 |
| Hapus  | `api/src/routes/paket.js` *(jika tidak dipakai di tempat lain)* |

---

## Out of Scope

- Menu kompilasi anggaran vs realisasi — menyusul setelah 2 menu ini selesai
- Filter/pagination server-side — data cukup kecil, filter client-side cukup
- Validasi format kode (kode_sub_kegiatan harus format X.XX.XX.X.XX.XXXX) — tidak dilakukan saat upload
