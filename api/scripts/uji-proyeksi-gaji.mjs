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
cek('jumlah sheet = 3 + jumlah SKPD', wb.worksheets.length === data.skpd.length + 3,
  `${wb.worksheets.length} sheet`)
cek('sheet pertama = REKAP', nama[0] === 'REKAP')
cek('ada sheet PER BULAN & REKAP REKENING',
  nama.includes('PER BULAN') && nama.includes('REKAP REKENING'))
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
  dinas1.getCell(`E${barisTotalDinas - 1}`).value == null)
cek('kolom turunan sheet dinas berupa formula',
  ['F', 'G', 'H', 'I', 'J', 'K'].every(k => !!dinas1.getCell(`${k}${barisTotalDinas - 1}`).formula))
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
    ws.getCell(`E${barisKurang}`).fill?.fgColor?.argb === 'FFFFF6D6')
  if (iCukup >= 0) {
    cek('baris rekening cukup tidak diberi latar merah',
      ws.getCell(`A${BARIS_DATA + iCukup}`).fill?.fgColor?.argb !== MERAH)
  }
  cek('kolom Selisih punya aturan format bersyarat',
    (ws.conditionalFormattings || []).some(cf => String(cf.ref).startsWith('J')),
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
    const barisRek = 7 + iRek
    cek('rekening rawan ditandai di REKAP REKENING',
      rr.getCell(`A${barisRek}`).fill?.fgColor?.argb === MERAH &&
      rr.getCell(`J${barisRek}`).value === data.rekening[iRek].dinasKurang,
      `${data.rekening[iRek].kodeRekening}: ${data.rekening[iRek].dinasKurang} dinas`)
  }
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
