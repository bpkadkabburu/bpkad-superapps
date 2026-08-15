import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { klausaAwalanRekening } from '../utils/kodeRekening.js'

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

// Proyeksi kebutuhan belanja gaji & tunjangan: pagu vs realisasi (SP2D) per SKPD
// → per rekening, plus realisasi per bulan untuk mengukur berapa "bulan-gaji"
// yang sudah dibayar (8 bulan kalender bisa berarti 10 bulan-gaji karena THR dan
// gaji ke-13). Perhitungan proyeksinya sendiri dilakukan di Excel/frontend supaya
// pembaginya bisa diubah pemakai.
export async function hitungProyeksiGaji({ tahun, prefix: prefixRaw }) {
  const prefix = bersihkanPrefix(prefixRaw)
  const kosong = { prefix, skpd: [], rekening: [], bulanList: [], totals: { pagu: 0, spp: 0, sp2d: 0 } }
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
       SUM(CASE WHEN nomor_sp2d IS NOT NULL AND LOWER(TRIM(nomor_sp2d)) NOT IN ('', 'null', '-')
                THEN nilai_realisasi ELSE 0 END) AS sp2d
     FROM dokumen_realisasi
     WHERE tahun_id = ? AND ${awalan.sql}
     GROUP BY kode_skpd, nama_skpd, kode_rekening, nama_rekening`,
    [tahun_id, ...awalan.params]
  )

  const [bulanRows] = await db.query(
    `SELECT kode_skpd, bulan,
       SUM(CASE WHEN nomor_sp2d IS NOT NULL AND LOWER(TRIM(nomor_sp2d)) NOT IN ('', 'null', '-')
                THEN nilai_realisasi ELSE 0 END) AS sp2d
     FROM dokumen_realisasi
     WHERE tahun_id = ? AND ${awalan.sql} AND bulan IS NOT NULL
     GROUP BY kode_skpd, bulan`,
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
        perBulan: {}, rekening: new Map(),
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
  }

  const bulanList = Array.from(bulanSet).sort((a, b) => a - b)
  const bulanTerakhir = bulanList.length ? bulanList[bulanList.length - 1] : null

  // Sisa bulan yang masih harus dibayar sampai Desember — tidak perlu ditanyakan
  // ke pemakai, cukup dari bulan terakhir yang sudah ada realisasinya.
  const bulanSisa = bulanTerakhir ? Math.max(0, 12 - bulanTerakhir) : 0

  const skpd = Array.from(skpdMap.values())
    .map(s => {
      const nilaiBulan = bulanList.map(b => s.perBulan[b] || 0)
      const medianBulan = median(nilaiBulan)
      // Berapa bulan-gaji yang sebetulnya sudah dibayar = total / nilai satu bulan
      // rutin. 8 bulan kalender bisa jadi ~10 bulan-gaji karena THR & gaji ke-13.
      // Angka inilah pembagi proyeksi, jadi tiap dinas pakai laju bayarnya sendiri
      // (dinas yang pembayarannya tertinggal tidak ikut terhitung 10 bulan).
      const bulanGajiTerbayar = medianBulan > 0
        ? Math.round((s.sp2d / medianBulan) * 100) / 100
        : (bulanTerakhir || 0)
      const perBulanRutin = bulanGajiTerbayar > 0 ? s.sp2d / bulanGajiTerbayar : 0
      const proyeksi = perBulanRutin * bulanSisa
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
        proyeksi,
        selisih: (s.pagu - s.sp2d) - proyeksi,
        rekening: Array.from(s.rekening.values())
          .map(r => {
            const proyeksiRek = bulanGajiTerbayar > 0 ? (r.sp2d / bulanGajiTerbayar) * bulanSisa : 0
            return {
              ...r,
              sisa: r.pagu - r.sp2d,
              proyeksi: proyeksiRek,
              selisih: (r.pagu - r.sp2d) - proyeksiRek,
            }
          })
          .sort((a, b) => String(a.kodeRekening).localeCompare(String(b.kodeRekening), 'id', { numeric: true })),
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

  // Bulan-gaji terbayar tingkat kabupaten (dari total realisasi per bulan) —
  // dipakai untuk rekap lintas dinas per rekening dan sebagai info di header.
  const totalPerBulan = bulanList.map(b => skpd.reduce((a, s) => a + (s.perBulan[b] || 0), 0))
  const medianTotal = median(totalPerBulan)
  const bulanGajiTerbayarTotal = medianTotal > 0
    ? Math.round((totals.sp2d / medianTotal) * 100) / 100
    : (bulanTerakhir || 0)

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
        }
        rekeningMap.set(r.kodeRekening, g)
      }
      g.pagu += r.pagu; g.spp += r.spp; g.sp2d += r.sp2d
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
    .map(r => {
      const proyeksi = bulanGajiTerbayarTotal > 0 ? (r.sp2d / bulanGajiTerbayarTotal) * bulanSisa : 0
      return {
        ...r,
        sisa: r.pagu - r.sp2d,
        proyeksi,
        selisih: (r.pagu - r.sp2d) - proyeksi,
      }
    })
    .sort((a, b) => String(a.kodeRekening).localeCompare(String(b.kodeRekening), 'id', { numeric: true }))

  return {
    prefix,
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
  })
  return c.json(hasil)
})

export default router
