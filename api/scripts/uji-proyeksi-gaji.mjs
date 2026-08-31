// Pengujian route /api/proyeksi-gaji + pembangun Excel-nya terhadap database
// sungguhan. Read-only: tidak ada satu pun query tulis di sini.
//
//   cd api && npm run uji:proyeksi-gaji [tahun] [prefix]
//
// Yang diperiksa: konsistensi agregat (pagu/realisasi/proyeksi antar level),
// lalu file .xlsx dibangun sungguhan, ditulis ke direktori sementara, dibaca
// ulang, dan diperiksa (jumlah sheet, nama sheet legal & unik, formula utuh).

import 'dotenv/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile, unlink } from 'node:fs/promises'
import ExcelJS from 'exceljs'

import db from '../src/db.js'
import { hitungProyeksiGaji } from '../src/routes/proyeksiGaji.js'
import { hitungProyeksiAkhir } from '../src/utils/proyeksiAkhir.js'
import { buatWorkbookProyeksiGaji, namaFileProyeksiGaji } from '../../src/utils/proyeksiGajiExcel.js'

const TAHUN = Number(process.argv[2]) || new Date().getFullYear()
const PREFIX = process.argv[3] || '5.1.01.01'

let gagal = 0
function cek(nama, lulus, catatan) {
  if (lulus) {
    console.log(`  ok    ${nama}${catatan ? `  (${catatan})` : ''}`)
  } else {
    gagal++
    console.log(`  GAGAL ${nama}${catatan ? `  (${catatan})` : ''}`)
  }
}

const rp = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID')
const dekat = (a, b, toleransi = 1) => Math.abs(Number(a) - Number(b)) < toleransi

console.log(`\nProyeksi Gaji — TA ${TAHUN}, rekening ${PREFIX}*\n`)

const data = await hitungProyeksiGaji({ tahun: TAHUN, prefix: PREFIX })
// Route yang menempelkan blok ini ke payload; di sini dipasang manual karena
// hitungProyeksiGaji dipanggil langsung.
data.akhir = hitungProyeksiAkhir(data)

if (!data.skpd.length) {
  console.log('Tidak ada data untuk tahun/prefix ini — pengujian dihentikan.')
  await db.end()
  process.exit(0)
}

console.log('Ringkasan data')
console.log(`  bulan realisasi   : ${data.bulanList.join(',')} (terakhir ${data.bulanTerakhir}, sisa ${data.bulanSisa} bulan)`)
console.log(`  SKPD / rekening   : ${data.skpd.length} / ${data.rekening.length}`)
console.log(`  bulan-gaji kab.   : ${data.bulanGajiTerbayarTotal} (median bulanan Rp${rp(data.medianTotal)})`)
console.log(`  anggaran          : Rp${rp(data.totals.pagu)}`)
console.log(`  realisasi (SP2D)  : Rp${rp(data.totals.sp2d)}`)
console.log(`  sisa anggaran     : Rp${rp(data.totals.sisa)}`)
console.log(`  kebutuhan ${String(data.bulanSisa).padEnd(2)} bln  : Rp${rp(data.totals.proyeksi)}`)
console.log(`  selisih           : Rp${rp(data.totals.selisih)} → ${data.totals.selisih < 0 ? 'KURANG' : 'CUKUP'}`)

// Seberapa jauh basis "tertinggi" di atas "rata-rata" — inilah ukuran seberapa
// timpang dasar proyeksinya kalau ternyata gaji naik di sisa tahun.
const dataTinggi = await hitungProyeksiGaji({ tahun: TAHUN, prefix: PREFIX, basis: 'tertinggi' })
console.log('\nBasis proyeksi')
console.log(`  rata-rata tiap bayar : Rp${rp(data.totals.proyeksi)} untuk ${data.bulanSisa} bulan`)
console.log(`  tertinggi sekali bayar: Rp${rp(dataTinggi.totals.proyeksi)} ` +
  `(+${((dataTinggi.totals.proyeksi / (data.totals.proyeksi || 1) - 1) * 100).toFixed(2)}%)`)
const naik = data.skpd.filter(s => s.tren > 1.01).sort((a, b) => b.tren - a.tren)
console.log(`  dinas yang 3 bayar terakhirnya di atas rata-rata: ${naik.length}` +
  (naik.length ? ` → ${naik.slice(0, 3).map(s => `${s.namaSkpd} (${s.tren.toFixed(3)}×)`).join('; ')}` : ''))
const turun = data.skpd.filter(s => s.tren > 0 && s.tren < 0.99).length
console.log(`  dinas yang belakangan turun: ${turun} dari ${data.skpd.length}`)

console.log('\nKonsistensi agregat')
cek('sisa = anggaran − realisasi', dekat(data.totals.sisa, data.totals.pagu - data.totals.sp2d))
cek('selisih = sisa − kebutuhan', dekat(data.totals.selisih, data.totals.sisa - data.totals.proyeksi))
cek('total anggaran = Σ SKPD', dekat(data.totals.pagu, data.skpd.reduce((a, s) => a + s.pagu, 0)))
cek('total kebutuhan = Σ SKPD', dekat(data.totals.proyeksi, data.skpd.reduce((a, s) => a + s.proyeksi, 0)))
cek('anggaran SKPD = Σ rekening',
  data.skpd.every(s => dekat(s.pagu, s.rekening.reduce((a, r) => a + r.pagu, 0))))
cek('realisasi SKPD = Σ rekening',
  data.skpd.every(s => dekat(s.sp2d, s.rekening.reduce((a, r) => a + r.sp2d, 0))))
cek('kebutuhan SKPD = Σ rekening',
  data.skpd.every(s => dekat(s.proyeksi, s.rekening.reduce((a, r) => a + r.proyeksi, 0))))
cek('rekap rekening = Σ seluruh SKPD',
  dekat(data.rekening.reduce((a, r) => a + r.pagu, 0), data.totals.pagu))
cek('realisasi per bulan = total realisasi',
  dekat(data.totalPerBulan.reduce((a, n) => a + n, 0), data.totals.sp2d))
cek('rekening urut kode',
  data.skpd.every(s => s.rekening.every((r, i) => i === 0 || r.kodeRekening >= s.rekening[i - 1].kodeRekening)))
cek('pembagi bulan-gaji > 0', data.skpd.every(s => s.bulanGajiTerbayar > 0))

const kurang = data.skpd.filter(s => s.selisih < 0)
const menyimpang = data.skpd.filter(s => Math.abs(s.bulanGajiTerbayar - data.bulanGajiTerbayarTotal) >= 1)
console.log('\nTemuan')
console.log(`  SKPD kurang anggaran        : ${kurang.length} (total Rp${rp(kurang.reduce((a, s) => a + s.selisih, 0))})`)
console.log(`  laju bayar menyimpang ≥1 bln: ${menyimpang.length}${menyimpang.length ? ' → ' + menyimpang.slice(0, 3).map(s => `${s.namaSkpd} (${s.bulanGajiTerbayar})`).join('; ') : ''}`)
console.log(`  pembagi perkiraan           : ${data.skpd.filter(s => s.pembagiPerkiraan).length}`)

console.log('\n5 SKPD pertama')
for (const s of data.skpd.slice(0, 5)) {
  console.log(`  ${s.namaSkpd.slice(0, 36).padEnd(38)} bln-gaji ${String(s.bulanGajiTerbayar).padStart(6)}` +
    ` | /bln ${rp(s.perBulanRutin).padStart(14)} | butuh ${rp(s.proyeksi).padStart(15)} | selisih ${rp(s.selisih).padStart(15)}`)
}

// ---- Proyeksi akhir terhadap data sungguhan ----
const akhir = data.akhir
console.log('\nProyeksi akhir')
console.log(`  pagu tersedia     : Rp${rp(akhir.kantong)}${akhir.jumlahTerkunci ? ` (+ Rp${rp(akhir.paguTerkunci)} dikunci, ${akhir.jumlahTerkunci} dinas)` : ''}`)
console.log(`  kebutuhan s.d Des : Rp${rp(akhir.totalKebutuhan)}`)
console.log(`  usulan +${akhir.persenCadangan}%     : Rp${rp(akhir.totalIdeal)}`)
console.log(`  cadangan terpakai : ${akhir.persenAkhir.toFixed(3)}% (Rp${rp(akhir.totalCadanganAkhir)})`)
console.log(`  pergeseran        : +Rp${rp(akhir.pergeseranMasuk)} ke ${akhir.jumlahTambah} dinas, ` +
  `−Rp${rp(-akhir.pergeseranKeluar)} dari ${akhir.jumlahKurangi} dinas`)
console.log(`  status            : ${akhir.cukup ? `CUKUP (sisa Rp${rp(akhir.sisaKantong)})` : `KURANG Rp${rp(akhir.defisitRiil)}`}`)

cek('tidak ada dinas di bawah kebutuhan gajinya',
  akhir.skpd.every(s => s.terkunci || s.alokasi >= s.kebutuhan),
  akhir.skpd.filter(s => !s.terkunci && s.alokasi < s.kebutuhan).map(s => s.namaSkpd).join(', ') || 'semua aman')
cek('Σ rekening = alokasi dinas',
  akhir.skpd.every(s => s.rekening.reduce((a, r) => a + r.alokasi, 0) === s.alokasi))
cek('tiap rekening ≥ kebutuhannya',
  akhir.skpd.every(s => s.terkunci || s.rekening.every(r => r.alokasi >= r.kebutuhan)))
cek('kebutuhan dinas = realisasi + proyeksi',
  akhir.skpd.every(s => dekat(s.kebutuhan, s.sp2d + s.proyeksi, 2)))
cek('pagu proyeksi akhir = pagu proyeksi kebutuhan',
  dekat(akhir.totalPagu, data.totals.pagu, data.skpd.length + 1),
  `Rp${rp(akhir.totalPagu)} vs Rp${rp(data.totals.pagu)}`)
if (akhir.cukup && akhir.faktorPotong > 0) {
  cek('kantong terpakai habis (Σ alokasi = pagu tersedia)', akhir.totalAlokasiAktif === akhir.kantong,
    `Rp${rp(akhir.totalAlokasiAktif)} vs Rp${rp(akhir.kantong)}`)
  cek('pergeseran nol jumlah', akhir.pergeseranMasuk + akhir.pergeseranKeluar === 0)
}
cek('rekap rekening = Σ seluruh dinas',
  akhir.rekening.reduce((a, r) => a + r.alokasi, 0) === akhir.totalAlokasi)

console.log('\nGolongan pegawai')
for (const g of akhir.golongan) {
  console.log(`  ${String(g.label).padEnd(6)} ${String(g.jumlahRekening).padStart(2)} rekening | ` +
    `bln terakhir Rp${rp(g.realisasiTerakhir).padStart(15)} | kebutuhan Rp${rp(g.kebutuhan).padStart(15)} | ` +
    `alokasi Rp${rp(g.alokasi).padStart(15)} | geser Rp${rp(g.pergeseran).padStart(14)}`)
}
cek('golongan terbaca dari nama rekening', akhir.golongan.length >= 2,
  akhir.golongan.map(g => `${g.kunci}=${g.label}`).join(' '))
cek('Σ golongan = total alokasi',
  akhir.golongan.reduce((a, g) => a + g.alokasi, 0) === akhir.totalAlokasi)
cek('rekening berkumpul per golongan (rekap)',
  akhir.rekening.every((r, i) => i === 0 || r.golongan >= akhir.rekening[i - 1].golongan))
cek('rekening berkumpul per golongan (tiap dinas)',
  akhir.skpd.every(s => s.rekening.every((r, i) => i === 0 || r.golongan >= s.rekening[i - 1].golongan)))
// Akres menempel di tiap rekening, bukan dibagi rata menurut pagu.
{
  const faktor = 1 + akhir.persenAkhir / 100
  const meleset = akhir.skpd.filter(s => !s.terkunci).flatMap(s =>
    s.rekening.filter(r => r.kebutuhan > 0 &&
      Math.abs(r.alokasi - r.kebutuhan * faktor) > s.rekening.length + 1)
      .map(r => `${s.kodeSkpd}/${r.kodeRekening}`))
  cek(`cadangan ${akhir.persenAkhir.toFixed(3)}% menempel di tiap rekening`, meleset.length === 0,
    meleset.slice(0, 3).join(', ') || `${akhir.skpd.reduce((a, s) => a + s.rekening.length, 0)} rekening diperiksa`)
}

// Pembagi tiap rekening harus benar-benar berbeda — iuran BPJS dibayar sekali
// sebulan, gaji pokok ikut terbayar di bulan THR dan gaji ke-13.
{
  const laju = akhir.rekening.map(r => r.dibayar).filter(n => n > 0)
  const beda = Math.max(...laju) - Math.min(...laju)
  cek('laju bayar berbeda antar rekening', beda > 0.5,
    `${Math.min(...laju).toFixed(2)}× s.d. ${Math.max(...laju).toFixed(2)}×`)
  console.log('\nLaju bayar per rekening (pembagi proyeksi)')
  for (const r of akhir.rekening) {
    console.log(`  ${r.kodeRekening}  ${String(r.dibayar).padStart(6)}×  ${r.namaRekening}`)
  }
}

cek('subtotal golongan tiap dinas = Σ rekeningnya',
  akhir.skpd.every(s => s.golongan.every(g =>
    s.rekening.filter(r => r.golongan === g.kunci).reduce((a, r) => a + r.alokasi, 0) === g.alokasi)))

console.log('\nRealisasi bulan terakhir (dasar kroscek)')
for (const s of akhir.skpd.slice(0, 5)) {
  console.log(`  ${s.namaSkpd.slice(0, 34).padEnd(36)} bln ${String(s.bulanTerakhirSkpd).padStart(2)} ` +
    `| Rp${rp(s.realisasiTerakhir).padStart(14)} (${s.sp2dTerakhir} SP2D) | rata² Rp${rp(s.perBulanRutin).padStart(14)}`)
}
cek('Σ realisasi bulan terakhir rekening = milik dinasnya',
  akhir.skpd.filter(s => !s.terkunci).every(s =>
    Math.abs(s.rekening.reduce((a, r) => a + r.realisasiTerakhir, 0) - s.realisasiTerakhir) <= s.rekening.length))
const ganda = akhir.skpd.filter(s => s.sp2dTerakhir > 1)
console.log(`  dinas dengan >1 SP2D di bulan terakhir: ${ganda.length}` +
  (ganda.length ? ` → ${ganda.slice(0, 3).map(s => `${s.namaSkpd} (${s.sp2dTerakhir})`).join('; ')}` : ''))

// ---- Bangun & baca ulang file Excel ----
console.log('\nFile Excel')
const buf = await buatWorkbookProyeksiGaji(data, { tahun: TAHUN })
const berkas = join(tmpdir(), namaFileProyeksiGaji(TAHUN, data.prefix, data.bulanTerakhir))
await writeFile(berkas, Buffer.from(buf))
console.log(`  ditulis           : ${berkas} (${(buf.byteLength / 1024).toFixed(0)} KB)`)

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(berkas)
const nama = wb.worksheets.map(w => w.name)

cek('file bisa dibaca ulang', wb.worksheets.length > 0)
cek('jumlah sheet = 5 + jumlah SKPD', wb.worksheets.length === data.skpd.length + 5,
  `${wb.worksheets.length} sheet`)
cek('sheet pertama = REKAP', nama[0] === 'REKAP')
cek('ada sheet PER BULAN & REKAP REKENING',
  nama.includes('PER BULAN') && nama.includes('REKAP REKENING'))
cek('ada sheet PROYEKSI AKHIR & AKHIR REKENING',
  nama.includes('PROYEKSI AKHIR') && nama.includes('AKHIR REKENING'))
cek('nama sheet unik', nama.length === new Set(nama).size)
cek('nama sheet ≤ 31 karakter', nama.every(n => n.length <= 31))
cek('nama sheet tanpa karakter ilegal', nama.every(n => !/[\\/?*[\]:]/.test(n)))

const rekap = wb.getWorksheet('REKAP')
const dinas1 = wb.worksheets[1]
const barisTotalDinas = dinas1.rowCount

cek('sel pembagi sheet dinas terisi angka',
  typeof dinas1.getCell('C3').value === 'number' && typeof dinas1.getCell('C4').value === 'number',
  `C3=${dinas1.getCell('C3').value} C4=${dinas1.getCell('C4').value}`)
cek('sel pembagi = bulan-gaji SKPD ke-1',
  dinas1.getCell('C3').value === data.skpd[0].bulanGajiTerbayar &&
  dinas1.getCell('C4').value === data.bulanSisa)
cek('kolom Sim Gaji sheet dinas kosong',
  dinas1.getCell(`F${barisTotalDinas - 1}`).value == null)
cek('kolom turunan sheet dinas berupa formula',
  ['G', 'H', 'I', 'J', 'K', 'L'].every(k => !!dinas1.getCell(`${k}${barisTotalDinas - 1}`).formula))
// Tiap rekening harus memakai pembaginya sendiri (kolom E), bukan sel tunggal
// per dinas — inilah yang membedakan gaji pokok dari iuran BPJS.
cek('pembagi tiap rekening ditulis per baris', data.skpd[0].rekening.every((r, i) =>
  dinas1.getCell(`E${6 + i}`).value === r.dibayar))
cek('rumus Rata²/Bln memakai pembagi barisnya sendiri',
  String(dinas1.getCell('H6').formula || '').includes('D6/E6'),
  dinas1.getCell('H6').formula)
// ExcelJS tidak menghitung rumus, jadi rumusnya dihitung ulang di sini dari sel
// yang benar-benar ditulis — memastikan angka di Excel sama dengan angka di layar.
{
  const sisaSel = Number(dinas1.getCell('C4').value)
  const hasil = data.skpd[0].rekening.map((r, i) => {
    const realisasi = Number(dinas1.getCell(`D${6 + i}`).value || 0)
    const dibayar = Number(dinas1.getCell(`E${6 + i}`).value || 0)
    return dibayar > 0 ? (realisasi / dibayar) * sisaSel : 0
  })
  const total = hasil.reduce((a, n) => a + n, 0)
  cek('rumus sheet dinas menghasilkan kebutuhan yang sama dengan payload',
    dekat(total, data.skpd[0].proyeksi, data.skpd[0].rekening.length),
    `Rp${rp(total)} vs Rp${rp(data.skpd[0].proyeksi)}`)
  const salah = hasil.findIndex((n, i) => !dekat(n, data.skpd[0].rekening[i].proyeksi, 1))
  cek('tiap baris rumusnya cocok dengan proyeksi rekeningnya', salah < 0,
    salah < 0 ? `${hasil.length} baris` : data.skpd[0].rekening[salah].kodeRekening)
}
cek('baris TOTAL sheet dinas memakai SUM',
  String(dinas1.getCell(`C${barisTotalDinas}`).formula || '').startsWith('SUM('))
cek('baris REKAP menunjuk sheet dinas',
  String(rekap.getCell('C7').formula || '').includes(`'${dinas1.name}'!`),
  rekap.getCell('C7').formula)
cek('baris TOTAL REKAP memakai SUM',
  String(rekap.getCell(`C${rekap.rowCount}`).formula || '').startsWith('SUM('))

// ---- Penandaan rekening/dinas yang kurang anggaran ----
const MERAH = 'FFFDE7E9'
const skpdBerkurang = data.skpd.find(s => s.rekening.some(r => r.selisih < 0))
if (!skpdBerkurang) {
  console.log('  (tidak ada rekening kurang di data ini — pemeriksaan penandaan dilewati)')
} else {
  const idx = data.skpd.indexOf(skpdBerkurang)
  const ws = wb.worksheets[idx + 1]
  const BARIS_DATA = 6
  const iKurang = skpdBerkurang.rekening.findIndex(r => r.selisih < 0)
  const iCukup = skpdBerkurang.rekening.findIndex(r => r.selisih >= 0)
  const barisKurang = BARIS_DATA + iKurang

  cek('baris rekening kurang berlatar merah',
    ws.getCell(`A${barisKurang}`).fill?.fgColor?.argb === MERAH,
    `${skpdBerkurang.namaSkpd} baris ${barisKurang}`)
  cek('kolom Sim Gaji tetap kuning di baris merah',
    ws.getCell(`F${barisKurang}`).fill?.fgColor?.argb === 'FFFFF6D6')
  if (iCukup >= 0) {
    cek('baris rekening cukup tidak diberi latar merah',
      ws.getCell(`A${BARIS_DATA + iCukup}`).fill?.fgColor?.argb !== MERAH)
  }
  cek('kolom Selisih punya aturan format bersyarat',
    (ws.conditionalFormattings || []).some(cf => String(cf.ref).startsWith('K')),
    JSON.stringify((ws.conditionalFormattings || []).map(cf => cf.ref)))

  const rekapKurang = data.skpd.findIndex(s => s.selisih < 0)
  if (rekapKurang >= 0) {
    const barisRekap = 7 + rekapKurang
    cek('baris REKAP dinas kurang berlatar merah',
      rekap.getCell(`B${barisRekap}`).fill?.fgColor?.argb === MERAH,
      `baris ${barisRekap}`)
  }
  cek('kolom "Rekening Kurang" di REKAP terisi',
    data.skpd.some((s, i) => {
      const n = s.rekening.filter(r => r.selisih < 0).length
      return n > 0 && rekap.getCell(`L${7 + i}`).value === n
    }))

  const rr = wb.getWorksheet('REKAP REKENING')
  const iRek = (data.rekening || []).findIndex(r => r.dinasKurang > 0)
  if (iRek >= 0) {
    // Dicari, bukan dipaku: jumlah baris judul gampang bertambah.
    let barisRek = -1
    for (let n = 1; n <= rr.rowCount; n++) {
      if (rr.getCell(`A${n}`).value === data.rekening[iRek].kodeRekening) { barisRek = n; break }
    }
    cek('baris rekening di REKAP REKENING ketemu', barisRek > 0, `baris ${barisRek}`)
    cek('rekening rawan ditandai di REKAP REKENING',
      rr.getCell(`A${barisRek}`).fill?.fgColor?.argb === MERAH &&
      rr.getCell(`K${barisRek}`).value === data.rekening[iRek].dinasKurang,
      `${data.rekening[iRek].kodeRekening}: ${data.rekening[iRek].dinasKurang} dinas`)
  }
}

// ---- Sheet Proyeksi Akhir ----
{
  const wsAkhir = wb.getWorksheet('PROYEKSI AKHIR')
  // Dicari, bukan dipaku: jumlah baris judul di sheet ini gampang bertambah.
  const BARIS_DATA = (() => {
    for (let n = 1; n <= wsAkhir.rowCount; n++) {
      if (wsAkhir.getCell(`B${n}`).value === akhir.skpd[0].namaSkpd) return n
    }
    return -1
  })()
  cek('baris data PROYEKSI AKHIR ketemu', BARIS_DATA > 0, `baris ${BARIS_DATA}`)
  const s0 = akhir.skpd[0]
  cek('baris pertama PROYEKSI AKHIR = dinas ke-1',
    wsAkhir.getCell(`B${BARIS_DATA}`).value === s0.namaSkpd &&
    wsAkhir.getCell(`C${BARIS_DATA}`).value === s0.pagu &&
    wsAkhir.getCell(`D${BARIS_DATA}`).value === s0.sp2d)
  cek('kolom turunan PROYEKSI AKHIR berupa formula',
    ['G', 'H', 'J', 'K', 'L', 'M'].every(k => !!wsAkhir.getCell(`${k}${BARIS_DATA}`).formula))
  cek('dasar proyeksi ditulis apa adanya', wsAkhir.getCell(`F${BARIS_DATA}`).value === s0.perBulanRutin,
    `Rp${rp(s0.perBulanRutin)} per bayar`)
  cek('kolom Acress berupa persen yang bisa diubah',
    Math.abs(Number(wsAkhir.getCell(`I${BARIS_DATA}`).value) - akhir.persenAkhir / 100) < 1e-9 &&
    wsAkhir.getCell(`I${BARIS_DATA}`).fill?.fgColor?.argb === 'FFFFF6D6',
    `${(Number(wsAkhir.getCell(`I${BARIS_DATA}`).value) * 100).toFixed(3)}%`)
  // Rumus dihitung ulang di sini karena ExcelJS tidak mengevaluasinya.
  {
    const dasar = Number(wsAkhir.getCell(`F${BARIS_DATA}`).value)
    const kebutuhanSisa = dasar * data.bulanSisa
    const kebutuhan = Number(wsAkhir.getCell(`D${BARIS_DATA}`).value) + kebutuhanSisa
    const usulan = kebutuhan + kebutuhan * Number(wsAkhir.getCell(`I${BARIS_DATA}`).value)
    cek('rumus Usulan = Kebutuhan + Acress cocok dengan payload',
      dekat(kebutuhan, s0.kebutuhan, 2) && dekat(usulan, s0.alokasi, 2),
      `kebutuhan Rp${rp(kebutuhan)} vs Rp${rp(s0.kebutuhan)}; usulan Rp${rp(usulan)} vs Rp${rp(s0.alokasi)}`)
  }

  const wsRek = wb.getWorksheet('AKHIR REKENING')
  const jumlahBaris = akhir.skpd.reduce((a, s) => a + s.rekening.length, 0)
  cek('AKHIR REKENING memuat semua baris dinas × rekening',
    wsRek.rowCount === 6 + 1 + jumlahBaris, `${wsRek.rowCount} baris untuk ${jumlahBaris} rincian`)
  cek('AKHIR REKENING punya autofilter', !!wsRek.autoFilter)
  const BARIS_REK = 7 // 4 judul + 1 sel angka + 1 header + 1
  cek('AKHIR REKENING memuat kolom golongan',
    wsRek.getCell(`C${BARIS_REK}`).value === akhir.golongan.find(g => g.kunci === akhir.skpd[0].rekening[0].golongan)?.label,
    String(wsRek.getCell(`C${BARIS_REK}`).value))
  cek('AKHIR REKENING memuat pembagi tiap rekening',
    wsRek.getCell(`H${BARIS_REK}`).value === (akhir.skpd[0].rekening[0].dibayar || null) &&
    wsRek.getCell(`I${BARIS_REK}`).value === akhir.skpd[0].rekening[0].perBulanRutin,
    `${wsRek.getCell(`H${BARIS_REK}`).value}× bayar`)
  cek('AKHIR REKENING urut per golongan dalam tiap dinas', (() => {
    let baris = BARIS_REK
    for (const s of akhir.skpd) {
      let sebelum = ''
      for (const r of s.rekening) {
        if (r.golongan < sebelum) return false
        sebelum = r.golongan
        baris++
      }
    }
    return baris === wsRek.rowCount
  })())
}

// Angka mentah yang ditulis (bukan formula) harus sama dengan payload.
const skpdTerakhir = data.skpd[data.skpd.length - 1]
const wsTerakhir = wb.worksheets[data.skpd.length]
// Sheet dinas: baris 1-2 judul, 3-4 sel angka, 5 header, data mulai baris 6.
const BARIS_DATA_DINAS = 6
const paguSheet = skpdTerakhir.rekening
  .reduce((a, r, i) => a + Number(wsTerakhir.getCell(`C${BARIS_DATA_DINAS + i}`).value || 0), 0)
cek('angka anggaran di sheet dinas terakhir sama dengan data',
  dekat(paguSheet, skpdTerakhir.pagu), `Rp${rp(paguSheet)} vs Rp${rp(skpdTerakhir.pagu)}`)

await unlink(berkas)

console.log(`\n${gagal === 0 ? 'SEMUA PENGUJIAN LULUS' : `${gagal} PENGUJIAN GAGAL`}\n`)
await db.end()
process.exit(gagal === 0 ? 0 : 1)
