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
import { buatWorkbookProyeksiGaji, namaFileProyeksiGaji, VERSI_META } from '../../src/utils/proyeksiGajiExcel.js'

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

// Dicari, bukan dipaku: jumlah baris judul di tiap sheet gampang bertambah, dan
// rekening dikelompokkan per golongan (PNS/PPPK) di sheet — bukan urut posisi
// mentah dari payload — jadi baris yang tepat harus dicari dari isinya.
function cariBaris(ws, kolom, nilai, dariBaris = 1) {
  for (let n = dariBaris; n <= ws.rowCount; n++) {
    if (ws.getCell(`${kolom}${n}`).value === nilai) return n
  }
  return -1
}

function cariSemuaBaris(ws, kolom, nilai) {
  const hasil = []
  for (let n = 1; n <= ws.rowCount; n++) {
    if (ws.getCell(`${kolom}${n}`).value === nilai) hasil.push(n)
  }
  return hasil
}

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
// 5 sheet ringkasan + 1 sheet _META (penanda supaya file bisa diunggah balik).
cek('jumlah sheet = 6 + jumlah SKPD', wb.worksheets.length === data.skpd.length + 6,
  `${wb.worksheets.length} sheet`)
cek('sheet pertama = REKAP', nama[0] === 'REKAP')
cek('ada sheet PER BULAN & REKAP REKENING',
  nama.includes('PER BULAN') && nama.includes('REKAP REKENING'))
cek('ada sheet PROYEKSI AKHIR & AKHIR REKENING',
  nama.includes('PROYEKSI AKHIR') && nama.includes('AKHIR REKENING'))
cek('nama sheet unik', nama.length === new Set(nama).size)
cek('nama sheet ≤ 31 karakter', nama.every(n => n.length <= 31))
cek('nama sheet tanpa karakter ilegal', nama.every(n => !/[\\/?*[\]:]/.test(n)))

// ---- Sheet _META: dipakai saat file diisi lalu diunggah balik ----
{
  const meta = wb.getWorksheet('_META')
  cek('ada sheet _META', !!meta)
  cek('_META disembunyikan dari pemakai', meta?.state === 'veryHidden', meta?.state)
  const baca = (baris) => meta?.getRow(baris).getCell(2).value
  cek('_META memuat versi, tahun & bulan',
    baca(1) === VERSI_META && baca(2) === Number(TAHUN) && baca(4) === data.bulanTerakhir,
    `versi=${baca(1)} tahun=${baca(2)} bulan=${baca(4)}`)

  // Inti gunanya: nama sheet (terpotong 31 karakter) harus bisa dipetakan balik
  // ke kode SKPD-nya, kalau tidak isian Sim Gaji bisa masuk ke dinas yang salah.
  const peta = new Map()
  meta?.eachRow((row, i) => {
    if (i <= 6) return
    peta.set(String(row.getCell(1).value), String(row.getCell(2).value))
  })
  cek('_META memetakan semua sheet dinas', peta.size === data.skpd.length, `${peta.size} dinas`)
  cek('tiap sheet dinas ketemu di _META',
    wb.worksheets.slice(1, 1 + data.skpd.length).every(ws => peta.has(ws.name)))
  cek('kode SKPD di _META cocok dengan payload',
    data.skpd.every((s, i) => peta.get(wb.worksheets[i + 1].name) === String(s.kodeSkpd)))
}

// "Belum diisi" harus tetap null, tidak boleh jatuh jadi 0 — kalau jadi 0,
// rekening yang belum diisi akan terbaca sebagai selisih -100% dan seluruh
// rekap deviasinya jadi omong kosong.
{
  const semuaRek = data.skpd.flatMap(s => s.rekening || [])
  const adaIsian = semuaRek.some(r => r.sim != null)
  cek('dinas tanpa isian Sim Gaji bernilai null, bukan 0',
    data.skpd.every(s => s.sim === null || s.rekening.some(r => r.sim != null)),
    adaIsian ? `${data.skpd.filter(s => s.sim != null).length} dinas terisi` : 'tabel sim_gaji kosong')
  cek('jumlah dinas terisi = jumlah yang punya rekening terisi',
    data.skpd.filter(s => s.sim != null).length ===
    data.skpd.filter(s => (s.rekening || []).some(r => r.sim != null)).length)
  cek('simInfo.dinas cocok dengan isi payload',
    (data.simInfo?.dinas ?? 0) === data.skpd.filter(s => s.sim != null).length,
    `simInfo=${data.simInfo?.dinas} payload=${data.skpd.filter(s => s.sim != null).length}`)
}

// Sheet BANDING SIM hanya muncul kalau sudah ada isian Sim Gaji yang tersimpan.
cek('BANDING SIM mengikuti ada/tidaknya isian Sim Gaji',
  nama.includes('BANDING SIM') === data.skpd.some(s => (s.rekening || []).some(r => r.sim != null)),
  data.simInfo?.jumlah ? `${data.simInfo.jumlah} baris tersimpan` : 'belum ada isian')

const rekap = wb.getWorksheet('REKAP')
const dinas1 = wb.worksheets[1]
const barisTotalDinas = dinas1.rowCount
// Seluruh golongan yang ada di data — urutan ini sama dengan urutan baris yang
// dipakai buatWorkbookProyeksiGaji untuk sheet dinas, REKAP, PER BULAN, dan
// PROYEKSI AKHIR (PNS dulu, baru PPPK).
const canonicalGolUji = [...new Set(data.skpd.flatMap(s => s.rekening.map(r => r.golongan || '-')))]
  .sort((a, b) => String(a).localeCompare(String(b), 'id', { numeric: true }))
const selisihGolonganUji = (s, kunci) =>
  (s.rekening || []).filter(r => r.golongan === kunci).reduce((a, r) => a + r.selisih, 0)
const jumlahRekeningKurangGolonganUji = (s, kunci) =>
  (s.rekening || []).filter(r => r.golongan === kunci && r.selisih < 0).length

const barisTerbayarDinas1 = cariBaris(dinas1, 'A', 'Bulan-gaji sudah dibayar (rata dinas)')
const barisSisaDinas1 = cariBaris(dinas1, 'A', 'Bulan-gaji sisa')
const barisContohDinas1 = cariBaris(dinas1, 'A', data.skpd[0].rekening[0].kodeRekening)

cek('sel pembagi sheet dinas terisi angka',
  typeof dinas1.getCell(`C${barisTerbayarDinas1}`).value === 'number' &&
  typeof dinas1.getCell(`C${barisSisaDinas1}`).value === 'number',
  `baris ${barisTerbayarDinas1}/${barisSisaDinas1}`)
cek('sel pembagi = bulan-gaji SKPD ke-1',
  dinas1.getCell(`C${barisTerbayarDinas1}`).value === data.skpd[0].bulanGajiTerbayar &&
  dinas1.getCell(`C${barisSisaDinas1}`).value === data.bulanSisa)
// Baris SUBTOTAL (persis sebelum TOTAL) memang berupa formula semua, termasuk F
// (Sim Gaji dijumlahkan dari baris rincian di atasnya) — yang harus benar-benar
// kosong adalah baris REKENING biasa yang bukan "tunjangan keluarga" (rekening
// itu punya baris rincian sendiri, F-nya jadi formula juga).
const rekBiasa = data.skpd[0].rekening.find(r => !/tunjangan\s+keluarga/i.test(r.namaRekening))
const barisRekBiasa = cariBaris(dinas1, 'A', rekBiasa.kodeRekening)
cek('kolom Sim Gaji sheet dinas kosong',
  dinas1.getCell(`F${barisRekBiasa}`).value == null)
cek('kolom turunan sheet dinas berupa formula',
  ['G', 'H', 'I', 'J', 'K', 'L'].every(k => !!dinas1.getCell(`${k}${barisRekBiasa}`).formula))
// Tiap rekening harus memakai pembaginya sendiri (kolom E), bukan sel tunggal
// per dinas — inilah yang membedakan gaji pokok dari iuran BPJS. Baris dicari
// dari kode rekeningnya, bukan posisi, karena sheet mengelompokkan rekening per
// golongan (PNS dulu, baru PPPK) — bukan urut kode mentah seperti di payload.
cek('pembagi tiap rekening ditulis per baris', data.skpd[0].rekening.every(r => {
  const baris = cariBaris(dinas1, 'A', r.kodeRekening)
  return baris > 0 && dinas1.getCell(`E${baris}`).value === r.dibayar
}))
cek('rumus Rata²/Bln memakai pembagi barisnya sendiri',
  String(dinas1.getCell(`H${barisContohDinas1}`).formula || '').includes(`D${barisContohDinas1}/E${barisContohDinas1}`),
  dinas1.getCell(`H${barisContohDinas1}`).formula)
// ExcelJS tidak menghitung rumus, jadi rumusnya dihitung ulang di sini dari sel
// yang benar-benar ditulis — memastikan angka di Excel sama dengan angka di layar.
{
  const sisaSel = Number(dinas1.getCell(`C${barisSisaDinas1}`).value)
  let total = 0
  let salah = null
  for (const r of data.skpd[0].rekening) {
    const baris = cariBaris(dinas1, 'A', r.kodeRekening)
    const realisasi = Number(dinas1.getCell(`D${baris}`).value || 0)
    const dibayar = Number(dinas1.getCell(`E${baris}`).value || 0)
    const hasil = dibayar > 0 ? (realisasi / dibayar) * sisaSel : 0
    total += hasil
    if (!dekat(hasil, r.proyeksi, 1)) salah = r.kodeRekening
  }
  cek('rumus sheet dinas menghasilkan kebutuhan yang sama dengan payload',
    dekat(total, data.skpd[0].proyeksi, data.skpd[0].rekening.length),
    `Rp${rp(total)} vs Rp${rp(data.skpd[0].proyeksi)}`)
  cek('tiap baris rumusnya cocok dengan proyeksi rekeningnya', salah === null,
    salah === null ? `${data.skpd[0].rekening.length} baris` : salah)
}
// TOTAL menjumlahkan baris SUBTOTAL tiap golongan (bentuknya "C21+C36", bukan
// SUM(...)) — supaya baris SUBTOTAL itu sendiri tidak ikut kena SUM dan dobel.
cek('baris TOTAL sheet dinas menjumlahkan tiap SUBTOTAL golongan',
  /^C\d+(\+C\d+)+$/.test(String(dinas1.getCell(`C${barisTotalDinas}`).formula || '')),
  dinas1.getCell(`C${barisTotalDinas}`).formula)

// ---- Sheet REKAP: dikelompokkan per golongan dulu — blok PNS (seluruh dinas),
// baru blok PPPK (seluruh dinas) — bukan tiap dinas dipecah jadi dua baris
// berdekatan. Baris dinas ke-1 karenanya muncul sekali per blok golongan.
const barisDinas1DiRekap = cariSemuaBaris(rekap, 'B', data.skpd[0].namaSkpd)
const barisRekapPertama = barisDinas1DiRekap[0] ?? -1
cek('baris REKAP ketemu', barisRekapPertama > 0, `baris ${barisRekapPertama}`)
cek('baris REKAP menunjuk sheet dinas',
  String(rekap.getCell(`C${barisRekapPertama}`).formula || '').includes(`'${dinas1.name}'!`),
  rekap.getCell(`C${barisRekapPertama}`).formula)
cek('REKAP: dinas ke-1 punya baris untuk tiap golongan kanonik',
  barisDinas1DiRekap.length === canonicalGolUji.length, `${barisDinas1DiRekap.length} baris: ${barisDinas1DiRekap.join(', ')}`)
// TOTAL menjumlahkan baris SUBTOTAL tiap golongan (bentuknya "C21+C36"), bukan
// SUM(...) — sama seperti baris TOTAL sheet dinas, supaya SUBTOTAL tidak dobel.
cek('baris TOTAL REKAP menjumlahkan tiap SUBTOTAL golongan',
  /^C\d+(\+C\d+)+$/.test(String(rekap.getCell(`C${rekap.rowCount}`).formula || '')),
  rekap.getCell(`C${rekap.rowCount}`).formula)

// RSUD Namlea tercatat sebagai sub unit di bawah Dinas Kesehatan, tapi gajinya
// dikelola sendiri — harus jadi sheet terpisah, bukan melebur ke Dinas Kesehatan.
const rsud = data.skpd.find(s => /rsud/i.test(s.namaSkpd))
cek('RSUD (kalau ada di data ini) muncul sebagai SKPD/sheet tersendiri', !rsud || wb.worksheets.some(w => w.name.includes(rsud.namaSkpd.slice(0, 25))),
  rsud ? rsud.namaSkpd : '(tidak ada RSUD di data ini)')

// ---- Penandaan rekening/dinas yang kurang anggaran ----
const MERAH = 'FFFDE7E9'
const skpdBerkurang = data.skpd.find(s => s.rekening.some(r => r.selisih < 0))
if (!skpdBerkurang) {
  console.log('  (tidak ada rekening kurang di data ini — pemeriksaan penandaan dilewati)')
} else {
  const idx = data.skpd.indexOf(skpdBerkurang)
  const ws = wb.worksheets[idx + 1]
  const rekKurang = skpdBerkurang.rekening.find(r => r.selisih < 0)
  const rekCukup = skpdBerkurang.rekening.find(r => r.selisih >= 0)
  const barisKurang = cariBaris(ws, 'A', rekKurang.kodeRekening)

  cek('baris rekening kurang berlatar merah',
    ws.getCell(`A${barisKurang}`).fill?.fgColor?.argb === MERAH,
    `${skpdBerkurang.namaSkpd} baris ${barisKurang}`)
  cek('kolom Sim Gaji tetap kuning di baris merah',
    ws.getCell(`F${barisKurang}`).fill?.fgColor?.argb === 'FFFFF6D6')
  if (rekCukup) {
    const barisCukup = cariBaris(ws, 'A', rekCukup.kodeRekening)
    cek('baris rekening cukup tidak diberi latar merah',
      ws.getCell(`A${barisCukup}`).fill?.fgColor?.argb !== MERAH)
  }
  cek('kolom Selisih punya aturan format bersyarat',
    (ws.conditionalFormattings || []).some(cf => String(cf.ref).startsWith('K')),
    JSON.stringify((ws.conditionalFormattings || []).map(cf => cf.ref)))

  // Baris ke-j (0-based) untuk dinas s di REKAP berarti golongan canonicalGolUji[j]
  // — karena tiap dinas muncul sekali per blok golongan, urut sesuai urutan blok.
  function barisRekapDinasGolongan(s, kunci) {
    const j = canonicalGolUji.indexOf(kunci)
    const semua = cariSemuaBaris(rekap, 'B', s.namaSkpd)
    return semua[j] ?? -1
  }

  let barisRekapKurang = -1
  let labelKurang = ''
  outer: for (let i = 0; i < data.skpd.length; i++) {
    for (const kunci of canonicalGolUji) {
      if (selisihGolonganUji(data.skpd[i], kunci) < 0) {
        barisRekapKurang = barisRekapDinasGolongan(data.skpd[i], kunci)
        labelKurang = `${data.skpd[i].namaSkpd} / ${kunci}`
        break outer
      }
    }
  }
  if (barisRekapKurang > 0) {
    cek('baris REKAP dinas+golongan kurang berlatar merah',
      rekap.getCell(`B${barisRekapKurang}`).fill?.fgColor?.argb === MERAH,
      `${labelKurang} baris ${barisRekapKurang}`)
  }
  cek('kolom "Rekening Kurang" di REKAP terisi',
    data.skpd.some(s => canonicalGolUji.some(kunci => {
      const n = jumlahRekeningKurangGolonganUji(s, kunci)
      const baris = barisRekapDinasGolongan(s, kunci)
      return n > 0 && baris > 0 && rekap.getCell(`L${baris}`).value === n
    })))

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
// Dikelompokkan per golongan dulu — blok PNS (seluruh dinas), baru blok PPPK
// (seluruh dinas) — sama seperti REKAP. Baris dinas ke-1 muncul sekali per
// blok golongan, TIDAK berdekatan seperti dua baris per dinas.
{
  const wsAkhir = wb.getWorksheet('PROYEKSI AKHIR')
  const s0 = akhir.skpd[0]
  const barisS0 = cariSemuaBaris(wsAkhir, 'B', s0.namaSkpd)
  cek('baris data PROYEKSI AKHIR ketemu', barisS0.length > 0, `baris ${barisS0[0]}`)
  cek('golongan dinas ke-1 lengkap (PNS & PPPK, walau salah satunya nol)',
    s0.golongan.length === canonicalGolUji.length && barisS0.length === canonicalGolUji.length,
    `${barisS0.length} baris: ${barisS0.join(', ')}`)
  const g0 = s0.golongan.find(g => g.kunci === canonicalGolUji[0])
  const BARIS_DATA = barisS0[0]
  cek('baris pertama PROYEKSI AKHIR = dinas ke-1, golongan pertama',
    wsAkhir.getCell(`B${BARIS_DATA}`).value === s0.namaSkpd &&
    wsAkhir.getCell(`C${BARIS_DATA}`).value === g0.pagu &&
    wsAkhir.getCell(`D${BARIS_DATA}`).value === g0.sp2d)
  cek('kolom turunan PROYEKSI AKHIR berupa formula',
    ['G', 'H', 'J', 'K', 'L', 'M'].every(k => !!wsAkhir.getCell(`${k}${BARIS_DATA}`).formula))
  cek('dasar proyeksi ditulis apa adanya', wsAkhir.getCell(`F${BARIS_DATA}`).value === g0.perBulanRutin,
    `Rp${rp(g0.perBulanRutin)} per bayar`)
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
    // Toleransi sedikit lebih lebar daripada versi per-dinas: g0.kebutuhan/alokasi
    // adalah Σ rekening yang masing-masing sudah dibulatkan sendiri (bulat()),
    // jadi bisa meleset beberapa rupiah dari rumus yang dihitung dari sel utuh.
    cek('rumus Usulan = Kebutuhan + Acress cocok dengan payload',
      dekat(kebutuhan, g0.kebutuhan, 5) && dekat(usulan, g0.alokasi, 5),
      `kebutuhan Rp${rp(kebutuhan)} vs Rp${rp(g0.kebutuhan)}; usulan Rp${rp(usulan)} vs Rp${rp(g0.alokasi)}`)
  }
  // Kalau ada dinas tanpa PPPK di data ini, baris golongan PPPK-nya (di blok
  // PPPK, bukan baris berikutnya) harus tetap ada dan bernilai nol — bukan hilang.
  {
    const kunciTerakhir = canonicalGolUji[canonicalGolUji.length - 1]
    const tanpaPppk = akhir.skpd.find(s => {
      const g = s.golongan.find(gg => gg.kunci === kunciTerakhir)
      return g && g.jumlahRekening === 0
    })
    if (tanpaPppk) {
      const gKosong = tanpaPppk.golongan.find(g => g.kunci === kunciTerakhir)
      const barisKosong = cariSemuaBaris(wsAkhir, 'B', tanpaPppk.namaSkpd)[canonicalGolUji.length - 1]
      cek('dinas tanpa PPPK tetap punya baris PPPK bernilai nol',
        barisKosong > 0 && wsAkhir.getCell(`C${barisKosong}`).value === 0,
        `${tanpaPppk.namaSkpd} / ${gKosong.label} baris ${barisKosong}`)
    } else {
      console.log('  (semua dinas di data ini punya PPPK — pemeriksaan blok-kosong dilewati)')
    }
  }

  // Dikelompokkan per golongan dulu — blok PNS (seluruh dinas × rekening), baru
  // blok PPPK (seluruh dinas × rekening) — sama seperti REKAP/PROYEKSI AKHIR.
  const wsRek = wb.getWorksheet('AKHIR REKENING')
  const jumlahBaris = akhir.skpd.reduce((a, s) => a + s.rekening.length, 0)
  // Baris data (bukan judul/band/subtotal/sel angka) dikenali dari kolom Kode
  // SKPD (A) yang berupa kode dinas sungguhan (mis. "1.01...") — bukan label
  // teks seperti baris band/subtotal, dan bukan angka polos seperti sel
  // "Bulan-gaji sisa" (yang nilainya numerik, kebetulan juga di kolom depan).
  const barisData = (r) => /^\d/.test(String(wsRek.getCell(`A${r}`).value || ''))
  let barisDataRek = 0
  for (let r = 1; r <= wsRek.rowCount; r++) {
    if (barisData(r)) barisDataRek++
  }
  cek('AKHIR REKENING memuat semua baris dinas × rekening',
    barisDataRek === jumlahBaris, `${barisDataRek} baris data untuk ${jumlahBaris} rincian`)
  cek('AKHIR REKENING punya autofilter', !!wsRek.autoFilter)
  cek('AKHIR REKENING memuat band golongan (PNS & PPPK)',
    (akhir.golongan || []).every(g => cariBaris(wsRek, 'A', g.label) > 0),
    (akhir.golongan || []).map(g => `${g.label}=${cariBaris(wsRek, 'A', g.label)}`).join(' '))

  const rekContoh = akhir.skpd[0].rekening.find(r => r.golongan === canonicalGolUji[0])
  const barisRekContoh = cariBaris(wsRek, 'C', rekContoh.kodeRekening)
  cek('AKHIR REKENING memuat pembagi tiap rekening',
    barisRekContoh > 0 &&
    wsRek.getCell(`G${barisRekContoh}`).value === (rekContoh.dibayar || null) &&
    wsRek.getCell(`H${barisRekContoh}`).value === rekContoh.perBulanRutin,
    `${wsRek.getCell(`G${barisRekContoh}`).value}× bayar`)

  const rekLookup = new Map()
  for (const s of akhir.skpd) for (const r of s.rekening) rekLookup.set(`${s.kodeSkpd}|${r.kodeRekening}`, r)
  cek('AKHIR REKENING dikelompokkan per golongan (PNS dulu, baru PPPK)', (() => {
    let golTerakhirIdx = -1
    for (let r = 1; r <= wsRek.rowCount; r++) {
      if (!barisData(r)) continue
      const kode = wsRek.getCell(`C${r}`).value
      const rek = rekLookup.get(`${wsRek.getCell(`A${r}`).value}|${kode}`)
      if (!rek) return false
      const idx = canonicalGolUji.indexOf(rek.golongan)
      if (idx < golTerakhirIdx) return false
      golTerakhirIdx = idx
    }
    return true
  })())
}

// Angka mentah yang ditulis (bukan formula) harus sama dengan payload. Baris
// dicari dari kode rekeningnya (sheet mengelompokkan per golongan, bukan urut
// kode mentah seperti di payload).
const skpdTerakhir = data.skpd[data.skpd.length - 1]
const wsTerakhir = wb.worksheets[data.skpd.length]
const paguSheet = skpdTerakhir.rekening.reduce((a, r) => {
  const baris = cariBaris(wsTerakhir, 'A', r.kodeRekening)
  return a + Number(wsTerakhir.getCell(`C${baris}`).value || 0)
}, 0)
cek('angka anggaran di sheet dinas terakhir sama dengan data',
  dekat(paguSheet, skpdTerakhir.pagu), `Rp${rp(paguSheet)} vs Rp${rp(skpdTerakhir.pagu)}`)

await unlink(berkas)

console.log(`\n${gagal === 0 ? 'SEMUA PENGUJIAN LULUS' : `${gagal} PENGUJIAN GAGAL`}\n`)
await db.end()
process.exit(gagal === 0 ? 0 : 1)
