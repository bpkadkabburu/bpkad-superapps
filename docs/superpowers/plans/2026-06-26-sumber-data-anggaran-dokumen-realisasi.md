# Sumber Data: Anggaran Rekap & Dokumen Realisasi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah dua menu baru "Anggaran Rekap" dan "Dokumen Realisasi" sebagai sumber data upload, hapus menu Paket Anggaran yang lama.

**Architecture:** Setiap menu adalah fitur upload Excel → simpan ke tabel flat → tampilkan di tabel. Upload selalu replace-all (delete + insert batch). View parsing menggunakan ExcelJS client-side dengan header asli Excel sebagai key, API menggunakan FIELD_MAP untuk memetakan ke kolom DB. Pola identik dengan `realisasi.js` yang sudah ada.

**Tech Stack:** Vue 3, Element Plus, ExcelJS (sudah installed), Hono API, MySQL via mysql2, migration runner `npm run migrate` (dari `api/`)

## Global Constraints

- Semua route API di-prefix `/api/sumber-data/`
- Semua tabel baru punya `user_id` + `tahun_id` FK ke `users` dan `tahun_anggaran`
- Upload = DELETE milik user+tahun, lalu INSERT batch 200 rows per query
- Migrate command: jalankan dari folder `api/` → `npm run migrate`
- File routes menggunakan ES module (`export default router`)
- Kolom tanggal disimpan sebagai VARCHAR karena format "7 Januari 2026" dari Excel
- FIELD_MAP di API menggunakan exact header string dari Excel sebagai key (termasuk spasi dan casing asli)

---

## File yang Diubah / Dibuat

| Aksi   | File                                                           |
|--------|----------------------------------------------------------------|
| Buat   | `api/migrations/005_sumber_data.js`                            |
| Buat   | `api/src/routes/anggaranRekap.js`                              |
| Buat   | `api/src/routes/dokumenRealisasi.js`                           |
| Ubah   | `api/src/index.js`                                             |
| Hapus  | `api/src/routes/paket.js`                                      |
| Buat   | `src/views/AnggaranRekapView.vue`                              |
| Buat   | `src/views/DokumenRealisasiView.vue`                           |
| Ubah   | `src/router/index.js`                                          |
| Ubah   | `src/views/LayoutView.vue`                                     |

---

### Task 1: Migration 005 — Drop paket_anggaran, buat anggaran_rekap dan dokumen_realisasi

**Files:**
- Create: `api/migrations/005_sumber_data.js`

**Interfaces:**
- Produces: tabel `anggaran_rekap` dan `dokumen_realisasi` di DB; `paket_anggaran` di-drop

- [ ] **Step 1: Buat file migration**

Buat `api/migrations/005_sumber_data.js`:

```js
export const name = '005_sumber_data'

export async function up(db) {
  await db.query(`DROP TABLE IF EXISTS paket_anggaran`)

  await db.query(`
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
    )
  `)

  await db.query(`
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
    )
  `)
}
```

- [ ] **Step 2: Jalankan migration**

```bash
cd api && npm run migrate
```

Expected output:
```
  skip  001_initial_schema
  skip  002_tahun_anggaran
  skip  003_realisasi_rows
  skip  004_referensi
  run   005_sumber_data ... OK

1 migration(s) applied.
```

- [ ] **Step 3: Verifikasi tabel di DB**

```bash
cd api && node -e "
import('./src/db.js').then(async ({default: db}) => {
  const [r] = await db.query('SHOW TABLES LIKE \"%anggaran%\"')
  console.log('anggaran_rekap:', r)
  const [r2] = await db.query('SHOW TABLES LIKE \"%dokumen%\"')
  console.log('dokumen_realisasi:', r2)
  const [r3] = await db.query('SHOW TABLES LIKE \"%paket%\"')
  console.log('paket_anggaran (should be empty):', r3)
  process.exit(0)
})"
```

Expected: `anggaran_rekap` dan `dokumen_realisasi` ada, `paket_anggaran` tidak ada.

- [ ] **Step 4: Commit**

```bash
git add api/migrations/005_sumber_data.js
git commit -m "feat: migration 005 — add anggaran_rekap and dokumen_realisasi tables"
```

---

### Task 2: API — Route anggaranRekap

**Files:**
- Create: `api/src/routes/anggaranRekap.js`
- Modify: `api/src/index.js`

**Interfaces:**
- Consumes: tabel `anggaran_rekap` dari Task 1
- Produces:
  - `GET /api/sumber-data/anggaran?tahun=YYYY` → `{ data: [...] }`
  - `POST /api/sumber-data/anggaran` body `{ data: [...rows with original Excel keys], tahun: "2026" }` → `{ success: true, inserted: N }`
  - `DELETE /api/sumber-data/anggaran?tahun=YYYY` → `{ success: true }`

- [ ] **Step 1: Buat api/src/routes/anggaranRekap.js**

```js
import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

const FIELD_MAP = {
  'NO':                   'no',
  'TAHUN':                'tahun_file',
  'KODE URUSAN':          'kode_urusan',
  'NAMA URUSAN':          'nama_urusan',
  'KODE SKPD':            'kode_skpd',
  'NAMA SKPD':            'nama_skpd',
  'KODE SUB UNIT':        'kode_sub_unit',
  'NAMA SUB UNIT':        'nama_sub_unit',
  'KODE BIDANG URUSAN':   'kode_bidang_urusan',
  'NAMA BIDANG URUSAN':   'nama_bidang_urusan',
  'KODE PROGRAM':         'kode_program',
  'NAMA PROGRAM':         'nama_program',
  'KODE KEGIATAN':        'kode_kegiatan',
  'NAMA KEGIATAN':        'nama_kegiatan',
  'KODE SUB KEGIATAN':    'kode_sub_kegiatan',
  'NAMA SUB KEGIATAN':    'nama_sub_kegiatan',
  'KODE SUMBER DANA':     'kode_sumber_dana',
  'NAMA SUMBER DANA':     'nama_sumber_dana',
  'KODE REKENING':        'kode_rekening',
  'NAMA REKENING':        'nama_rekening',
  'PAKET/KELOMPOK':       'paket_kelompok',
  'NAMA PAKET/KELOMPOK':  'nama_paket_kelompok',
  'PAGU':                 'pagu',
}

const cols = Object.values(FIELD_MAP)

router.get('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT ar.*
     FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ar.user_id = ? AND ta.tahun = ?
     ORDER BY ar.no`,
    [user.id, tahun]
  )
  return c.json({ data: rows })
})

router.post('/', async (c) => {
  const user = c.get('user')
  const { data, tahun } = await c.req.json()

  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const [taRows] = await db.query(
    'SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun]
  )
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  await db.query(
    'DELETE FROM anggaran_rekap WHERE user_id = ? AND tahun_id = ?',
    [user.id, tahun_id]
  )

  const placeholders = cols.map(() => '?').join(', ')
  const BATCH = 200
  for (let i = 0; i < data.length; i += BATCH) {
    const chunk = data.slice(i, i + BATCH)
    const rowPlaceholders = chunk.map(() => `(?, ?, ${placeholders})`).join(', ')
    const values = chunk.flatMap(row => [
      user.id,
      tahun_id,
      ...Object.entries(FIELD_MAP).map(([excelKey]) => {
        const val = row[excelKey] ?? null
        return val === '' ? null : val
      }),
    ])
    await db.query(
      `INSERT INTO anggaran_rekap (user_id, tahun_id, ${cols.join(', ')}) VALUES ${rowPlaceholders}`,
      values
    )
  }

  return c.json({ success: true, inserted: data.length })
})

router.delete('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  await db.query(
    `DELETE ar FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ar.user_id = ? AND ta.tahun = ?`,
    [user.id, tahun]
  )
  return c.json({ success: true })
})

export default router
```

- [ ] **Step 2: Update api/src/index.js — tambah anggaranRekap, hapus paket**

Isi lengkap `api/src/index.js` setelah perubahan:

```js
import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth.js'
import realisasiRoutes from './routes/realisasi.js'
import subkegiatanPmkRoutes from './routes/subkegiatanPmk.js'
import tahunAnggaranRoutes from './routes/tahunAnggaran.js'
import anggaranRekapRoutes from './routes/anggaranRekap.js'

const app = new Hono()

app.use('*', cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}))

app.route('/api/auth', authRoutes)
app.route('/api/tahun-anggaran', tahunAnggaranRoutes)
app.route('/api/realisasi', realisasiRoutes)
app.route('/api/referensi/subkegiatan-pmk', subkegiatanPmkRoutes)
app.route('/api/sumber-data/anggaran', anggaranRekapRoutes)

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('API running on http://localhost:3001')
})
```

Catatan: route `/api/sumber-data/dokumen-realisasi` akan ditambah di Task 3.

- [ ] **Step 3: Commit**

```bash
git add api/src/routes/anggaranRekap.js api/src/index.js
git commit -m "feat: add anggaranRekap API route, remove paket-anggaran route"
```

---

### Task 3: API — Route dokumenRealisasi + hapus paket.js

**Files:**
- Create: `api/src/routes/dokumenRealisasi.js`
- Modify: `api/src/index.js`
- Delete: `api/src/routes/paket.js`

**Interfaces:**
- Consumes: tabel `dokumen_realisasi` dari Task 1
- Produces:
  - `GET /api/sumber-data/dokumen-realisasi?tahun=YYYY` → `{ data: [...] }`
  - `POST /api/sumber-data/dokumen-realisasi` body `{ data: [...rows with original Excel keys], tahun: "2026" }` → `{ success: true, inserted: N }`
  - `DELETE /api/sumber-data/dokumen-realisasi?tahun=YYYY` → `{ success: true }`

- [ ] **Step 1: Buat api/src/routes/dokumenRealisasi.js**

```js
import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

const FIELD_MAP = {
  'Kode SKPD':               'kode_skpd',
  'Nama SKPD':               'nama_skpd',
  'Kode Sub SKPD':           'kode_sub_skpd',
  'Nama Sub SKPD':           'nama_sub_skpd',
  'Kode Fungsi':             'kode_fungsi',
  'Nama Fungsi':             'nama_fungsi',
  'Kode Sub Fungsi':         'kode_sub_fungsi',
  'Nama Sub Fungsi':         'nama_sub_fungsi',
  'Kode Urusan':             'kode_urusan',
  'Nama Urusan':             'nama_urusan',
  'Kode Bidang Urusan':      'kode_bidang_urusan',
  'Nama Bidang Urusan':      'nama_bidang_urusan',
  'Kode Program':            'kode_program',
  'Nama Program':            'nama_program',
  'Kode Kegiatan':           'kode_kegiatan',
  'Nama Kegiatan':           'nama_kegiatan',
  'Kode Sub Kegiatan':       'kode_sub_kegiatan',
  'Nama Sub Kegiatan':       'nama_sub_kegiatan',
  'Kode Rekening':           'kode_rekening',
  'Nama Rekening':           'nama_rekening',
  'Nomor Dokumen':           'nomor_dokumen',
  'Jenis Dokumen':           'jenis_dokumen',
  'Jenis Transaksi':         'jenis_transaksi',
  'Nomor DPT':               'nomor_dpt',
  'Tanggal Dokumen':         'tanggal_dokumen',
  'Keterangan Dokumen':      'keterangan_dokumen',
  'Nilai Realisasi':         'nilai_realisasi',
  'Nilai Setoran':           'nilai_setoran',
  'NIP Pegawai':             'nip_pegawai',
  'Nama Pegawai':            'nama_pegawai',
  'Tanggal Simpan':          'tanggal_simpan',
  'Nomor SPD':               'nomor_spd',
  'Periode SPD':             'periode_spd',
  'Nilai SPD':               'nilai_spd',
  'Tahapan SPD':             'tahapan_spd',
  'Nama Sub Tahapan Jadwal': 'nama_sub_tahapan_jadwal',
  'Tahapan APBD':            'tahapan_apbd',
  'Nomor SPP':               'nomor_spp',
  'Tanggal SPP':             'tanggal_spp',
  'Nomor SPM':               'nomor_spm',
  'Tanggal SPM':             'tanggal_spm',
  'Nomor SP2D':              'nomor_sp2d',
  'Tanggal SP2D':            'tanggal_sp2d',
  'Tanggal Transfer':        'tanggal_transfer',
  'Nilai SP2D':              'nilai_sp2d',
}

const cols = Object.values(FIELD_MAP)

router.get('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT dr.*
     FROM dokumen_realisasi dr
     INNER JOIN tahun_anggaran ta ON dr.tahun_id = ta.id
     WHERE dr.user_id = ? AND ta.tahun = ?
     ORDER BY dr.id`,
    [user.id, tahun]
  )
  return c.json({ data: rows })
})

router.post('/', async (c) => {
  const user = c.get('user')
  const { data, tahun } = await c.req.json()

  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const [taRows] = await db.query(
    'SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun]
  )
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  await db.query(
    'DELETE FROM dokumen_realisasi WHERE user_id = ? AND tahun_id = ?',
    [user.id, tahun_id]
  )

  const placeholders = cols.map(() => '?').join(', ')
  const BATCH = 100
  for (let i = 0; i < data.length; i += BATCH) {
    const chunk = data.slice(i, i + BATCH)
    const rowPlaceholders = chunk.map(() => `(?, ?, ${placeholders})`).join(', ')
    const values = chunk.flatMap(row => [
      user.id,
      tahun_id,
      ...Object.entries(FIELD_MAP).map(([excelKey]) => {
        const val = row[excelKey] ?? null
        return val === '' ? null : val
      }),
    ])
    await db.query(
      `INSERT INTO dokumen_realisasi (user_id, tahun_id, ${cols.join(', ')}) VALUES ${rowPlaceholders}`,
      values
    )
  }

  return c.json({ success: true, inserted: data.length })
})

router.delete('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  await db.query(
    `DELETE dr FROM dokumen_realisasi dr
     INNER JOIN tahun_anggaran ta ON dr.tahun_id = ta.id
     WHERE dr.user_id = ? AND ta.tahun = ?`,
    [user.id, tahun]
  )
  return c.json({ success: true })
})

export default router
```

- [ ] **Step 2: Update api/src/index.js — tambah dokumenRealisasi**

Isi lengkap `api/src/index.js`:

```js
import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth.js'
import realisasiRoutes from './routes/realisasi.js'
import subkegiatanPmkRoutes from './routes/subkegiatanPmk.js'
import tahunAnggaranRoutes from './routes/tahunAnggaran.js'
import anggaranRekapRoutes from './routes/anggaranRekap.js'
import dokumenRealisasiRoutes from './routes/dokumenRealisasi.js'

const app = new Hono()

app.use('*', cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}))

app.route('/api/auth', authRoutes)
app.route('/api/tahun-anggaran', tahunAnggaranRoutes)
app.route('/api/realisasi', realisasiRoutes)
app.route('/api/referensi/subkegiatan-pmk', subkegiatanPmkRoutes)
app.route('/api/sumber-data/anggaran', anggaranRekapRoutes)
app.route('/api/sumber-data/dokumen-realisasi', dokumenRealisasiRoutes)

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('API running on http://localhost:3001')
})
```

- [ ] **Step 3: Hapus api/src/routes/paket.js**

```bash
rm api/src/routes/paket.js
```

- [ ] **Step 4: Commit**

```bash
git add api/src/routes/dokumenRealisasi.js api/src/index.js
git rm api/src/routes/paket.js
git commit -m "feat: add dokumenRealisasi API route, remove paket.js"
```

---

### Task 4: Frontend — Router + Sidebar

**Files:**
- Modify: `src/router/index.js`
- Modify: `src/views/LayoutView.vue`

**Interfaces:**
- Consumes: —
- Produces: route `/tahun/:tahun/sumber-data/anggaran` dan `/tahun/:tahun/sumber-data/dokumen-realisasi`; sidebar dengan sub-menu "Sumber Data"

- [ ] **Step 1: Update src/router/index.js**

Isi lengkap setelah perubahan:

```js
// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/',
    component: () => import('../views/LayoutView.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'SelectYear',
        component: () => import('../views/SelectYearView.vue')
      },
      {
        path: 'tahun/:tahun',
        children: [
          {
            path: '',
            name: 'Home',
            component: () => import('../views/HomeView.vue')
          },
          {
            path: 'referensi',
            children: [
              {
                path: 'subkegiatan-pmk',
                name: 'SubkegiatanPMK',
                component: () => import('../views/SubkegiatanPMKView.vue')
              }
            ]
          },
          {
            path: 'realisasi',
            name: 'Realisasi',
            component: () => import('../views/RealisasiView.vue')
          },
          {
            path: 'sumber-data',
            children: [
              {
                path: 'anggaran',
                name: 'AnggaranRekap',
                component: () => import('../views/AnggaranRekapView.vue')
              },
              {
                path: 'dokumen-realisasi',
                name: 'DokumenRealisasi',
                component: () => import('../views/DokumenRealisasiView.vue')
              }
            ]
          }
        ]
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth !== false && !auth.isLoggedIn) {
    return { name: 'Login' }
  }

  if (to.meta.requiresSuperadmin && auth.user?.role !== 'superadmin') {
    return { name: 'SelectYear' }
  }
})

export default router
```

- [ ] **Step 2: Update src/views/LayoutView.vue**

Isi lengkap setelah perubahan:

```vue
<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { HomeFilled, DataAnalysis, TrendCharts, Document, FolderOpened } from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const tahun = computed(() => route.params.tahun)

const activeMenu = computed(() => route.path)

function logout() {
  auth.logout()
  router.push('/login')
}

function gantiTahun() {
  router.push({ name: 'SelectYear' })
}
</script>

<template>
  <el-container style="min-height: 100vh;">
    <el-header style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #fff;
      border-bottom: 1px solid #e4e7ed;
      position: sticky;
      top: 0;
      z-index: 100;
    ">
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-weight: 700; font-size: 16px; color: #303133;">BPKAD Superapps</span>
        <el-tag v-if="tahun" type="success" size="small">TA {{ tahun }}</el-tag>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 13px; color: #606266;">{{ auth.user?.username }}</span>
        <el-tag size="small" :type="auth.isSuperadmin ? 'danger' : 'info'">
          {{ auth.isSuperadmin ? 'Superadmin' : 'User' }}
        </el-tag>
        <el-button v-if="tahun" size="small" plain @click="gantiTahun">Ganti Tahun</el-button>
        <el-button size="small" @click="logout">Logout</el-button>
      </div>
    </el-header>

    <el-container style="height: calc(100vh - 60px); overflow: hidden;">
      <el-aside
        v-if="tahun"
        width="200px"
        style="
          background: #fff;
          border-right: 1px solid #e4e7ed;
          height: 100%;
          overflow-y: auto;
          flex-shrink: 0;
        "
      >
        <el-menu
          :default-active="activeMenu"
          router
          style="border-right: none; height: 100%;"
        >
          <el-menu-item :index="`/tahun/${tahun}`">
            <el-icon><HomeFilled /></el-icon>
            <span>Beranda</span>
          </el-menu-item>
          <el-sub-menu index="referensi">
            <template #title>
              <el-icon><DataAnalysis /></el-icon>
              <span>Referensi</span>
            </template>
            <el-menu-item :index="`/tahun/${tahun}/referensi/subkegiatan-pmk`">
              <el-icon><Document /></el-icon>
              <span>Subkegiatan PMK</span>
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item :index="`/tahun/${tahun}/realisasi`">
            <el-icon><TrendCharts /></el-icon>
            <span>Realisasi</span>
          </el-menu-item>
          <el-sub-menu index="sumber-data">
            <template #title>
              <el-icon><FolderOpened /></el-icon>
              <span>Sumber Data</span>
            </template>
            <el-menu-item :index="`/tahun/${tahun}/sumber-data/anggaran`">
              <el-icon><Document /></el-icon>
              <span>Anggaran Rekap</span>
            </el-menu-item>
            <el-menu-item :index="`/tahun/${tahun}/sumber-data/dokumen-realisasi`">
              <el-icon><Document /></el-icon>
              <span>Dokumen Realisasi</span>
            </el-menu-item>
          </el-sub-menu>
        </el-menu>
      </el-aside>

      <el-main style="background: #f0f2f5; padding: 24px 28px; overflow-y: auto; height: 100%;">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>
```

- [ ] **Step 3: Commit**

```bash
git add src/router/index.js src/views/LayoutView.vue
git commit -m "feat: update router and sidebar — add Sumber Data submenu, remove Paket Anggaran"
```

---

### Task 5: Frontend — AnggaranRekapView.vue

**Files:**
- Create: `src/views/AnggaranRekapView.vue`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/sumber-data/anggaran` dari Task 2
- Produces: view yang bisa upload rekap5.xlsx, tampilkan tabel, hapus semua

Parser logic:
- Header di row 1 Excel, ambil exact string sebagai key
- Iterasi row dari row 2
- Skip baris yang `row['KODE REKENING']` null atau kosong
- Kirim ke API dengan exact Excel header sebagai key (`{ 'KODE REKENING': '5.1.01...', 'PAGU': 666000, ... }`)

- [ ] **Step 1: Buat src/views/AnggaranRekapView.vue**

```vue
<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import ExcelJS from 'exceljs'
import { Upload, Delete, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../utils/api.js'

const rawData = ref([])
const search = ref('')
const route = useRoute()
const tahun = computed(() => route.params.tahun)

onMounted(async () => {
  try {
    const { data } = await api.get('/sumber-data/anggaran', { params: { tahun: tahun.value } })
    rawData.value = data.data
  } catch {
    rawData.value = []
  }
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rawData.value
  return rawData.value.filter(r =>
    r.kode_sub_kegiatan?.toLowerCase().includes(q) ||
    r.nama_sub_kegiatan?.toLowerCase().includes(q) ||
    r.kode_sub_unit?.toLowerCase().includes(q) ||
    r.paket_kelompok?.toLowerCase().includes(q) ||
    r.nama_paket_kelompok?.toLowerCase().includes(q)
  )
})

async function handleFileImport(uploadFile) {
  if (!uploadFile.raw) return false

  const buffer = await uploadFile.raw.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) {
    ElMessage.error('Sheet tidak ditemukan dalam file Excel')
    return false
  }

  // Ambil header dari row 1, simpan exact string sebagai key
  const colMap = {}
  ws.getRow(1).eachCell((cell, colNum) => {
    const key = String(cell.value ?? '').trim()
    if (key) colMap[key] = colNum
  })

  if (!colMap['KODE REKENING']) {
    ElMessage.error('Kolom "KODE REKENING" tidak ditemukan. Pastikan file adalah rekap anggaran yang benar.')
    return false
  }

  const rows = []
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    // Skip baris hierarchy (tanpa kode rekening)
    const kodeRek = row.getCell(colMap['KODE REKENING']).value
    if (!kodeRek) return

    const obj = {}
    Object.entries(colMap).forEach(([header, colNum]) => {
      const val = row.getCell(colNum).value
      obj[header] = val == null ? null : val
    })
    rows.push(obj)
  })

  if (!rows.length) {
    ElMessage.warning('Tidak ada baris data rekening yang ditemukan')
    return false
  }

  try {
    await api.post('/sumber-data/anggaran', { data: rows, tahun: tahun.value })
    const { data } = await api.get('/sumber-data/anggaran', { params: { tahun: tahun.value } })
    rawData.value = data.data
    ElMessage.success(`${rows.length} baris anggaran berhasil diimport`)
  } catch {
    ElMessage.error('Gagal menyimpan data ke server')
  }

  return false
}

async function clearData() {
  try {
    await ElMessageBox.confirm(
      'Semua data anggaran rekap akan dihapus. Lanjutkan?',
      'Konfirmasi Hapus',
      { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
    )
  } catch {
    return
  }
  await api.delete('/sumber-data/anggaran', { params: { tahun: tahun.value } })
  rawData.value = []
  ElMessage.success('Data berhasil dihapus')
}
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Anggaran Rekap</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          {{ rawData.length }} baris &bull; Sumber: file rekap anggaran (rekap4/rekap5)
        </p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".xlsx,.xls"
          :on-change="handleFileImport"
        >
          <el-button type="primary" :icon="Upload">Import Excel</el-button>
        </el-upload>
        <el-button type="danger" :icon="Delete" :disabled="rawData.length === 0" @click="clearData">
          Hapus Semua
        </el-button>
      </div>
    </div>

    <el-empty
      v-if="rawData.length === 0"
      description="Belum ada data. Import file Excel rekap anggaran untuk memulai."
      :image-size="120"
    />

    <template v-else>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">
        <el-input
          v-model="search"
          placeholder="Cari kode sub kegiatan / nama / paket..."
          :prefix-icon="Search"
          clearable
          style="max-width:380px;"
        />
        <span style="font-size:12px; color:#909399;">{{ filtered.length }} baris ditampilkan</span>
      </div>

      <el-table
        :data="filtered"
        border
        stripe
        size="small"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
      >
        <el-table-column type="index" label="No" width="55" align="center" />
        <el-table-column label="Kode Sub Unit" prop="kode_sub_unit" width="200">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_unit }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Kode Sub Kegiatan" prop="kode_sub_kegiatan" width="170">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_kegiatan }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Sub Kegiatan" prop="nama_sub_kegiatan" min-width="220" show-overflow-tooltip />
        <el-table-column label="Paket/Kelompok" prop="paket_kelompok" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.paket_kelompok" size="small" type="info">{{ row.paket_kelompok }}</el-tag>
            <span v-else style="color:#c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column label="Kode Rekening" prop="kode_rekening" width="170">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_rekening }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Rekening" prop="nama_rekening" min-width="200" show-overflow-tooltip />
        <el-table-column label="Sumber Dana" prop="nama_sumber_dana" width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span style="font-size:12px;">{{ row.nama_sumber_dana || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Pagu" prop="pagu" width="150" align="right">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:12px; font-variant-numeric:tabular-nums;">
              {{ Number(row.pagu || 0).toLocaleString('id-ID') }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Verifikasi di browser**

1. Jalankan dev server: `npm run dev` (dari root project)
2. Login → pilih tahun → buka sidebar "Sumber Data" → klik "Anggaran Rekap"
3. Upload file `rekapver5.xlsx`
4. Verifikasi: row count tampil di subheader, tabel terisi, angka pagu terformat dengan titik ribuan
5. Coba search → filter berjalan
6. Klik "Hapus Semua" → konfirmasi → tabel kosong
7. Import ulang → data muncul kembali

- [ ] **Step 3: Commit**

```bash
git add src/views/AnggaranRekapView.vue
git commit -m "feat: add AnggaranRekapView with Excel import and table preview"
```

---

### Task 6: Frontend — DokumenRealisasiView.vue

**Files:**
- Create: `src/views/DokumenRealisasiView.vue`

**Interfaces:**
- Consumes: `GET/POST/DELETE /api/sumber-data/dokumen-realisasi` dari Task 3
- Produces: view yang bisa upload Laporan Realisasi Per Dokumen.xlsx

Parser logic:
- Rows 1–4 adalah metadata (judul, nama kab, tahun, kosong) — skip
- Row 5 adalah header kolom — ambil exact string sebagai key
- Data mulai row 6
- Kirim ke API dengan exact Excel header sebagai key (`{ 'Kode SKPD': '...', 'Nilai Realisasi': 14759859, ... }`)

- [ ] **Step 1: Buat src/views/DokumenRealisasiView.vue**

```vue
<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import ExcelJS from 'exceljs'
import { Upload, Delete, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../utils/api.js'

const rawData = ref([])
const search = ref('')
const route = useRoute()
const tahun = computed(() => route.params.tahun)

onMounted(async () => {
  try {
    const { data } = await api.get('/sumber-data/dokumen-realisasi', { params: { tahun: tahun.value } })
    rawData.value = data.data
  } catch {
    rawData.value = []
  }
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rawData.value
  return rawData.value.filter(r =>
    r.kode_sub_kegiatan?.toLowerCase().includes(q) ||
    r.nomor_dokumen?.toLowerCase().includes(q) ||
    r.nomor_sp2d?.toLowerCase().includes(q) ||
    r.kode_sub_skpd?.toLowerCase().includes(q)
  )
})

async function handleFileImport(uploadFile) {
  if (!uploadFile.raw) return false

  const buffer = await uploadFile.raw.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) {
    ElMessage.error('Sheet tidak ditemukan dalam file Excel')
    return false
  }

  // Header ada di row 5, skip rows 1-4 (metadata)
  const colMap = {}
  ws.getRow(5).eachCell((cell, colNum) => {
    const key = String(cell.value ?? '').trim()
    if (key) colMap[key] = colNum
  })

  if (!colMap['Kode Sub Kegiatan']) {
    ElMessage.error('Kolom "Kode Sub Kegiatan" tidak ditemukan. Pastikan file adalah Laporan Realisasi Per Dokumen yang benar.')
    return false
  }

  const rows = []
  ws.eachRow((row, rowNum) => {
    if (rowNum <= 5) return
    const obj = {}
    Object.entries(colMap).forEach(([header, colNum]) => {
      const val = row.getCell(colNum).value
      obj[header] = val == null ? null : val
    })
    // Skip baris kosong
    if (!obj['Kode Sub Kegiatan'] && !obj['Nomor Dokumen']) return
    rows.push(obj)
  })

  if (!rows.length) {
    ElMessage.warning('Tidak ada data yang ditemukan dalam file')
    return false
  }

  try {
    await api.post('/sumber-data/dokumen-realisasi', { data: rows, tahun: tahun.value })
    const { data } = await api.get('/sumber-data/dokumen-realisasi', { params: { tahun: tahun.value } })
    rawData.value = data.data
    ElMessage.success(`${rows.length} dokumen realisasi berhasil diimport`)
  } catch {
    ElMessage.error('Gagal menyimpan data ke server')
  }

  return false
}

async function clearData() {
  try {
    await ElMessageBox.confirm(
      'Semua data dokumen realisasi akan dihapus. Lanjutkan?',
      'Konfirmasi Hapus',
      { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
    )
  } catch {
    return
  }
  await api.delete('/sumber-data/dokumen-realisasi', { params: { tahun: tahun.value } })
  rawData.value = []
  ElMessage.success('Data berhasil dihapus')
}
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Dokumen Realisasi</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          {{ rawData.length }} dokumen &bull; Sumber: Laporan Realisasi Per Dokumen
        </p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".xlsx,.xls"
          :on-change="handleFileImport"
        >
          <el-button type="primary" :icon="Upload">Import Excel</el-button>
        </el-upload>
        <el-button type="danger" :icon="Delete" :disabled="rawData.length === 0" @click="clearData">
          Hapus Semua
        </el-button>
      </div>
    </div>

    <el-empty
      v-if="rawData.length === 0"
      description="Belum ada data. Import file Excel Laporan Realisasi Per Dokumen untuk memulai."
      :image-size="120"
    />

    <template v-else>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">
        <el-input
          v-model="search"
          placeholder="Cari kode sub kegiatan / nomor dokumen / nomor SP2D..."
          :prefix-icon="Search"
          clearable
          style="max-width:420px;"
        />
        <span style="font-size:12px; color:#909399;">{{ filtered.length }} baris ditampilkan</span>
      </div>

      <el-table
        :data="filtered"
        border
        stripe
        size="small"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
      >
        <el-table-column type="index" label="No" width="55" align="center" />
        <el-table-column label="Kode Sub SKPD" prop="kode_sub_skpd" width="200">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_skpd }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Kode Sub Kegiatan" prop="kode_sub_kegiatan" width="170">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_kegiatan }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Sub Kegiatan" prop="nama_sub_kegiatan" min-width="200" show-overflow-tooltip />
        <el-table-column label="Kode Rekening" prop="kode_rekening" width="170">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_rekening }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Jenis" prop="jenis_dokumen" width="70" align="center">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ row.jenis_dokumen }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Tanggal Dokumen" prop="tanggal_dokumen" width="140" />
        <el-table-column label="Keterangan" prop="keterangan_dokumen" min-width="200" show-overflow-tooltip />
        <el-table-column label="Nilai Realisasi" prop="nilai_realisasi" width="160" align="right">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:12px; font-variant-numeric:tabular-nums;">
              {{ Number(row.nilai_realisasi || 0).toLocaleString('id-ID') }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="Nomor SP2D" prop="nomor_sp2d" width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.nomor_sp2d || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </template>
  </div>
</template>
```

- [ ] **Step 2: Verifikasi di browser**

1. Buka sidebar "Sumber Data" → klik "Dokumen Realisasi"
2. Upload file `Laporan Realisasi Per Dokumen (2).xlsx`
3. Verifikasi: row count tampil (sekitar 1.475), tabel terisi
4. Cek kolom Nilai Realisasi — harus terformat dengan titik ribuan
5. Coba search "2.15" → filter ke Dinas Perhubungan saja
6. Klik "Hapus Semua" → konfirmasi → kosong
7. Import ulang → data muncul kembali

- [ ] **Step 3: Commit**

```bash
git add src/views/DokumenRealisasiView.vue
git commit -m "feat: add DokumenRealisasiView with Excel import and table preview"
```
