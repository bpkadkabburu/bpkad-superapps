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
console.log(`  opsi unit/rek/jns : ${opsi.skpd.length} / ${opsi.rekening.length} / ${opsi.jenisDokumen.length}`)
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
const perSkpd = await ambil('', { kodeSubSkpd: skpdUji.kode })
cek('filter Unit SKPD', perSkpd.data.every(r => r.kode_sub_skpd === skpdUji.kode), `${perSkpd.total} dokumen`)
cek('filter Unit SKPD = jumlah di opsi', perSkpd.total === skpdUji.jumlah)

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

const gabung = await ambil('', { kodeSubSkpd: skpdUji.kode, bulan: bulanUji, kodeRekening: '5.1.01.01' })
cek('filter gabungan saling mempersempit',
  gabung.total <= Math.min(perSkpd.total, perBulan.total, perRek.total) &&
  gabung.data.every(r => r.kode_sub_skpd === skpdUji.kode && r.bulan === bulanUji &&
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
cek('baris matriks = seluruh unit berpagu', kel.skpd.length > 0, `${kel.skpd.length} unit`)
cek('baris matriks berkunci kode sub SKPD',
  kel.skpd.every(s => s.kodeSubSkpd && s.namaSubSkpd))
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
  `${kelRek.skpd.length} unit berpagu gaji`)

// Kekurangan = unit yang punya pagu tapi tidak punya dokumen di bulan yang
// bulan itu sudah terisi untuk unit lain.
const kurang = kelRek.skpd.filter(s => kelRek.bulanAda.some(b => !s.perBulan[b]))
console.log(`\nKelengkapan rekening 5.1.01.01 (${kelRek.bulanAda.length} bulan × ${kelRek.skpd.length} unit)`)
console.log(`  unit belum lengkap : ${kurang.length}`)
for (const s of kurang.slice(0, 10)) {
  console.log(`    ${s.namaSubSkpd.slice(0, 44).padEnd(46)} belum: bulan ${kelRek.bulanAda.filter(b => !s.perBulan[b]).join(',')}`)
}
const tanpaPagu = kelRek.skpd.filter(s => s.pagu === 0 && s.dokumen > 0)
console.log(`  ada dokumen tanpa pagu: ${tanpaPagu.length}${tanpaPagu.length ? ' → ' + tanpaPagu.map(s => s.namaSubSkpd).slice(0, 3).join('; ') : ''}`)

console.log('\nUrutan daftar dokumen')
const urutTurun = await ambil('', { sortBy: 'nilai_realisasi', sortDir: 'desc', pageSize: 200 })
const nilaiTurun = urutTurun.data.map(r => Number(r.nilai_realisasi) || 0)
cek('urut nilai realisasi menurun', nilaiTurun.every((v, i) => i === 0 || nilaiTurun[i - 1] >= v),
  `tertinggi Rp${rp(nilaiTurun[0])}`)
const urutNaik = await ambil('', { sortBy: 'nilai_realisasi', sortDir: 'asc', pageSize: 200 })
const nilaiNaik = urutNaik.data.map(r => Number(r.nilai_realisasi) || 0)
cek('urut nilai realisasi menaik', nilaiNaik.every((v, i) => i === 0 || nilaiNaik[i - 1] <= v),
  `terendah Rp${rp(nilaiNaik[0])}`)
cek('mengurutkan tidak mengubah jumlah', urutTurun.total === semua.total && urutNaik.total === semua.total)
const urutTanggal = await ambil('', { sortBy: 'tanggal_dokumen', sortDir: 'desc', pageSize: 50 })
const tgl = urutTanggal.data.map(r => String(r.tanggal_dokumen))
cek('urut tanggal dokumen menurun', tgl.every((v, i) => i === 0 || tgl[i - 1] >= v), tgl[0])
const urutNgawur = await ambil('', { sortBy: 'nilai_realisasi; DROP TABLE x', sortDir: 'desc', pageSize: 10 })
cek('kolom urut di luar daftar putih diabaikan',
  urutNgawur.data[0]?.id === hal1.data[0]?.id, 'kembali ke urutan bawaan')

console.log('\nBatas tanggal')
const bulanTgl = opsi.bulan.find(b => b.tanggalMin && b.tanggalMax && b.tanggalMin !== b.tanggalMax) || opsi.bulan[0]
cek('opsi bulan membawa rentang tanggal', !!bulanTgl.tanggalMin && !!bulanTgl.tanggalMax,
  `bulan ${bulanTgl.bulan}: ${bulanTgl.tanggalMin} s/d ${bulanTgl.tanggalMax}`)

const bulanPenuh = await ambil('', { bulan: bulanTgl.bulan })
const rentangPenuh = await ambil('', {
  bulan: bulanTgl.bulan, tanggalDari: bulanTgl.tanggalMin, tanggalSampai: bulanTgl.tanggalMax,
})
cek('rentang penuh = seluruh dokumen bulan itu', rentangPenuh.total === bulanPenuh.total,
  `${rentangPenuh.total} = ${bulanPenuh.total}`)

const sampaiHariPertama = await ambil('', { bulan: bulanTgl.bulan, tanggalSampai: bulanTgl.tanggalMin })
cek('batas s/d memotong dokumen', sampaiHariPertama.total < bulanPenuh.total,
  `s/d ${bulanTgl.tanggalMin}: ${sampaiHariPertama.total} dari ${bulanPenuh.total}`)
cek('semua dokumen di dalam batas s/d',
  sampaiHariPertama.data.every(r => String(r.tanggal_dokumen).slice(0, 10) <= bulanTgl.tanggalMin))
// Hari terakhir harus ikut terhitung walau tanggal_dokumen menyimpan jam.
const hanyaHariAkhir = await ambil('', {
  bulan: bulanTgl.bulan, tanggalDari: bulanTgl.tanggalMax, tanggalSampai: bulanTgl.tanggalMax,
})
cek('batas dari = sampai tetap memuat hari itu', hanyaHariAkhir.total > 0,
  `${bulanTgl.tanggalMax}: ${hanyaHariAkhir.total} dokumen`)
cek('potongan + sisanya = bulan penuh',
  sampaiHariPertama.total + (await ambil('', {
    bulan: bulanTgl.bulan,
    tanggalDari: new Date(new Date(bulanTgl.tanggalMin + 'T00:00:00Z').getTime() + 86400000)
      .toISOString().slice(0, 10),
  })).total === bulanPenuh.total)
const tglNgawur = await ambil('', { bulan: bulanTgl.bulan, tanggalSampai: "2026-01-01' OR '1'='1" })
cek('tanggal yang tidak berformat diabaikan', tglNgawur.total === bulanPenuh.total)

const kelTgl = await ambil('/kelengkapan', { tanggalSampai: bulanTgl.tanggalMin })
cek('matriks ikut batas tanggal',
  kelTgl.skpd.reduce((a, s) => a + s.dokumen, 0) < kel.skpd.reduce((a, s) => a + s.dokumen, 0))

console.log('\nRekap per rekening')
const rekap = await ambil('/rekap-rekening')
const jumlahNilai = rekap.data.reduce((a, r) => a + r.nilai, 0)
const jumlahDok = rekap.data.reduce((a, r) => a + r.dokumen, 0)
cek('total nilai rekap = ringkasan daftar', Math.round(jumlahNilai) === Math.round(semua.ringkasan.nilai),
  `Rp${rp(jumlahNilai)}`)
cek('total dokumen rekap = total daftar', jumlahDok === semua.total, `${jumlahDok} dokumen`)
cek('urut bawaan nilai terbesar dulu',
  rekap.data.every((r, i) => i === 0 || rekap.data[i - 1].nilai >= r.nilai),
  `${rekap.data.length} rekening`)
cek('rekening tanpa realisasi ikut dibawa (berpagu)',
  rekap.data.some(r => r.dokumen === 0 && r.pagu > 0) || rekap.data.every(r => r.dokumen > 0),
  `${rekap.data.filter(r => r.dokumen === 0).length} rekening belum ada realisasi`)
cek('kode rekening tidak berulang',
  new Set(rekap.data.map(r => r.kode)).size === rekap.data.length)
cek('nilai SP2D tidak melebihi nilai realisasi',
  rekap.data.every(r => r.nilaiSp2d <= r.nilai + 0.01))
cek('ringkasan rekap konsisten dengan barisnya',
  rekap.ringkasan.rekening === rekap.data.length &&
  Math.round(rekap.ringkasan.nilai) === Math.round(jumlahNilai))

const rekapBulan = await ambil('/rekap-rekening', { bulan: bulanTgl.bulan })
cek('rekap ikut filter bulan',
  Math.round(rekapBulan.data.reduce((a, r) => a + r.nilai, 0)) === Math.round(bulanPenuh.ringkasan.nilai),
  `bulan ${bulanTgl.bulan}: Rp${rp(rekapBulan.ringkasan.nilai)}`)
const rekapPotong = await ambil('/rekap-rekening', { bulan: bulanTgl.bulan, tanggalSampai: bulanTgl.tanggalMin })
cek('rekap ikut batas tanggal',
  Math.round(rekapPotong.data.reduce((a, r) => a + r.nilai, 0)) === Math.round(sampaiHariPertama.ringkasan.nilai),
  `s/d ${bulanTgl.tanggalMin}: Rp${rp(rekapPotong.ringkasan.nilai)}`)
const rekapSatu = await ambil('/rekap-rekening', { kodeRekening: '5.1.01.01' })
cek('rekap ikut filter rekening',
  rekapSatu.data.every(r => String(r.kode).startsWith('5.1.01.01')) &&
  Math.round(rekapSatu.data.reduce((a, r) => a + r.nilai, 0)) === Math.round(perRek.ringkasan.nilai),
  `${rekapSatu.data.length} rekening`)

console.log('\nEkspor')
const eksporSemua = await ambil('/ekspor')
cek('ekspor memuat seluruh baris tersaring (tanpa paginasi)',
  eksporSemua.total === semua.total, `${eksporSemua.total.toLocaleString('id-ID')} baris`)
cek('nilai ekspor = ringkasan daftar',
  Math.round(eksporSemua.data.reduce((a, r) => a + (Number(r.nilai_realisasi) || 0), 0))
    === Math.round(semua.ringkasan.nilai),
  `Rp${rp(eksporSemua.data.reduce((a, r) => a + (Number(r.nilai_realisasi) || 0), 0))}`)
cek('tanggal ekspor berformat YYYY-MM-DD (tidak bergeser zona waktu)',
  eksporSemua.data.every(r => r.tanggal_dokumen === null || /^\d{4}-\d{2}-\d{2}$/.test(r.tanggal_dokumen)),
  eksporSemua.data.find(r => r.tanggal_dokumen)?.tanggal_dokumen)
cek('ekspor membawa kolom unit SKPD',
  eksporSemua.data.every(r => 'kode_sub_skpd' in r && 'nama_sub_skpd' in r))

// Inti perpindahan ke sub SKPD: unit di bawah satu SKPD induk (RSUD, puskesmas)
// harus bisa disaring sendiri, bukan ikut terangkut bersama induknya.
const unitPerSkpd = new Map()
for (const r of eksporSemua.data) {
  if (!unitPerSkpd.has(r.kode_skpd)) unitPerSkpd.set(r.kode_skpd, new Set())
  unitPerSkpd.get(r.kode_skpd).add(r.kode_sub_skpd)
}
const indukJamak = [...unitPerSkpd.entries()].filter(([, unit]) => unit.size > 1)
cek('ada SKPD yang isinya lebih dari satu unit', indukJamak.length > 0,
  `${indukJamak.length} SKPD, terbanyak ${Math.max(0, ...indukJamak.map(([, u]) => u.size))} unit`)
if (indukJamak.length) {
  const [indukUji, unitUji] = indukJamak[0]
  const satuUnit = await ambil('/ekspor', { kodeSubSkpd: [...unitUji][0] })
  const seluruhInduk = eksporSemua.data.filter(r => r.kode_skpd === indukUji).length
  cek('menyaring satu unit tidak ikut membawa unit sebelah',
    satuUnit.total < seluruhInduk &&
    satuUnit.data.every(r => r.kode_sub_skpd === [...unitUji][0]),
    `${satuUnit.total} dari ${seluruhInduk} baris SKPD induk`)
}

const eksporSaring = await ambil('/ekspor', { kodeSubSkpd: skpdUji.kode, bulan: bulanUji })
const daftarSaring = await ambil('', { kodeSubSkpd: skpdUji.kode, bulan: bulanUji })
cek('ekspor mengikuti filter yang sama dengan daftar',
  eksporSaring.total === daftarSaring.total &&
  eksporSaring.data.every(r => r.kode_sub_skpd === skpdUji.kode && r.bulan === bulanUji),
  `${eksporSaring.total} baris`)

const eksporUrut = await ambil('/ekspor', { sortBy: 'nilai_realisasi', sortDir: 'desc' })
const nilaiEkspor = eksporUrut.data.map(r => Number(r.nilai_realisasi) || 0)
cek('ekspor mengikuti urutan yang diminta',
  nilaiEkspor.every((v, i) => i === 0 || nilaiEkspor[i - 1] >= v), `tertinggi Rp${rp(nilaiEkspor[0])}`)
cek('ekspor tahun tanpa data tidak error',
  (await ambil('/ekspor', { tahun: 1900 })).total === 0)

console.log(`\n10 rekening realisasi terbesar (${TAHUN})`)
for (const r of rekap.data.filter(x => x.dokumen > 0).slice(0, 10)) {
  const persen = r.persen == null ? '   —  ' : `${r.persen.toFixed(1).padStart(5)}%`
  console.log(`  ${String(r.kode).padEnd(21)} ${String(r.nama).slice(0, 40).padEnd(42)} ` +
    `Rp${rp(r.nilai).padStart(16)}  ${persen}  ${String(r.dokumen).padStart(5)} dok`)
}

console.log(`\n${gagal === 0 ? 'SEMUA PENGUJIAN LULUS' : `${gagal} PENGUJIAN GAGAL`}\n`)
await db.end()
process.exit(gagal === 0 ? 0 : 1)
