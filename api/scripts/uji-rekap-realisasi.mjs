// Pengujian filter route /api/rekap-realisasi terhadap database sungguhan.
// Read-only: hanya GET yang dipanggil.
//
//   cd api && npm run uji:rekap-realisasi [tahun]

import 'dotenv/config'
import { Hono } from 'hono'
import jwt from 'jsonwebtoken'

import db from '../src/db.js'
import rekapRealisasi from '../src/routes/rekapRealisasi.js'

const TAHUN = Number(process.argv[2]) || new Date().getFullYear()

const app = new Hono()
app.route('/api/rekap-realisasi', rekapRealisasi)
const token = jwt.sign({ id: 'uji', username: 'uji', role: 'superadmin' }, process.env.JWT_SECRET)

async function ambil(path, params = {}) {
  const url = new URL(`http://uji/api/rekap-realisasi${path}`)
  url.searchParams.set('tahun', TAHUN)
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v)
  const res = await app.request(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return res.json()
}

let gagal = 0
function cek(nama, lulus, catatan) {
  if (lulus) console.log(`  ok    ${nama}${catatan ? `  (${catatan})` : ''}`)
  else { gagal++; console.log(`  GAGAL ${nama}${catatan ? `  (${catatan})` : ''}`) }
}
const rp = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID')
const dekat = (a, b) => Math.abs(Number(a) - Number(b)) < 1

// Seluruh leaf Belanja pada tree, untuk memeriksa hasil filter kode rekening.
function daftarBelanja(list, out = []) {
  for (const node of list) {
    if (node.badge === 'Belanja') out.push(node)
    else daftarBelanja(node.children || [], out)
  }
  return out
}

console.log(`\nRekap Realisasi — TA ${TAHUN}\n`)

const semua = await ambil('')
const opsi = await ambil('/opsi')

if (!semua.data?.length) {
  console.log('Tidak ada data untuk tahun ini — pengujian dihentikan.')
  await db.end()
  process.exit(0)
}

console.log('Data & opsi filter')
console.log(`  SKPD              : ${semua.data.length}`)
console.log(`  pagu              : Rp${rp(semua.totals.pagu)}`)
console.log(`  SPP / SP2D        : Rp${rp(semua.totals.realisasiSpp)} / Rp${rp(semua.totals.realisasiSp2d)}`)
console.log(`  AKLAP             : Rp${rp(semua.totals.realisasiAklap)}`)
console.log(`  opsi rekening     : ${opsi.rekening.length}`)
console.log(`  bulan ada data    : ${opsi.bulan.map(b => b.bulan).join(',') || '(tidak ada)'}`)

console.log('\nOpsi filter')
cek('opsi rekening terisi', opsi.rekening.length > 0)
cek('opsi rekening mencakup yang cuma punya pagu',
  opsi.rekening.some(r => r.dokumen === 0),
  `${opsi.rekening.filter(r => r.dokumen === 0).length} rekening tanpa dokumen`)
cek('tiap opsi rekening punya kode', opsi.rekening.every(r => r.kode))

console.log('\nFilter kode rekening')
const AWALAN = '5.1.01'
const perAwalan = await ambil('', { kodeRekening: AWALAN })
const belanjaAwalan = daftarBelanja(perAwalan.data)
cek('semua leaf Belanja berawalan yang diminta',
  belanjaAwalan.length > 0 && belanjaAwalan.every(n => String(n.kode).startsWith(AWALAN + '.')),
  `${belanjaAwalan.length} leaf`)
cek('pagu tersaring <= pagu keseluruhan',
  perAwalan.totals.pagu <= semua.totals.pagu,
  `Rp${rp(perAwalan.totals.pagu)} dari Rp${rp(semua.totals.pagu)}`)
cek('SPP tersaring <= SPP keseluruhan', perAwalan.totals.realisasiSpp <= semua.totals.realisasiSpp)
cek('AKLAP ikut tersaring', perAwalan.totals.realisasiAklap <= semua.totals.realisasiAklap,
  `Rp${rp(perAwalan.totals.realisasiAklap)} dari Rp${rp(semua.totals.realisasiAklap)}`)

const perAwalanPanjang = await ambil('', { kodeRekening: '5.1.01.01' })
cek('awalan lebih panjang menjaring lebih sedikit',
  perAwalanPanjang.totals.pagu <= perAwalan.totals.pagu,
  `Rp${rp(perAwalanPanjang.totals.pagu)} <= Rp${rp(perAwalan.totals.pagu)}`)

const rekLeaf = opsi.rekening.find(r => r.dokumen > 0)
if (rekLeaf) {
  const perLeaf = await ambil('', { kodeRekening: rekLeaf.kode })
  const leafNodes = daftarBelanja(perLeaf.data)
  cek('filter satu kode penuh hanya memuat kode itu',
    leafNodes.length > 0 && leafNodes.every(n => n.kode === rekLeaf.kode),
    `${rekLeaf.kode}: ${leafNodes.length} leaf`)
}

const suntik = await ambil('', { kodeRekening: "5.1.01' OR '1'='1" })
cek('upaya suntikan SQL tidak membuka seluruh data',
  suntik.totals.pagu < semua.totals.pagu, `Rp${rp(suntik.totals.pagu)}`)
const wildcard = await ambil('', { kodeRekening: '5.1.01%' })
cek('wildcard pada kode rekening tidak lolos',
  dekat(wildcard.totals.pagu, perAwalan.totals.pagu))
const hurufIkut = await ambil('', { kodeRekening: '5.1.01abc' })
cek('huruf pada kode rekening diabaikan',
  dekat(hurufIkut.totals.pagu, perAwalan.totals.pagu))

console.log('\nFilter bulan')
if (!opsi.bulan.length) {
  console.log('  (tidak ada dokumen realisasi berbulan — bagian ini dilewati)')
} else {
  const bulanUji = opsi.bulan[0].bulan
  const perBulan = await ambil('', { bulan: bulanUji })
  cek('SPP satu bulan <= SPP setahun',
    perBulan.totals.realisasiSpp <= semua.totals.realisasiSpp,
    `bulan ${bulanUji}: Rp${rp(perBulan.totals.realisasiSpp)}`)
  cek('pagu TIDAK ikut terpotong filter bulan',
    dekat(perBulan.totals.pagu, semua.totals.pagu), `Rp${rp(perBulan.totals.pagu)}`)
  cek('AKLAP TIDAK ikut terpotong filter bulan',
    dekat(perBulan.totals.realisasiAklap, semua.totals.realisasiAklap))

  // Jumlah SPP tiap bulan harus sama dengan SPP seluruh dokumen yang berbulan.
  const [[{ spp_berbulan, baris_tanpa_bulan }]] = await db.query(
    `SELECT
       COALESCE(SUM(CASE WHEN bulan IS NOT NULL THEN nilai_realisasi ELSE 0 END), 0) AS spp_berbulan,
       SUM(CASE WHEN bulan IS NULL THEN 1 ELSE 0 END) AS baris_tanpa_bulan
     FROM dokumen_realisasi
     WHERE tahun_id = (SELECT id FROM tahun_anggaran WHERE tahun = ?)`,
    [TAHUN]
  )
  let jumlahPerBulan = 0
  for (const b of opsi.bulan) {
    jumlahPerBulan += (await ambil('', { bulan: b.bulan })).totals.realisasiSpp
  }
  cek('jumlah SPP tiap bulan = SPP seluruh dokumen berbulan',
    dekat(jumlahPerBulan, spp_berbulan), `Rp${rp(jumlahPerBulan)} vs Rp${rp(spp_berbulan)}`)

  const rentangPenuh = await ambil('', { bulanDari: 1, bulanSampai: 12 })
  cek('rentang 1-12 = seluruh dokumen berbulan',
    dekat(rentangPenuh.totals.realisasiSpp, spp_berbulan),
    Number(baris_tanpa_bulan) > 0 ? `${baris_tanpa_bulan} baris tanpa bulan memang tidak ikut` : undefined)

  const bulanAkhir = opsi.bulan[opsi.bulan.length - 1].bulan
  const rentang = await ambil('', { bulanDari: bulanUji, bulanSampai: bulanAkhir })
  cek('rentang bulan >= satu bulan di dalamnya',
    rentang.totals.realisasiSpp >= perBulan.totals.realisasiSpp,
    `${bulanUji}-${bulanAkhir}: Rp${rp(rentang.totals.realisasiSpp)}`)
  const rentangTerbalik = await ambil('', { bulanDari: bulanAkhir, bulanSampai: bulanUji })
  cek('rentang terbalik dinormalkan',
    dekat(rentangTerbalik.totals.realisasiSpp, rentang.totals.realisasiSpp))

  const bulanMenang = await ambil('', { bulan: bulanUji, bulanDari: bulanAkhir, bulanSampai: bulanAkhir })
  cek('bulan tunggal menang atas rentang',
    dekat(bulanMenang.totals.realisasiSpp, perBulan.totals.realisasiSpp))

  const bulanNgawur = await ambil('', { bulan: 99 })
  cek('bulan di luar 1-12 diabaikan',
    dekat(bulanNgawur.totals.realisasiSpp, semua.totals.realisasiSpp))

  console.log('\nFilter gabungan')
  const gabung = await ambil('', { kodeRekening: AWALAN, bulan: bulanUji })
  cek('gabungan rekening + bulan saling mempersempit',
    gabung.totals.realisasiSpp <= Math.min(perAwalan.totals.realisasiSpp, perBulan.totals.realisasiSpp),
    `Rp${rp(gabung.totals.realisasiSpp)}`)
  cek('pagu gabungan = pagu filter rekening saja',
    dekat(gabung.totals.pagu, perAwalan.totals.pagu))
  cek('leaf gabungan tetap berawalan yang diminta',
    daftarBelanja(gabung.data).every(n => String(n.kode).startsWith(AWALAN + '.')))
}

console.log('\nTahun tanpa data')
const kosong = await ambil('', { tahun: 1900 })
cek('tahun tanpa data tidak error', Array.isArray(kosong.data) && kosong.data.length === 0)
const opsiKosong = await ambil('/opsi', { tahun: 1900 })
cek('opsi tahun tanpa data tidak error',
  Array.isArray(opsiKosong.rekening) && opsiKosong.rekening.length === 0)

console.log(`\n${gagal === 0 ? 'SEMUA PENGUJIAN LULUS' : `${gagal} PENGUJIAN GAGAL`}\n`)
await db.end()
process.exit(gagal === 0 ? 0 : 1)
