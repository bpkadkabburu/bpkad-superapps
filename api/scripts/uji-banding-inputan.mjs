// Pengujian tab "Cek Inputan": pembaca berkas rekap anggaran + pemasangan
// usulan proyeksi dengan pagu hasil input. Read-only terhadap database.
//
//   cd api && npm run uji:banding-inputan [tahun] [prefix]
//
// Berkas rekap anggaran tiruan dibangun dari hasil proyeksi itu sendiri, jadi
// kebenarannya bisa diperiksa tanpa perlu file asli: kalau tiap rekening
// diinput persis sebesar usulannya, seluruh baris harus berstatus SESUAI.
// Sesudah itu beberapa baris sengaja dirusak satu per satu untuk memastikan
// tiap status muncul di tempat yang benar.

import 'dotenv/config'
import ExcelJS from 'exceljs'

import db from '../src/db.js'
import { hitungProyeksiGaji } from '../src/routes/proyeksiGaji.js'
import { hitungProyeksiAkhir } from '../src/utils/proyeksiAkhir.js'
import { normalKodeRekening } from '../src/utils/kodeRekening.js'
import {
  bacaRekapAnggaran, bandingkanInputan, angkaRp, BerkasTidakDikenal,
  matriksBanding, labelKomponen, STATUS_TOTAL,
} from '../../src/utils/bandingInputan.js'
import { buatWorkbookMatriksInputan } from '../../src/utils/matriksInputanExcel.js'

const TAHUN = Number(process.argv[2]) || new Date().getFullYear()
const PREFIX = process.argv[3] || '5.1.01.01'

let gagal = 0
function cek(nama, lulus, catatan) {
  if (lulus) console.log(`  ok    ${nama}${catatan ? `  (${catatan})` : ''}`)
  else { gagal++; console.log(`  GAGAL ${nama}${catatan ? `  (${catatan})` : ''}`) }
}

const rp = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID')

// Header persis seperti berkas rekap anggaran (rekap4/rekap5) yang dipakai
// menu Anggaran Rekap — termasuk kolom yang tidak dibaca, supaya penyaringan
// kolomnya ikut teruji.
const HEADER = [
  'NO', 'KODE URUSAN', 'NAMA URUSAN', 'KODE SKPD', 'NAMA SKPD',
  'KODE SUB UNIT', 'NAMA SUB UNIT', 'KODE REKENING', 'NAMA REKENING', 'PAGU',
]

async function berkasTiruan(baris, nama = 'rekap-uji.xlsx') {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Sheet1')
  ws.addRow(HEADER)
  baris.forEach((b, i) => {
    ws.addRow([
      i + 1, '1', 'URUSAN UJI', b.kodeSkpd, b.namaSkpd,
      b.kodeSkpd, b.namaSkpd, b.kodeRekening, b.namaRekening, b.pagu,
    ])
  })
  const buf = await wb.xlsx.writeBuffer()
  return { name: nama, arrayBuffer: async () => buf }
}

console.log(`\nUJI CEK INPUTAN — TA ${TAHUN}, rekening ${PREFIX}*\n`)

// ---- 1. Penguraian angka rupiah ----------------------------------------
console.log('Angka rupiah dari berbagai bentuk sel:')
cek('angka polos', angkaRp(1234567) === 1234567)
cek('teks bertitik ribuan', angkaRp('1.234.567') === 1234567, '1.234.567')
cek('teks berkoma desimal', angkaRp('1.234.567,50') === 1234567.5, '1.234.567,50')
cek('desimal titik tanpa ribuan', angkaRp('1.5') === 1.5, 'bukan 15')
cek('berawalan Rp', angkaRp('Rp 2.000.000') === 2000000)
cek('hasil rumus', angkaRp({ formula: 'A1*2', result: 4200 }) === 4200)
cek('kosong', angkaRp(null) === 0 && angkaRp('') === 0)

const data = await hitungProyeksiGaji({ tahun: TAHUN, prefix: PREFIX })
if (!data.skpd.length) {
  console.log(`\nTidak ada data gaji untuk TA ${TAHUN} — pengujian yang butuh database dilewati.`)
  await db.end?.()
  process.exit(gagal ? 1 : 0)
}
const akhir = hitungProyeksiAkhir(data, { persen: 2.5, tambahanFix: 200000 })

// Berkas "input sempurna": tiap rekening diinput persis sebesar usulannya.
const sempurna = []
for (const s of akhir.skpd) {
  for (const r of s.rekening) {
    sempurna.push({
      kodeSkpd: s.kodeSkpd, namaSkpd: s.namaSkpd,
      kodeRekening: r.kodeRekening, namaRekening: r.namaRekening,
      pagu: r.alokasi,
    })
  }
}
console.log(`\nBerkas tiruan: ${sempurna.length} baris dari ${akhir.skpd.length} dinas`)

// ---- 2. Pembacaan berkas ------------------------------------------------
console.log('\nPembacaan berkas rekap anggaran:')
const baca = await bacaRekapAnggaran(await berkasTiruan(sempurna), { prefix: PREFIX })
cek('jumlah rekening terbaca', baca.jumlahRekening === sempurna.length,
  `${baca.jumlahRekening} vs ${sempurna.length}`)
cek('jumlah dinas terbaca', baca.jumlahDinas === akhir.skpd.length,
  `${baca.jumlahDinas} vs ${akhir.skpd.length}`)
const totalUsulan = sempurna.reduce((a, b) => a + b.pagu, 0)
cek('total pagu terbaca utuh', Math.abs(baca.totalPagu - totalUsulan) < 1,
  `${rp(baca.totalPagu)} vs ${rp(totalUsulan)}`)

// Baris di luar awalan harus disaring, bukan ikut terhitung.
const adaSampah = await berkasTiruan([
  ...sempurna,
  { kodeSkpd: sempurna[0].kodeSkpd, namaSkpd: 'X', kodeRekening: '5.1.02.01.001.00001', namaRekening: 'Belanja ATK', pagu: 999 },
])
const bacaSampah = await bacaRekapAnggaran(adaSampah, { prefix: PREFIX })
cek('baris di luar awalan disaring', bacaSampah.jumlahRekening === sempurna.length,
  `${bacaSampah.barisData} baris data, ${bacaSampah.barisTerpakai} terpakai`)

// Berkas tanpa kolom wajib harus ditolak dengan pesan yang jelas, bukan diam-diam kosong.
const wbRusak = new ExcelJS.Workbook()
wbRusak.addWorksheet('Sheet1').addRow(['NO', 'NAMA SKPD', 'JUMLAH'])
const bufRusak = await wbRusak.xlsx.writeBuffer()
let ditolak = false
try {
  await bacaRekapAnggaran({ name: 'salah.xlsx', arrayBuffer: async () => bufRusak }, { prefix: PREFIX })
} catch (e) { ditolak = e instanceof BerkasTidakDikenal }
cek('berkas tanpa KODE REKENING ditolak', ditolak)

// ---- 3. Input sempurna = seluruhnya SESUAI ------------------------------
console.log('\nInput yang persis sama dengan usulan:')
const b1 = bandingkanInputan(akhir, baca, { sisi: 'rumus', toleransi: 0 })
cek('semua baris SESUAI', b1.total.sesuai === b1.total.jumlah,
  `${b1.total.sesuai}/${b1.total.jumlah}`)
cek('tidak ada yang bermasalah', b1.jumlahBermasalah === 0)
cek('tidak ada baris di luar usulan', b1.total.ekstra === 0)
cek('total selisih nol', b1.total.selisih === 0, rp(b1.total.selisih))
cek('total usulan = total diinput', b1.total.usulan === b1.total.inputan,
  `${rp(b1.total.usulan)}`)
cek('jumlah dinas utuh', b1.dinas.length === akhir.skpd.length)

// ---- 4. Tiap status muncul di tempat yang benar -------------------------
console.log('\nBerkas yang sengaja dirusak:')
const rusak = sempurna.map(b => ({ ...b }))
const iKurang = 0
const iLebih = 1
rusak[iKurang].pagu -= 5_000_000
rusak[iLebih].pagu += 7_000_000
// Satu baris dihapus (jadi "belum ada"), satu baris asing ditambahkan.
const dihapus = rusak.pop()
rusak.push({
  kodeSkpd: sempurna[0].kodeSkpd, namaSkpd: sempurna[0].namaSkpd,
  kodeRekening: '5.1.01.01.999.00001', namaRekening: 'Belanja Gaji Karangan', pagu: 123_456,
})
const b2 = bandingkanInputan(akhir, await bacaRekapAnggaran(await berkasTiruan(rusak), { prefix: PREFIX }),
  { sisi: 'rumus', toleransi: 0 })

const cari = (kodeSkpd, kodeRekening) => b2.baris.find(x =>
  x.kodeSkpd === kodeSkpd && normalKodeRekening(x.kodeRekening) === normalKodeRekening(kodeRekening))

const rKurang = cari(sempurna[iKurang].kodeSkpd, sempurna[iKurang].kodeRekening)
cek('baris yang dikurangi berstatus KURANG', rKurang?.status === 'kurang', rKurang?.status)
cek('selisihnya tepat −5.000.000', rKurang?.selisih === -5_000_000, rp(rKurang?.selisih))

const rLebih = cari(sempurna[iLebih].kodeSkpd, sempurna[iLebih].kodeRekening)
cek('baris yang dilebihkan berstatus LEBIH', rLebih?.status === 'lebih', rLebih?.status)
cek('selisihnya tepat +7.000.000', rLebih?.selisih === 7_000_000, rp(rLebih?.selisih))

const rHilang = cari(dihapus.kodeSkpd, dihapus.kodeRekening)
cek('baris yang dihapus berstatus BELUM ADA', rHilang?.status === 'hilang', rHilang?.status)
cek('yang belum ada tidak punya angka inputan', rHilang?.inputan === null)

const rEkstra = b2.baris.filter(x => x.status === 'ekstra')
cek('rekening asing muncul sebagai DI LUAR USULAN', rEkstra.length === 1, `${rEkstra.length} baris`)
cek('nilainya terbawa apa adanya', rEkstra[0]?.inputan === 123_456)

cek('cacah status berjumlah total', b2.total.sesuai + b2.total.kurang + b2.total.lebih +
  b2.total.hilang + b2.total.ekstra === b2.total.jumlah)
cek('jumlahBermasalah = total − sesuai', b2.jumlahBermasalah === b2.total.jumlah - b2.total.sesuai,
  `${b2.jumlahBermasalah}`)

// ---- 5. Toleransi --------------------------------------------------------
console.log('\nToleransi:')
const tipis = sempurna.map(b => ({ ...b }))
tipis[0].pagu -= 900
const bacaTipis = await bacaRekapAnggaran(await berkasTiruan(tipis), { prefix: PREFIX })
const bTanpaTol = bandingkanInputan(akhir, bacaTipis, { sisi: 'rumus', toleransi: 0 })
const bDenganTol = bandingkanInputan(akhir, bacaTipis, { sisi: 'rumus', toleransi: 1000 })
cek('selisih 900 tanpa toleransi = KURANG', bTanpaTol.total.kurang === 1, `${bTanpaTol.total.kurang}`)
cek('selisih 900 dengan toleransi 1.000 = SESUAI', bDenganTol.total.kurang === 0 &&
  bDenganTol.total.sesuai === bDenganTol.total.jumlah)

// ---- 6. Sisi Sim Gaji ----------------------------------------------------
console.log('\nPatokan sisi Sim Gaji:')
const simSempurna = akhir.skpd.flatMap(s => s.rekening.map(r => ({
  kodeSkpd: s.kodeSkpd, namaSkpd: s.namaSkpd,
  kodeRekening: r.kodeRekening, namaRekening: r.namaRekening,
  pagu: r.alokasiSim,
})))
const bacaSim = await bacaRekapAnggaran(await berkasTiruan(simSempurna), { prefix: PREFIX })
const bSim = bandingkanInputan(akhir, bacaSim, { sisi: 'sim', toleransi: 0 })
cek('input sebesar usulan Sim = seluruhnya SESUAI', bSim.total.sesuai === bSim.total.jumlah,
  `${bSim.total.sesuai}/${bSim.total.jumlah}`)
const bSimVsRumus = bandingkanInputan(akhir, bacaSim, { sisi: 'rumus', toleransi: 0 })
cek('patokan mengubah hasil kalau dua sisi memang beda',
  akhir.totalAlokasiAktifSim === akhir.totalAlokasiAktif ||
  bSimVsRumus.total.sesuai < bSimVsRumus.total.jumlah,
  `sesuai ${bSimVsRumus.total.sesuai}/${bSimVsRumus.total.jumlah}`)

// ---- 7. Kode rekening lintas format --------------------------------------
// Berkas tahun lama memakai segmen 2/4 digit. Kalau pencocokannya mentah,
// seluruh baris akan jatuh jadi "belum ada" + "di luar usulan".
console.log('\nKode rekening format lama (2/4 digit):')
const sempit = (kode) => {
  const s = String(kode).split('.')
  if (s.length < 6) return kode
  s[4] = s[4].replace(/^0+(?=\d{2}$)/, '')
  s[5] = s[5].replace(/^0+(?=\d{4}$)/, '')
  return s.join('.')
}
const formatLama = sempurna.map(b => ({ ...b, kodeRekening: sempit(b.kodeRekening) }))
const adaYangBerubah = formatLama.some((b, i) => b.kodeRekening !== sempurna[i].kodeRekening)
if (!adaYangBerubah) {
  console.log('  lewat  data TA ini sudah format lama — tidak ada yang bisa dipersempit')
} else {
  const bLama = bandingkanInputan(akhir,
    await bacaRekapAnggaran(await berkasTiruan(formatLama), { prefix: PREFIX }),
    { sisi: 'rumus', toleransi: 0 })
  cek('berkas format lama tetap berpasangan', bLama.total.sesuai === bLama.total.jumlah,
    `${bLama.total.sesuai}/${bLama.total.jumlah}`)
  cek('tidak ada yang jatuh jadi DI LUAR USULAN', bLama.total.ekstra === 0)
}

// ---- 8. Matriks dinas × komponen per golongan ---------------------------
console.log('\nMatriks per golongan:')
cek('label komponen Gaji Pokok', labelKomponen('Belanja Gaji Pokok PNS') === 'Gaji Pokok')
cek('label komponen Kematian', labelKomponen('Belanja Iuran Jaminan Kematian PPPK') === 'Kematian')
cek('label komponen PPh', labelKomponen('Belanja Tunjangan PPh/Tunjangan Khusus PNS') === 'PPh/Khusus')

const m1 = matriksBanding(b1)
console.log(`  info  golongan: ${m1.map(m => `${m.label} (${m.baris.length} dinas × ${m.kolom.length} komponen)`).join(', ')}`)
cek('input sempurna → seluruh sel TRUE', m1.every(m => m.jumlahSalah === 0))
cek('jumlah sel = jumlah baris banding',
  m1.reduce((a, m) => a + m.baris.reduce((x, d) => x + Object.keys(d.sel).length, 0), 0) === b1.baris.length)
cek('Σ hitungan matriks = total usulan',
  Math.abs(m1.reduce((a, m) => a + m.jumlahHitungan, 0) - b1.total.usulan) < 1)

const m2 = matriksBanding(b2)
const salah2 = m2.reduce((a, m) => a + m.jumlahSalah, 0)
cek('berkas rusak → FALSE di sel yang dirusak', salah2 >= 3, `${salah2} sel FALSE`)
const gKurang = m2.flatMap(m => m.baris).find(d => d.kodeSkpd === sempurna[iKurang].kodeSkpd && !d.cocok)
cek('dinas yang dirusak bertanda tidak semua cocok', !!gKurang)

const buf = await buatWorkbookMatriksInputan(m2, {
  tahun: TAHUN, sisi: 'rumus', persenAcress: '2,5%', toleransi: 0, namaBerkas: 'rekap-uji.xlsx',
})
const wbM = new ExcelJS.Workbook()
await wbM.xlsx.load(buf)
cek('satu sheet per golongan', wbM.worksheets.length === m2.length,
  wbM.worksheets.map(w => w.name).join(', '))
let formulaFalse = 0
wbM.worksheets[0].eachRow(row => row.eachCell(c => {
  if (c.formula && /^ABS\(/.test(c.formula) && c.result === false) formulaFalse += 1
}))
cek('rumus PERBANDINGAN ada dan hasilnya sama dengan matriks', formulaFalse === m2[0].jumlahSalah,
  `${formulaFalse} vs ${m2[0].jumlahSalah}`)
// ---- 9. Saling tutup vs signifikan -------------------------------------
console.log('\nSaling tutup antar-rekening:')
const golDari = (kode) => normalKodeRekening(kode).split('.')[5]
// Cari dua dinas yang masing-masing punya ≥2 rekening PNS.
const perDinasGol = new Map()
sempurna.forEach((b, i) => {
  const k = `${b.kodeSkpd}|${golDari(b.kodeRekening)}`
  if (!perDinasGol.has(k)) perDinasGol.set(k, [])
  perDinasGol.get(k).push(i)
})
const [kA, kB, kC] = [...perDinasGol.keys()].filter(k => perDinasGol.get(k).length >= 2 &&
  golDari(sempurna[perDinasGol.get(k)[0]].kodeRekening) === golDari(sempurna[0].kodeRekening))
const tutup = sempurna.map(b => ({ ...b }))
// A: pindah 3 juta dari rekening pertama ke rekening kedua — jumlah dinas tetap.
tutup[perDinasGol.get(kA)[0]].pagu -= 3_000_000
tutup[perDinasGol.get(kA)[1]].pagu += 3_000_000
// B: kurang 4 juta beneran.
tutup[perDinasGol.get(kB)[0]].pagu -= 4_000_000
// C: lebih 4 juta — total golongan jadi pas, tapi B dan C tetap signifikan.
tutup[perDinasGol.get(kC)[0]].pagu += 4_000_000
const bTutup = bandingkanInputan(akhir, await bacaRekapAnggaran(await berkasTiruan(tutup), { prefix: PREFIX }),
  { sisi: 'rumus', toleransi: 0 })
const mTutup = matriksBanding(bTutup)
const gPns = mTutup.find(m => m.kunci === golDari(sempurna[0].kodeRekening))
const dRow = (k) => gPns.baris.find(d => d.kodeSkpd === k.split('|')[0])
cek('pindah antar-rekening dalam satu dinas = SALING TUTUP', dRow(kA).status === STATUS_TOTAL.SALING_TUTUP,
  `${dRow(kA).status}, ${dRow(kA).salah} rekening FALSE`)
cek('kurang beneran = SIGNIFIKAN', dRow(kB).status === STATUS_TOTAL.SIGNIFIKAN, dRow(kB).status)
cek('lebih beneran = SIGNIFIKAN', dRow(kC).status === STATUS_TOTAL.SIGNIFIKAN, dRow(kC).status)
cek('dinas antar-dinas tidak saling menutup, tapi total golongan pas',
  gPns.dinasSignifikan === 2 && !gPns.totalSignifikan, `${gPns.dinasSignifikan} signifikan, selisih ${rp(gPns.selisih)}`)
const mTol = matriksBanding(bTutup, { toleransiTotal: 5_000_000 })
cek('batas total 5 juta → B & C ikut jadi saling tutup',
  mTol.every(m => m.dinasSignifikan === 0))
const bufT = await buatWorkbookMatriksInputan(mTutup, {
  tahun: TAHUN, sisi: 'rumus', persenAcress: '2,5%', toleransi: 0, toleransiTotal: 0, namaBerkas: 'uji.xlsx',
})
const wbT = new ExcelJS.Workbook()
await wbT.xlsx.load(bufT)
const hasilStatus = []
wbT.getWorksheet(gPns.label).eachRow(row => row.eachCell(c => {
  if (c.formula && c.formula.startsWith('IF(COUNTIF(') && typeof c.result === 'string') hasilStatus.push(c.result)
}))
cek('kolom Total dinas di Excel sama dengan layar',
  hasilStatus.filter(x => x === 'SIGNIFIKAN').length === 2 &&
  hasilStatus.filter(x => x === 'SALING TUTUP').length === 1, hasilStatus.filter(x => x !== 'COCOK').join(', '))

if (process.env.SIMPAN_MATRIKS) {
  await (await import('node:fs/promises')).writeFile(process.env.SIMPAN_MATRIKS + '.tutup.xlsx', Buffer.from(bufT))
}
if (process.env.SIMPAN_MATRIKS) {
  const fs = await import('node:fs/promises')
  await fs.writeFile(process.env.SIMPAN_MATRIKS, Buffer.from(buf))
  console.log(`  info  disimpan ke ${process.env.SIMPAN_MATRIKS}`)
}

console.log(gagal ? `\n${gagal} pengujian GAGAL\n` : '\nSemua pengujian lulus\n')
await db.end?.()
process.exit(gagal ? 1 : 0)
