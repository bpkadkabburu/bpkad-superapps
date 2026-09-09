import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { getAklapRealisasiRows, getSubSkpdToSkpd } from './aklapRealisasi.js'

const router = new Hono()
router.use('*', requireAuth)

// Hierarki: Sumber Dana → SKPD → Unit SKPD → Urusan → Bidang Urusan → Program →
// Kegiatan → Sub Kegiatan → Belanja.
//
// Catatan penting soal sumbernya: sumber dana HANYA ada di sisi anggaran
// (anggaran_rekap.kode_sumber_dana). Dokumen realisasi (SPP/SP2D) maupun AKLAP
// tidak menyimpan sumber dana sama sekali — SIPD tidak mengirimnya. Karena itu
// realisasi di sini DIATRIBUSIKAN ke sumber dana lewat anggarannya, per baris
// terkecil (SKPD + Unit + Sub Kegiatan + kode rekening):
//
//   - baris yang anggarannya cuma punya satu sumber dana  -> realisasinya jatuh
//     utuh ke sumber dana itu (pasti, bukan taksiran);
//   - baris yang anggarannya dipecah ke beberapa sumber dana -> realisasinya
//     dibagi proporsional terhadap pagu tiap sumber dana. Bagian inilah yang
//     dihitung sebagai "estimasi" dan dilaporkan terpisah di field `estimasi`,
//     supaya pemakai tahu angka mana yang hasil pembagian, bukan angka SIPD.
//
// Baris realisasi yang tidak punya pasangan di anggaran ditaruh di keranjang
// "Tanpa Sumber Dana" — kalau dibuang, total rekap ini tidak akan sama dengan
// rekap realisasi yang lain.
const LEVELS = [
  { key: 'sumberDana', badge: 'Sumber Dana', kode: 'kode_sumber_dana', nama: 'nama_sumber_dana' },
  { key: 'skpd', badge: 'SKPD', kode: 'kode_skpd', nama: 'nama_skpd' },
  { key: 'subSkpd', badge: 'Unit SKPD', kode: 'kode_sub_skpd', nama: 'nama_sub_skpd' },
  { key: 'urusan', badge: 'Urusan', kode: 'kode_urusan', nama: 'nama_urusan' },
  { key: 'bidangUrusan', badge: 'Bidang Urusan', kode: 'kode_bidang_urusan', nama: 'nama_bidang_urusan' },
  { key: 'program', badge: 'Program', kode: 'kode_program', nama: 'nama_program' },
  { key: 'kegiatan', badge: 'Kegiatan', kode: 'kode_kegiatan', nama: 'nama_kegiatan' },
  { key: 'subKegiatan', badge: 'Sub Kegiatan', kode: 'kode_sub_kegiatan', nama: 'nama_sub_kegiatan' },
  { key: 'belanja', badge: 'Belanja', kode: 'kode_rekening', nama: 'nama_rekening' },
]

// Level di bawah sumber dana — dipakai sebagai kunci pencocokan anggaran vs realisasi.
const HIERARKI = LEVELS.slice(1).map(lvl => lvl.kode)

const KODE_TANPA_SD = '-'
const NAMA_TANPA_SD = 'Tanpa Sumber Dana (tidak ada di anggaran)'

function emptyTotals() {
  return { pagu: 0, realisasiSpp: 0, realisasiSp2d: 0, realisasiAklap: 0 }
}

function addTotals(target, source) {
  target.pagu += source.pagu
  target.realisasiSpp += source.realisasiSpp
  target.realisasiSp2d += source.realisasiSp2d
  target.realisasiAklap += source.realisasiAklap
}

const num = (v) => Number(v) || 0
const bulat = (v) => Math.round(v * 100) / 100

router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [taRows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ data: [] })

  const [paguRows] = await db.query(
    `SELECT
       kode_skpd, nama_skpd,
       kode_sub_unit AS kode_sub_skpd, nama_sub_unit AS nama_sub_skpd,
       kode_urusan, nama_urusan,
       kode_bidang_urusan, nama_bidang_urusan,
       kode_program, nama_program,
       kode_kegiatan, nama_kegiatan,
       kode_sub_kegiatan, nama_sub_kegiatan,
       kode_rekening, nama_rekening,
       kode_sumber_dana, nama_sumber_dana,
       SUM(pagu) AS pagu
     FROM anggaran_rekap
     WHERE tahun_id = ?
     GROUP BY kode_skpd, nama_skpd, kode_sub_unit, nama_sub_unit,
       kode_urusan, nama_urusan, kode_bidang_urusan, nama_bidang_urusan,
       kode_program, nama_program, kode_kegiatan, nama_kegiatan,
       kode_sub_kegiatan, nama_sub_kegiatan, kode_rekening, nama_rekening,
       kode_sumber_dana, nama_sumber_dana`,
    [tahun_id]
  )

  // Peta bidang PMK per kode_sub_kegiatan (kalau tabel referensi ada isinya).
  const [pmkRows] = await db.query(
    `SELECT kode_sub_kegiatan, bidang FROM subkegiatan_pmk WHERE tahun_id = ?`,
    [tahun_id]
  )
  const bidangBySubKeg = new Map()
  for (const r of pmkRows) {
    if (r.kode_sub_kegiatan) bidangBySubKeg.set(r.kode_sub_kegiatan, r.bidang)
  }

  const [realisasiRows] = await db.query(
    `SELECT
       kode_skpd, nama_skpd,
       kode_sub_skpd, nama_sub_skpd,
       kode_urusan, nama_urusan,
       kode_bidang_urusan, nama_bidang_urusan,
       kode_program, nama_program,
       kode_kegiatan, nama_kegiatan,
       kode_sub_kegiatan, nama_sub_kegiatan,
       kode_rekening, nama_rekening,
       SUM(nilai_realisasi) AS realisasi_spp,
       SUM(CASE WHEN nomor_sp2d IS NOT NULL AND LOWER(TRIM(nomor_sp2d)) NOT IN ('', 'null', '-')
                THEN nilai_realisasi ELSE 0 END) AS realisasi_sp2d
     FROM dokumen_realisasi
     WHERE tahun_id = ?
     GROUP BY kode_skpd, nama_skpd, kode_sub_skpd, nama_sub_skpd,
       kode_urusan, nama_urusan, kode_bidang_urusan, nama_bidang_urusan,
       kode_program, nama_program, kode_kegiatan, nama_kegiatan,
       kode_sub_kegiatan, nama_sub_kegiatan, kode_rekening, nama_rekening`,
    [tahun_id]
  )

  // Kunci baris terkecil TANPA sumber dana — dipakai mencocokkan realisasi ke anggaran.
  function hierKey(row) {
    return HIERARKI.map(kode => row[kode] ?? '').join('||')
  }

  // Peta baris terkecil -> daftar sumber dana beserta pagunya. Inilah dasar
  // pembagian realisasi.
  const anggaran = new Map()
  for (const row of paguRows) {
    const key = hierKey(row)
    let a = anggaran.get(key)
    if (!a) {
      a = { pagu: 0, sd: new Map() }
      anggaran.set(key, a)
    }
    const pagu = num(row.pagu)
    a.pagu += pagu
    const kode = row.kode_sumber_dana || KODE_TANPA_SD
    const sd = a.sd.get(kode) || { kode, nama: row.nama_sumber_dana || NAMA_TANPA_SD, pagu: 0 }
    sd.pagu += pagu
    a.sd.set(kode, sd)
  }

  // Leaf = baris terkecil × sumber dana.
  const leaves = new Map()

  function ambilLeaf(row, sd) {
    const key = `${sd.kode}||${hierKey(row)}`
    let leaf = leaves.get(key)
    if (!leaf) {
      leaf = {
        row: { ...row, kode_sumber_dana: sd.kode, nama_sumber_dana: sd.nama },
        totals: emptyTotals(),
        // Bagian realisasi yang didapat dari pembagian proporsional, bukan
        // dari baris anggaran yang sumber dananya tunggal.
        estimasi: emptyTotals(),
      }
      leaves.set(key, leaf)
    } else {
      // Baris realisasi kadang membawa nama level yang di anggaran kosong.
      for (const lvl of LEVELS) {
        if (!leaf.row[lvl.kode] && row[lvl.kode]) leaf.row[lvl.kode] = row[lvl.kode]
        if (!leaf.row[lvl.nama] && row[lvl.nama]) leaf.row[lvl.nama] = row[lvl.nama]
      }
    }
    return leaf
  }

  for (const row of paguRows) {
    const kode = row.kode_sumber_dana || KODE_TANPA_SD
    const leaf = ambilLeaf(row, { kode, nama: row.nama_sumber_dana || NAMA_TANPA_SD })
    leaf.totals.pagu += num(row.pagu)
  }

  // Sebar satu nilai realisasi ke sumber dana pemilik baris anggarannya.
  function sebar(row, field, nilai) {
    if (!nilai) return
    const a = anggaran.get(hierKey(row))
    const daftar = a ? [...a.sd.values()].sort((x, y) => y.pagu - x.pagu) : []

    if (daftar.length === 0) {
      // Realisasi tanpa pasangan anggaran — tetap dibawa supaya total tidak bocor.
      ambilLeaf(row, { kode: KODE_TANPA_SD, nama: NAMA_TANPA_SD }).totals[field] += nilai
      return
    }

    if (daftar.length === 1) {
      ambilLeaf(row, daftar[0]).totals[field] += nilai
      return
    }

    // Pagu bisa 0 semua (mis. anggaran dinolkan tapi realisasinya sudah jalan) —
    // di situ pembagian rata adalah satu-satunya pilihan yang tidak membuang angka.
    const totalPagu = daftar.reduce((t, sd) => t + sd.pagu, 0)
    let sisa = nilai
    daftar.forEach((sd, i) => {
      const bagian = i === daftar.length - 1
        ? bulat(sisa) // sisa pembulatan jatuh ke porsi terkecil
        : bulat(totalPagu > 0 ? nilai * (sd.pagu / totalPagu) : nilai / daftar.length)
      sisa -= bagian
      const leaf = ambilLeaf(row, sd)
      leaf.totals[field] += bagian
      leaf.estimasi[field] += bagian
    })
  }

  for (const row of realisasiRows) {
    sebar(row, 'realisasiSpp', num(row.realisasi_spp))
    sebar(row, 'realisasiSp2d', num(row.realisasi_sp2d))
  }

  // Realisasi AKLAP (LRA Per Program) diperlakukan sama. AKLAP tak punya
  // kode_skpd, jadi diperkaya dari peta sub_skpd -> skpd dulu.
  const aklapRows = await getAklapRealisasiRows(db, tahun_id)
  const skpdMap = await getSubSkpdToSkpd(db, tahun_id)
  for (const row of aklapRows) {
    const enriched = { ...row }
    const m = skpdMap.get(row.kode_sub_skpd)
    if (m) {
      enriched.kode_skpd = m.kode_skpd
      enriched.nama_skpd = m.nama_skpd
    }
    sebar(enriched, 'realisasiAklap', num(row.realisasi_aklap))
  }

  // ---- Bangun tree ----
  const root = { children: new Map(), totals: emptyTotals(), estimasi: emptyTotals() }

  for (const { row, totals, estimasi } of leaves.values()) {
    let node = root
    for (const lvl of LEVELS) {
      const kode = row[lvl.kode] ?? '-'
      const nama = row[lvl.nama] ?? '-'
      if (!node.children.has(kode)) {
        node.children.set(kode, {
          kode,
          nama,
          badge: lvl.badge,
          children: new Map(),
          totals: emptyTotals(),
          estimasi: emptyTotals(),
          bidang: lvl.badge === 'Sub Kegiatan' ? (bidangBySubKeg.get(kode) || null) : null,
        })
      }
      node = node.children.get(kode)
      addTotals(node.totals, totals)
      addTotals(node.estimasi, estimasi)
    }
    addTotals(root.totals, totals)
    addTotals(root.estimasi, estimasi)
  }

  const bandingKode = (a, b) => String(a.kode).localeCompare(String(b.kode), 'id', { numeric: true })

  function toArray(node) {
    return Array.from(node.children.values())
      // Sumber dana diurutkan dari yang pagunya terbesar — yang dicari duluan
      // biasanya DAU/DAK besar, bukan urutan kodenya.
      .sort((a, b) => a.badge === 'Sumber Dana' ? (b.totals.pagu - a.totals.pagu) || bandingKode(a, b) : bandingKode(a, b))
      .map(child => ({
        kode: child.kode,
        nama: child.nama,
        badge: child.badge,
        totals: child.totals,
        estimasi: child.estimasi,
        bidang: child.bidang,
        belumSp2d: Math.max(child.totals.realisasiSpp - child.totals.realisasiSp2d, 0),
        children: toArray(child),
      }))
  }

  return c.json({ data: toArray(root), totals: root.totals, estimasi: root.estimasi })
})

export default router
