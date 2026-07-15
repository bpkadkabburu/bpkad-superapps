import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

// Kunci gabung anggaran<->realisasi: seluruh hierarki kode, sama seperti
// rekapRealisasi.js. kode_sub_kegiatan + kode_rekening yang sama bisa muncul di
// banyak Unit SKPD berbeda, jadi tidak boleh digabung hanya lewat rekening.
const LEVELS = [
  { kode: 'kode_skpd' },
  { kode: 'kode_sub_skpd' },
  { kode: 'kode_urusan' },
  { kode: 'kode_bidang_urusan' },
  { kode: 'kode_program' },
  { kode: 'kode_kegiatan' },
  { kode: 'kode_sub_kegiatan' },
  { kode: 'kode_rekening' },
]

// Nama jenis belanja (3 segmen pertama kode rekening) mengikuti Permendagri 90/2019.
const NAMA_JENIS = {
  '5.1.01': 'Belanja Pegawai',
  '5.1.02': 'Belanja Barang dan Jasa',
  '5.1.03': 'Belanja Bunga',
  '5.1.04': 'Belanja Subsidi',
  '5.1.05': 'Belanja Hibah',
  '5.1.06': 'Belanja Bantuan Sosial',
  '5.2.01': 'Belanja Modal Tanah',
  '5.2.02': 'Belanja Modal Peralatan dan Mesin',
  '5.2.03': 'Belanja Modal Gedung dan Bangunan',
  '5.2.04': 'Belanja Modal Jalan, Jaringan, dan Irigasi',
  '5.2.05': 'Belanja Modal Aset Tetap Lainnya',
  '5.3.01': 'Belanja Tidak Terduga',
  '5.4.01': 'Belanja Bagi Hasil',
  '5.4.02': 'Belanja Bantuan Keuangan',
}

// Kategori sumber dana. Untuk efisiensi, yang earmarked (DAK: BOS/BOSP/BOP PAUD/
// BOK/kesetaraan dll) tidak bisa diefisiensi -> dipisah supaya bisa disaring.
// Urutan menentukan tampilan filter di frontend.
const KATEGORI = [
  { key: 'DAU', label: 'DAU' },
  { key: 'DAU_DITENTUKAN', label: 'DAU Ditentukan' },
  { key: 'LKB', label: 'LKB (Pinjaman Bank)' },
  { key: 'DAK', label: 'DAK (BOS/BOSP/BOK/BOP dll)' },
  { key: 'LAINNYA', label: 'PAD & Lainnya' },
]
const LABEL_KATEGORI = Object.fromEntries(KATEGORI.map(k => [k.key, k.label]))

function kategoriSumberDana(kode) {
  const k = String(kode || '')
  if (k === '1.2.01.08') return 'DAU'
  if (k.startsWith('2.2.01.08')) return 'DAU_DITENTUKAN'
  if (k === '1.4.04.03') return 'LKB'
  if (k.startsWith('2.2.01.09')) return 'DAK'
  return 'LAINNYA'
}

// Rekening yang tidak boleh dijadikan kandidat efisiensi: belanja langganan
// telepon, air, listrik, dan internet/TV (kebutuhan operasional tetap yang
// tidak bisa dipangkas).
const NON_EFISIENSI = new Set([
  '5.1.02.02.001.00059', // Belanja Tagihan Telepon
  '5.1.02.02.001.00060', // Belanja Tagihan Air
  '5.1.02.02.001.00061', // Belanja Tagihan Listrik
  '5.1.02.02.001.00063', // Belanja Kawat/Faksimili/Internet/TV Berlangganan
])

function jenisKode(kodeRekening) {
  return String(kodeRekening || '').split('.').slice(0, 3).join('.')
}

function serapan(sp2d, pagu) {
  return pagu > 0 ? sp2d / pagu : null
}

function emptyAgg() {
  return { pagu: 0, spp: 0, sp2d: 0 }
}

// Dashboard Efisiensi Belanja: per Unit SKPD x Jenis Belanja, bandingkan Pagu
// dengan realisasi (SPP & SP2D), sisa = Pagu - SP2D. Bisa disaring per kategori
// sumber dana. Realisasi tidak punya sumber dana, jadi SP2D diatribusikan ke
// tiap sumber dana proporsional terhadap porsi pagu-nya pada rekening tsb.
router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ rows: [], totals: emptyAgg(), kategori: [] })

  // sumberDana absen -> semua kategori; ada (bisa kosong) -> hanya yang disebut.
  const sdParam = c.req.query('sumberDana')
  const SELECTED = sdParam === undefined ? null : new Set(sdParam ? sdParam.split(',') : [])
  const isSel = (cat) => SELECTED === null || SELECTED.has(cat)

  const [taRows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ rows: [], totals: emptyAgg(), kategori: [] })

  const [paguRows] = await db.query(
    `SELECT
       kode_skpd, nama_skpd,
       kode_sub_unit AS kode_sub_skpd, nama_sub_unit AS nama_sub_skpd,
       kode_urusan, kode_bidang_urusan, kode_program, kode_kegiatan,
       kode_sub_kegiatan, kode_rekening, nama_rekening, kode_sumber_dana,
       SUM(pagu) AS pagu
     FROM anggaran_rekap
     WHERE tahun_id = ?
     GROUP BY kode_skpd, nama_skpd, kode_sub_unit, nama_sub_unit,
       kode_urusan, kode_bidang_urusan, kode_program, kode_kegiatan,
       kode_sub_kegiatan, kode_rekening, nama_rekening, kode_sumber_dana`,
    [tahun_id]
  )

  const [realisasiRows] = await db.query(
    `SELECT
       kode_skpd, nama_skpd,
       kode_sub_skpd, nama_sub_skpd,
       kode_urusan, kode_bidang_urusan, kode_program, kode_kegiatan,
       kode_sub_kegiatan, kode_rekening, nama_rekening,
       SUM(nilai_realisasi) AS spp,
       SUM(CASE WHEN nomor_sp2d IS NOT NULL AND LOWER(TRIM(nomor_sp2d)) NOT IN ('', 'null', '-')
                THEN nilai_realisasi ELSE 0 END) AS sp2d
     FROM dokumen_realisasi
     WHERE tahun_id = ?
     GROUP BY kode_skpd, nama_skpd, kode_sub_skpd, nama_sub_skpd,
       kode_urusan, kode_bidang_urusan, kode_program, kode_kegiatan,
       kode_sub_kegiatan, kode_rekening, nama_rekening`,
    [tahun_id]
  )

  // Kumpulkan leaf per hierarki lengkap. Pagu dipecah per sumber dana; spp/sp2d
  // total (tanpa sumber dana) lalu diatribusikan proporsional saat agregasi.
  const leaves = new Map()
  const leafKey = (row) => LEVELS.map(l => row[l.kode]).join('||')

  for (const row of paguRows) {
    const key = leafKey(row)
    let leaf = leaves.get(key)
    if (!leaf) leaf = leaves.set(key, { row, pagu: 0, spp: 0, sp2d: 0, sdPagu: new Map() }).get(key)
    const pagu = Number(row.pagu) || 0
    leaf.pagu += pagu
    const cat = kategoriSumberDana(row.kode_sumber_dana)
    leaf.sdPagu.set(cat, (leaf.sdPagu.get(cat) || 0) + pagu)
  }

  for (const row of realisasiRows) {
    const key = leafKey(row)
    let leaf = leaves.get(key)
    if (!leaf) leaf = leaves.set(key, { row, pagu: 0, spp: 0, sp2d: 0, sdPagu: new Map() }).get(key)
    leaf.spp += Number(row.spp) || 0
    leaf.sp2d += Number(row.sp2d) || 0
    if (!leaf.row.nama_sub_skpd) leaf.row.nama_sub_skpd = row.nama_sub_skpd
    if (!leaf.row.kode_sub_skpd) leaf.row.kode_sub_skpd = row.kode_sub_skpd
    if (!leaf.row.nama_skpd) leaf.row.nama_skpd = row.nama_skpd
    if (!leaf.row.nama_rekening) leaf.row.nama_rekening = row.nama_rekening
  }

  // Pecah tiap leaf menjadi kontribusi per kategori sumber dana (dengan atribusi
  // SP2D/SPP proporsional). Realisasi tanpa anggaran (sdPagu kosong) -> LAINNYA.
  const kategoriTotals = new Map(KATEGORI.map(k => [k.key, emptyAgg()]))
  const rows = new Map()
  const totals = emptyAgg()

  for (const leaf of leaves.values()) {
    // Rekening operasional tetap (telepon/air/listrik/internet) bukan kandidat efisiensi.
    if (NON_EFISIENSI.has(String(leaf.row.kode_rekening || ''))) continue

    const parts = [] // { cat, pagu, spp, sp2d }
    if (leaf.sdPagu.size) {
      for (const [cat, paguCat] of leaf.sdPagu) {
        const share = leaf.pagu > 0 ? paguCat / leaf.pagu : 0
        parts.push({ cat, pagu: paguCat, spp: leaf.spp * share, sp2d: leaf.sp2d * share })
      }
    } else {
      parts.push({ cat: 'LAINNYA', pagu: 0, spp: leaf.spp, sp2d: leaf.sp2d })
    }

    // Total per kategori (seluruh data, untuk filter UI) + kumpulkan yang terpilih.
    let selPagu = 0, selSpp = 0, selSp2d = 0
    for (const p of parts) {
      const kt = kategoriTotals.get(p.cat)
      kt.pagu += p.pagu; kt.spp += p.spp; kt.sp2d += p.sp2d
      if (isSel(p.cat)) { selPagu += p.pagu; selSpp += p.spp; selSp2d += p.sp2d }
    }
    if (selPagu === 0 && selSp2d === 0 && selSpp === 0) continue

    const r = leaf.row
    const jenis = jenisKode(r.kode_rekening)
    const rowKey = `${r.kode_skpd}||${r.kode_sub_skpd}||${jenis}`
    let row = rows.get(rowKey)
    if (!row) {
      row = {
        kodeSkpd: r.kode_skpd, namaSkpd: r.nama_skpd,
        kodeUnit: r.kode_sub_skpd, namaUnit: r.nama_sub_skpd || r.nama_skpd,
        kodeJenis: jenis, namaJenis: NAMA_JENIS[jenis] || jenis,
        pagu: 0, spp: 0, sp2d: 0, details: new Map(),
      }
      rows.set(rowKey, row)
    }
    row.pagu += selPagu; row.spp += selSpp; row.sp2d += selSp2d

    let det = row.details.get(r.kode_rekening)
    if (!det) {
      det = { kodeRekening: r.kode_rekening, namaRekening: r.nama_rekening, pagu: 0, spp: 0, sp2d: 0 }
      row.details.set(r.kode_rekening, det)
    }
    det.pagu += selPagu; det.spp += selSpp; det.sp2d += selSp2d

    totals.pagu += selPagu; totals.spp += selSpp; totals.sp2d += selSp2d
  }

  const out = Array.from(rows.values()).map(row => ({
    kodeSkpd: row.kodeSkpd, namaSkpd: row.namaSkpd,
    kodeUnit: row.kodeUnit, namaUnit: row.namaUnit,
    kodeJenis: row.kodeJenis, namaJenis: row.namaJenis,
    pagu: row.pagu, spp: row.spp, sp2d: row.sp2d,
    sisa: row.pagu - row.sp2d, serapan: serapan(row.sp2d, row.pagu),
    details: Array.from(row.details.values())
      .map(d => ({ ...d, sisa: d.pagu - d.sp2d, serapan: serapan(d.sp2d, d.pagu) }))
      .sort((a, b) => b.sisa - a.sisa),
  })).sort((a, b) => b.sisa - a.sisa)

  const kategori = KATEGORI.map(k => ({
    key: k.key, label: k.label, ...kategoriTotals.get(k.key),
  }))

  return c.json({ rows: out, totals, kategori })
})

export default router
