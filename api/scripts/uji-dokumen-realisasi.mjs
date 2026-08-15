// Pengujian filter & matriks kelengkapan route /api/sumber-data/dokumen-realisasi
// terhadap database sungguhan. Read-only: hanya GET yang dipanggil.
//
//   cd api && npm run uji:dokumen-realisasi [tahun]

import 'dotenv/config'
import { Hono } from 'hono'
import jwt from 'jsonwebtoken'

import db from '../src/db.js'
import dokumenRealisasi from '../src/routes/dokumenRealisasi.js'

const TAHUN = Number(process.argv[2]) || new Date().getFullYear()

const app = new Hono()
app.route('/api/sumber-data/dokumen-realisasi', dokumenRealisasi)
const token = jwt.sign({ id: 'uji', username: 'uji', role: 'superadmin' }, process.env.JWT_SECRET)

async function ambil(path, params = {}) {
  const url = new URL(`http://uji/api/sumber-data/dokumen-realisasi${path}`)
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

console.log(`\nDokumen Realisasi — TA ${TAHUN}\n`)

const semua = await ambil('')
const opsi = await ambil('/opsi')

if (!semua.total) {
  console.log('Tidak ada data untuk tahun ini — pengujian dihentikan.')
  await db.end()
  process.exit(0)
}

console.log('Data & opsi filter')
console.log(`  dokumen           : ${semua.total.toLocaleString('id-ID')} (nilai Rp${rp(semua.ringkasan.nilai)})`)
console.log(`  sudah SP2D        : ${semua.ringkasan.dokumenSp2d.toLocaleString('id-ID')} dokumen`)
console.log(`  opsi SKPD/rek/jns : ${opsi.skpd.length} / ${opsi.rekening.length} / ${opsi.jenisDokumen.length}`)
console.log(`  bulan ada data    : ${opsi.bulan.map(b => b.bulan).join(',')}`)

console.log('\nPaginasi')
cek('halaman 1 dibatasi pageSize', semua.data.length === Math.min(semua.pageSize, semua.total),
  `${semua.data.length} baris`)
const hal2 = await ambil('', { page: 2, pageSize: 10 })
const hal1 = await ambil('', { page: 1, pageSize: 10 })
cek('halaman berbeda isinya berbeda', hal1.data[0]?.id !== hal2.data[0]?.id)
cek('total konsisten antar halaman', hal1.total === semua.total && hal2.total === semua.total)
const besar = await ambil('', { pageSize: 9999 })
cek('pageSize dibatasi maksimum 500', besar.pageSize === 500, `${besar.pageSize}`)

console.log('\nFilter')
const bulanUji = opsi.bulan[0].bulan
const perBulan = await ambil('', { bulan: bulanUji })
cek('filter bulan', perBulan.data.every(r => r.bulan === bulanUji), `bulan ${bulanUji}: ${perBulan.total} dokumen`)
cek('filter bulan = jumlah di opsi', perBulan.total === opsi.bulan[0].jumlah)

const skpdUji = opsi.skpd[0]
const perSkpd = await ambil('', { kodeSkpd: skpdUji.kode })
cek('filter SKPD', perSkpd.data.every(r => r.kode_skpd === skpdUji.kode), `${perSkpd.total} dokumen`)
cek('filter SKPD = jumlah di opsi', perSkpd.total === skpdUji.jumlah)

const perRek = await ambil('', { kodeRekening: '5.1.01.01' })
cek('filter rekening sebagai awalan',
  perRek.data.every(r => String(r.kode_rekening).startsWith('5.1.01.01')), `${perRek.total} dokumen`)
cek('awalan lebih pendek mencakup lebih banyak',
  (await ambil('', { kodeRekening: '5.1.01' })).total >= perRek.total)

const adaSp2d = await ambil('', { sp2d: 'ada' })
const belumSp2d = await ambil('', { sp2d: 'belum' })
cek('filter SP2D ada', adaSp2d.data.every(r => r.nomor_sp2d && !['', 'null', '-'].includes(String(r.nomor_sp2d).trim().toLowerCase())))
cek('filter SP2D belum', belumSp2d.data.every(r => !r.nomor_sp2d || ['', 'null', '-'].includes(String(r.nomor_sp2d).trim().toLowerCase())))
cek('ada + belum = seluruh dokumen', adaSp2d.total + belumSp2d.total === semua.total,
  `${adaSp2d.total} + ${belumSp2d.total} = ${semua.total}`)

const jenisUji = opsi.jenisDokumen[0]
const perJenis = await ambil('', { jenisDokumen: jenisUji.kode })
cek('filter jenis dokumen', perJenis.total === jenisUji.jumlah, `${jenisUji.kode}: ${perJenis.total}`)

const gabung = await ambil('', { kodeSkpd: skpdUji.kode, bulan: bulanUji, kodeRekening: '5.1.01.01' })
cek('filter gabungan saling mempersempit',
  gabung.total <= Math.min(perSkpd.total, perBulan.total, perRek.total) &&
  gabung.data.every(r => r.kode_skpd === skpdUji.kode && r.bulan === bulanUji &&
    String(r.kode_rekening).startsWith('5.1.01.01')), `${gabung.total} dokumen`)

const cari = await ambil('', { q: 'gaji' })
cek('pencarian bebas mengembalikan subset', cari.total <= semua.total, `${cari.total} dokumen`)
const cariWildcard = await ambil('', { q: '%' })
cek('karakter wildcard di pencarian tidak lolos sebagai wildcard', cariWildcard.total < semua.total,
  `"%" → ${cariWildcard.total} dokumen`)
// Karakter non-angka dibuang, jadi upaya suntikan berubah jadi kode rekening
// yang tidak ada (angka sisanya tetap ikut) — yang penting query tidak jebol.
const suntik = await ambil('', { kodeRekening: "5.1.01.01' OR '1'='1" })
cek('upaya suntikan SQL tidak menambah hasil', suntik.total < semua.total, `${suntik.total} dokumen`)
const hurufIkut = await ambil('', { kodeRekening: '5.1.01.01abc' })
cek('huruf pada kode rekening diabaikan', hurufIkut.total === perRek.total, `${hurufIkut.total}`)
const wildcardKode = await ambil('', { kodeRekening: '5.1.01.01%' })
cek('wildcard pada kode rekening tidak lolos', wildcardKode.total === perRek.total, `${wildcardKode.total}`)

console.log('\nMatriks kelengkapan')
const kel = await ambil('/kelengkapan')
const jumlahSel = kel.skpd.reduce((a, s) => a + Object.keys(s.perBulan).length, 0)
cek('baris matriks = seluruh SKPD berpagu', kel.skpd.length > 0, `${kel.skpd.length} SKPD`)
cek('total dokumen matriks = total keseluruhan',
  kel.skpd.reduce((a, s) => a + s.dokumen, 0) === semua.total)
cek('bulanAda = bulan pada opsi',
  JSON.stringify(kel.bulanAda) === JSON.stringify(opsi.bulan.map(b => b.bulan)),
  kel.bulanAda.join(','))
cek('perBulan berisi 12 bulan', kel.perBulan.length === 12)
cek('setiap sel punya dokumen > 0', kel.skpd.every(s => Object.values(s.perBulan).every(v => v.dokumen > 0)),
  `${jumlahSel} sel terisi`)

const kelRek = await ambil('/kelengkapan', { kodeRekening: '5.1.01.01' })
cek('matriks ikut filter rekening',
  kelRek.skpd.reduce((a, s) => a + s.dokumen, 0) === perRek.total,
  `${kelRek.skpd.length} SKPD berpagu gaji`)

// Kekurangan = SKPD yang punya pagu tapi tidak punya dokumen di bulan yang
// bulan itu sudah terisi untuk SKPD lain.
const kurang = kelRek.skpd.filter(s => kelRek.bulanAda.some(b => !s.perBulan[b]))
console.log(`\nKelengkapan rekening 5.1.01.01 (${kelRek.bulanAda.length} bulan × ${kelRek.skpd.length} SKPD)`)
console.log(`  SKPD belum lengkap : ${kurang.length}`)
for (const s of kurang.slice(0, 10)) {
  console.log(`    ${s.namaSkpd.slice(0, 44).padEnd(46)} belum: bulan ${kelRek.bulanAda.filter(b => !s.perBulan[b]).join(',')}`)
}
const tanpaPagu = kelRek.skpd.filter(s => s.pagu === 0 && s.dokumen > 0)
console.log(`  ada dokumen tanpa pagu: ${tanpaPagu.length}${tanpaPagu.length ? ' → ' + tanpaPagu.map(s => s.namaSkpd).slice(0, 3).join('; ') : ''}`)

console.log(`\n${gagal === 0 ? 'SEMUA PENGUJIAN LULUS' : `${gagal} PENGUJIAN GAGAL`}\n`)
await db.end()
process.exit(gagal === 0 ? 0 : 1)
