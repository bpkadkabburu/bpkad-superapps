import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { klausaAwalanRekening } from '../utils/kodeRekening.js'
import { hitungProyeksiAkhir } from '../utils/proyeksiAkhir.js'

const router = new Hono()
router.use('*', requireAuth)

// Default: Belanja Gaji dan Tunjangan ASN (Permendagri 90/2019).
const DEFAULT_PREFIX = '5.1.01.01'

// Prefix hanya boleh angka dan titik — dipakai langsung di klausa LIKE.
function bersihkanPrefix(raw) {
  const p = String(raw || '').replace(/[^0-9.]/g, '')
  return p || DEFAULT_PREFIX
}

// Nilai "satu bulan gaji rutin" diambil dari median bulan yang ada realisasinya,
// bukan rata-rata: bulan dengan THR / gaji ke-13 nilainya ~2x sehingga rata-rata
// menggelembung. Median tahan terhadap bulan ganda seperti itu.
function median(values) {
  const v = values.filter(n => n > 0).sort((a, b) => a - b)
  if (!v.length) return 0
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

const num = (v) => Number(v) || 0

// Baris dianggap sudah cair kalau nomor SP2D-nya terisi sungguhan. Dipakai di
// semua query di berkas ini supaya definisinya tidak sempat menyimpang.
const SP2D_SAH = "nomor_sp2d IS NOT NULL AND LOWER(TRIM(nomor_sp2d)) NOT IN ('', 'null', '-')"

// Proyeksi kebutuhan belanja gaji & tunjangan: pagu vs realisasi (SP2D) per SKPD
// → per rekening, plus realisasi per bulan untuk mengukur berapa "bulan-gaji"
// yang sudah dibayar (8 bulan kalender bisa berarti 10 bulan-gaji karena THR dan
// gaji ke-13). Perhitungan proyeksinya sendiri dilakukan di Excel/frontend supaya
// pembaginya bisa diubah pemakai.
export async function hitungProyeksiGaji({ tahun, prefix: prefixRaw, basis: basisRaw }) {
  const prefix = bersihkanPrefix(prefixRaw)
  // 'rata'      : rata-rata tiap kali bayar (total ÷ berapa kali dibayar)
  // 'tertinggi' : nilai sekali bayar yang paling tinggi — dipakai kalau ingin
  //               berjaga-jaga terhadap kemungkinan gaji naik di sisa tahun.
  const basis = basisRaw === 'tertinggi' ? 'tertinggi' : 'rata'
  const kosong = { prefix, basis, skpd: [], rekening: [], bulanList: [], totals: { pagu: 0, spp: 0, sp2d: 0 } }
  if (!tahun) return kosong

  const [taRows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return kosong

  // Awalan dicocokkan dalam semua varian lebar digit, jadi 5.1.01.01.001 tetap
  // kena untuk data 2024–2025 yang formatnya 5.1.01.01.01.
  const awalan = klausaAwalanRekening('kode_rekening', prefix)

  const [paguRows] = await db.query(
    `SELECT kode_skpd, nama_skpd, kode_rekening, nama_rekening, SUM(pagu) AS pagu
     FROM anggaran_rekap
     WHERE tahun_id = ? AND ${awalan.sql}
     GROUP BY kode_skpd, nama_skpd, kode_rekening, nama_rekening`,
    [tahun_id, ...awalan.params]
  )

  const [realisasiRows] = await db.query(
    `SELECT kode_skpd, nama_skpd, kode_rekening, nama_rekening,
       SUM(nilai_realisasi) AS spp,
       SUM(CASE WHEN ${SP2D_SAH} THEN nilai_realisasi ELSE 0 END) AS sp2d
     FROM dokumen_realisasi
     WHERE tahun_id = ? AND ${awalan.sql}
     GROUP BY kode_skpd, nama_skpd, kode_rekening, nama_rekening`,
    [tahun_id, ...awalan.params]
  )

  // Jumlah dokumen SP2D per bulan ikut dihitung: satu bulan bisa berisi lebih
  // dari satu SP2D (gaji induk + rapel/susulan), dan kalau itu tidak kelihatan,
  // nilai bulan terakhir gampang disalahartikan sebagai "gaji satu bulan".
  const [bulanRows] = await db.query(
    `SELECT kode_skpd, bulan,
       SUM(CASE WHEN ${SP2D_SAH} THEN nilai_realisasi ELSE 0 END) AS sp2d,
       COUNT(DISTINCT CASE WHEN ${SP2D_SAH} THEN nomor_sp2d END) AS jumlah_sp2d
     FROM dokumen_realisasi
     WHERE tahun_id = ? AND ${awalan.sql} AND bulan IS NOT NULL
     GROUP BY kode_skpd, bulan`,
    [tahun_id, ...awalan.params]
  )

  // Realisasi per bulan sampai tingkat rekening — dasar kroscek kebutuhan: nilai
  // bulan terakhir dikali sisa bulan harusnya mendekati angka proyeksinya.
  const [bulanRekRows] = await db.query(
    `SELECT kode_skpd, kode_rekening, bulan,
       SUM(CASE WHEN ${SP2D_SAH} THEN nilai_realisasi ELSE 0 END) AS sp2d
     FROM dokumen_realisasi
     WHERE tahun_id = ? AND ${awalan.sql} AND bulan IS NOT NULL
     GROUP BY kode_skpd, kode_rekening, bulan`,
    [tahun_id, ...awalan.params]
  )

  // Gabung anggaran & realisasi per SKPD → rekening. Kunci cukup kode_skpd +
  // kode_rekening (sub unit dijumlahkan, karena satu sheet = satu dinas).
  const skpdMap = new Map()

  function ambilSkpd(kode, nama) {
    let s = skpdMap.get(kode)
    if (!s) {
      s = {
        kodeSkpd: kode, namaSkpd: nama || kode,
        pagu: 0, spp: 0, sp2d: 0,
        perBulan: {}, sp2dPerBulan: {}, rekening: new Map(),
      }
      skpdMap.set(kode, s)
    } else if (!s.namaSkpd && nama) {
      s.namaSkpd = nama
    }
    return s
  }

  function ambilRekening(s, kode, nama) {
    let r = s.rekening.get(kode)
    if (!r) {
      r = { kodeRekening: kode, namaRekening: nama || kode, pagu: 0, spp: 0, sp2d: 0 }
      s.rekening.set(kode, r)
    } else if (!r.namaRekening && nama) {
      r.namaRekening = nama
    }
    return r
  }

  for (const row of paguRows) {
    const s = ambilSkpd(row.kode_skpd, row.nama_skpd)
    const r = ambilRekening(s, row.kode_rekening, row.nama_rekening)
    r.pagu += num(row.pagu)
    s.pagu += num(row.pagu)
  }

  for (const row of realisasiRows) {
    const s = ambilSkpd(row.kode_skpd, row.nama_skpd)
    const r = ambilRekening(s, row.kode_rekening, row.nama_rekening)
    r.spp += num(row.spp)
    r.sp2d += num(row.sp2d)
    s.spp += num(row.spp)
    s.sp2d += num(row.sp2d)
  }

  const bulanSet = new Set()
  for (const row of bulanRows) {
    const bulan = Number(row.bulan)
    if (!bulan) continue
    bulanSet.add(bulan)
    const s = ambilSkpd(row.kode_skpd, null)
    s.perBulan[bulan] = (s.perBulan[bulan] || 0) + num(row.sp2d)
    s.sp2dPerBulan[bulan] = (s.sp2dPerBulan[bulan] || 0) + num(row.jumlah_sp2d)
  }

  // `${kode_skpd}|${kode_rekening}` -> { bulan: nilai }
  const rekPerBulan = new Map()
  for (const row of bulanRekRows) {
    const bulan = Number(row.bulan)
    if (!bulan) continue
    const kunci = `${row.kode_skpd}|${row.kode_rekening}`
    let perBulan = rekPerBulan.get(kunci)
    if (!perBulan) { perBulan = {}; rekPerBulan.set(kunci, perBulan) }
    perBulan[bulan] = (perBulan[bulan] || 0) + num(row.sp2d)
  }

  const bulanList = Array.from(bulanSet).sort((a, b) => a - b)
  const bulanTerakhir = bulanList.length ? bulanList[bulanList.length - 1] : null

  // Sisa bulan yang masih harus dibayar sampai Desember — tidak perlu ditanyakan
  // ke pemakai, cukup dari bulan terakhir yang sudah ada realisasinya.
  const bulanSisa = bulanTerakhir ? Math.max(0, 12 - bulanTerakhir) : 0

  const bulat2 = (n) => Math.round((Number(n) || 0) * 100) / 100

  const skpd = Array.from(skpdMap.values())
    .map(s => {
      const nilaiBulan = bulanList.map(b => s.perBulan[b] || 0)
      const medianBulan = median(nilaiBulan)
      // Laju bayar tingkat dinas — dipakai sebagai cadangan kalau satu rekening
      // belum punya realisasi bulanan sendiri, dan sebagai konteks di layar.
      const bulanGajiTerbayarDinas = medianBulan > 0
        ? bulat2(s.sp2d / medianBulan)
        : (bulanTerakhir || 0)

      // Bulan terakhir DINAS INI, bukan bulan terakhir kabupaten — dinas yang
      // pembayarannya tertinggal harus kelihatan tertinggal, bukan tampil nol.
      const bulanIsi = Object.keys(s.perBulan).map(Number).filter(b => s.perBulan[b] > 0)
      const bulanTerakhirSkpd = bulanIsi.length ? Math.max(...bulanIsi) : null
      const realisasiTerakhir = bulanTerakhirSkpd ? s.perBulan[bulanTerakhirSkpd] : 0
      const sp2dTerakhir = bulanTerakhirSkpd ? (s.sp2dPerBulan[bulanTerakhirSkpd] || 0) : 0

      // Proyeksi dihitung PER REKENING, bukan sekali di tingkat dinas. Tiap
      // rekening punya laju bayarnya sendiri: gaji pokok dan tunjangan ikut
      // terbayar di bulan THR dan gaji ke-13 (≈10 kali dalam 8 bulan kalender),
      // sedangkan iuran BPJS/JKK/JKM hanya sekali sebulan (persis 8 kali).
      // Memakai satu pembagi dinas untuk semuanya membuat kebutuhan iuran kurang
      // ±23% sementara gaji pokok berlebih — di total kabupaten nyaris saling
      // menutup, tapi angka per rekeningnya (justru yang dipakai orang) meleset.
      const rekening = Array.from(s.rekening.values())
        .map(r => {
          const perBulan = rekPerBulan.get(`${s.kodeSkpd}|${r.kodeRekening}`)
          const nilaiRek = bulanList.map(b => perBulan?.[b] || 0)
          const medianRek = median(nilaiRek)
          const dibayar = medianRek > 0 ? bulat2(r.sp2d / medianRek) : bulanGajiTerbayarDinas
          const rataRata = dibayar > 0 ? r.sp2d / dibayar : 0

          // Nilai SEKALI BAYAR tiap bulan. Bulan yang nilainya ±2× rata-rata
          // memuat dua kali pembayaran (gaji rutin + THR / gaji ke-13, atau dua
          // bulan gaji yang cair berbarengan), jadi dibagi dulu sebelum bulan
          // yang satu dibandingkan dengan bulan yang lain.
          const perBayar = nilaiRek
            .filter(n => n > 0)
            .map(n => n / Math.max(1, Math.round(rataRata > 0 ? n / rataRata : 1)))
          const tertinggi = perBayar.length ? Math.max(...perBayar) : 0
          const terendah = perBayar.length ? Math.min(...perBayar) : 0
          // Tiga kali bayar terakhir dibanding rata-rata seluruh tahun berjalan.
          // Di atas 1 berarti belakangan naik — dasar proyeksi versi rata-rata
          // jadi kerendahan, dan di situlah "tertinggi" layak dipakai.
          const akhir3 = perBayar.slice(-3)
          const rataAkhir = akhir3.length ? akhir3.reduce((a, n) => a + n, 0) / akhir3.length : 0
          const tren = rataRata > 0 ? Math.round((rataAkhir / rataRata) * 1000) / 1000 : 0

          const perBulanRutinRek = basis === 'tertinggi' ? tertinggi : rataRata
          const proyeksiRek = perBulanRutinRek * bulanSisa
          return {
            ...r,
            sisa: r.pagu - r.sp2d,
            // Bulan yang diambil sama dengan bulan terakhir dinasnya, supaya Σ
            // rekening = nilai bulan terakhir dinas dan angkanya bisa diadu.
            realisasiTerakhir: bulanTerakhirSkpd ? (perBulan?.[bulanTerakhirSkpd] || 0) : 0,
            medianBulan: medianRek,
            dibayar,
            // true = rekening ini belum punya realisasi bulanan sendiri, jadi
            // pembagi dinas yang dipinjam.
            dibayarPerkiraan: medianRek <= 0,
            rataRata,
            tertinggi,
            terendah,
            rataAkhir,
            tren,
            perBulanRutin: perBulanRutinRek,
            proyeksi: proyeksiRek,
            selisih: (r.pagu - r.sp2d) - proyeksiRek,
          }
        })
        .sort((a, b) => String(a.kodeRekening).localeCompare(String(b.kodeRekening), 'id', { numeric: true }))

      // Angka dinas disusun dari bawah, jadi Σ rekening = angka dinas persis.
      const perBulanRutin = rekening.reduce((a, r) => a + r.perBulanRutin, 0)
      const rataRataDinas = rekening.reduce((a, r) => a + r.rataRata, 0)
      const tertinggiDinas = rekening.reduce((a, r) => a + r.tertinggi, 0)
      const rataAkhirDinas = rekening.reduce((a, r) => a + r.rataAkhir, 0)
      const proyeksi = perBulanRutin * bulanSisa
      // Laju bayar efektif dinas: pembagi yang, kalau dipakai ke total realisasi,
      // menghasilkan proyeksi yang sama dengan jumlah per rekening di atas.
      const bulanGajiTerbayar = perBulanRutin > 0
        ? bulat2(s.sp2d / perBulanRutin)
        : bulanGajiTerbayarDinas

      return {
        kodeSkpd: s.kodeSkpd,
        namaSkpd: s.namaSkpd,
        pagu: s.pagu,
        spp: s.spp,
        sp2d: s.sp2d,
        sisa: s.pagu - s.sp2d,
        perBulan: s.perBulan,
        medianBulan,
        bulanGajiTerbayar,
        // true = pembagi jatuh ke bulan kalender karena median tidak bisa dihitung
        // (dinas belum ada realisasi bulanan sama sekali).
        pembagiPerkiraan: medianBulan <= 0,
        perBulanRutin,
        rataRata: rataRataDinas,
        tertinggi: tertinggiDinas,
        rataAkhir: rataAkhirDinas,
        // >1 = tiga kali bayar terakhir lebih tinggi dari rata-rata tahun berjalan.
        tren: rataRataDinas > 0 ? Math.round((rataAkhirDinas / rataRataDinas) * 1000) / 1000 : 0,
        bulanTerakhirSkpd,
        realisasiTerakhir,
        // Berapa dokumen SP2D yang membentuk nilai bulan terakhir itu. Lebih dari
        // satu berarti nilainya bukan "satu bulan gaji" polos.
        sp2dTerakhir,
        proyeksi,
        selisih: (s.pagu - s.sp2d) - proyeksi,
        rekening,
      }
    })
    .sort((a, b) => String(a.kodeSkpd).localeCompare(String(b.kodeSkpd), 'id', { numeric: true }))

  const totals = skpd.reduce(
    (t, s) => ({
      pagu: t.pagu + s.pagu,
      spp: t.spp + s.spp,
      sp2d: t.sp2d + s.sp2d,
      proyeksi: t.proyeksi + s.proyeksi,
    }),
    { pagu: 0, spp: 0, sp2d: 0, proyeksi: 0 }
  )
  totals.sisa = totals.pagu - totals.sp2d
  totals.selisih = totals.sisa - totals.proyeksi

  const totalPerBulan = bulanList.map(b => skpd.reduce((a, s) => a + (s.perBulan[b] || 0), 0))
  const medianTotal = median(totalPerBulan)
  // Laju bayar efektif sekabupaten. Disusun dari proyeksi per rekening yang sudah
  // dijumlahkan, bukan dihitung ulang dari median total — supaya angka di header
  // konsisten dengan angka di tabel, bukan versi lain yang mirip-mirip.
  const perBulanRutinTotal = skpd.reduce((a, s) => a + s.perBulanRutin, 0)
  const bulanGajiTerbayarTotal = perBulanRutinTotal > 0
    ? Math.round((totals.sp2d / perBulanRutinTotal) * 100) / 100
    : (medianTotal > 0 ? Math.round((totals.sp2d / medianTotal) * 100) / 100 : (bulanTerakhir || 0))

  // Rekap lintas dinas per rekening — untuk melihat komponen mana yang paling
  // rawan kurang (mis. gaji pokok PPPK).
  const rekeningMap = new Map()
  for (const s of skpd) {
    for (const r of s.rekening) {
      let g = rekeningMap.get(r.kodeRekening)
      if (!g) {
        g = {
          kodeRekening: r.kodeRekening, namaRekening: r.namaRekening,
          pagu: 0, spp: 0, sp2d: 0,
          // Kekurangan tingkat rekening bisa tertutup kalau hanya dilihat dari
          // total kabupaten (dinas yang lebih menutup dinas yang kurang), jadi
          // kekurangan per dinas dihitung terpisah dan tidak disaling-hapuskan.
          dinasKurang: 0, kekurangan: 0, daftarKurang: [],
          perBulanRutin: 0, rataRata: 0, tertinggi: 0, rataAkhir: 0, proyeksi: 0,
        }
        rekeningMap.set(r.kodeRekening, g)
      }
      g.pagu += r.pagu; g.spp += r.spp; g.sp2d += r.sp2d
      // Dijumlahkan dari dinas, bukan dihitung ulang dengan pembagi kabupaten:
      // laju bayar tiap rekening berbeda dan itu yang harus dipertahankan.
      g.perBulanRutin += r.perBulanRutin
      g.rataRata += r.rataRata
      g.tertinggi += r.tertinggi
      g.rataAkhir += r.rataAkhir
      g.proyeksi += r.proyeksi
      if (r.selisih < 0) {
        g.dinasKurang += 1
        g.kekurangan += r.selisih
        g.daftarKurang.push({
          kodeSkpd: s.kodeSkpd, namaSkpd: s.namaSkpd,
          pagu: r.pagu, sp2d: r.sp2d, sisa: r.sisa, proyeksi: r.proyeksi, selisih: r.selisih,
        })
      }
    }
  }
  for (const g of rekeningMap.values()) {
    g.daftarKurang.sort((a, b) => a.selisih - b.selisih)
  }
  const rekening = Array.from(rekeningMap.values())
    .map(r => ({
      ...r,
      sisa: r.pagu - r.sp2d,
      // Berapa kali rekening ini dibayar sekabupaten — inilah angka yang
      // membedakan gaji pokok (ikut THR & gaji ke-13) dari iuran BPJS.
      dibayar: r.rataRata > 0 ? Math.round((r.sp2d / r.rataRata) * 100) / 100 : 0,
      tren: r.rataRata > 0 ? Math.round((r.rataAkhir / r.rataRata) * 1000) / 1000 : 0,
      selisih: (r.pagu - r.sp2d) - r.proyeksi,
    }))
    .sort((a, b) => String(a.kodeRekening).localeCompare(String(b.kodeRekening), 'id', { numeric: true }))

  return {
    prefix,
    basis,
    tahun: Number(tahun),
    bulanList,
    bulanTerakhir,
    bulanSisa,
    bulanGajiTerbayarTotal,
    medianTotal,
    totalPerBulan,
    totals,
    skpd,
    rekening,
  }
}

router.get('/', async (c) => {
  const hasil = await hitungProyeksiGaji({
    tahun: c.req.query('tahun'),
    prefix: c.req.query('prefix'),
    basis: c.req.query('basis'),
  })
  hasil.akhir = hitungProyeksiAkhir(hasil, { persen: c.req.query('persen') })
  return c.json(hasil)
})

export default router
