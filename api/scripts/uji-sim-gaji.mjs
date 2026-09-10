// Pengujian bolak-balik isian SIM Gaji: file export diisi seperti pemakai
// mengisinya, ditulis, lalu dibaca ulang oleh parser yang sama dengan yang
// dipakai di layar. Read-only terhadap database — yang ditulis cuma file
// sementara, tabel sim_gaji tidak disentuh.
//
//   cd api && npm run uji:sim-gaji [tahun] [prefix]
//
// Bagian ini yang paling rawan: kalau pemetaan sheet -> kode SKPD meleset, angka
// SIM Gaji satu dinas bisa diam-diam tersimpan atas nama dinas lain.

import 'dotenv/config'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFile, unlink } from 'node:fs/promises'
import ExcelJS from 'exceljs'

import db from '../src/db.js'
import { hitungProyeksiGaji } from '../src/routes/proyeksiGaji.js'
import { bacaSimGajiDariWorkbook, BerkasTidakDikenal } from '../../src/utils/proyeksiGajiImport.js'
import { buatWorkbookProyeksiGaji } from '../../src/utils/proyeksiGajiExcel.js'
import { bersihkanBaris } from '../src/utils/simGaji.js'

const TAHUN = Number(process.argv[2]) || new Date().getFullYear()
const PREFIX = process.argv[3] || '5.1.01.01'

let gagal = 0
function cek(nama, lulus, catatan) {
  if (lulus) console.log(`  ok    ${nama}${catatan ? `  (${catatan})` : ''}`)
  else { gagal++; console.log(`  GAGAL ${nama}${catatan ? `  (${catatan})` : ''}`) }
}
const rp = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID')

// Meniru pemakai membuka file lalu mengetik di kolom kuning: yang diisi hanya
// kolom F, sel lain tidak disentuh sama sekali.
function isiKolomSim(ws, nilaiPerBaris) {
  ws.eachRow((row) => {
    const nilai = nilaiPerBaris(row)
    if (nilai != null) row.getCell(6).value = nilai
  })
}

console.log(`\nUji bolak-balik Sim Gaji · TA ${TAHUN} · ${PREFIX}*\n`)

const data = await hitungProyeksiGaji({ tahun: TAHUN, prefix: PREFIX })
if (!data.skpd.length) {
  console.log('  (tidak ada data gaji untuk tahun ini — pengujian dilewati)')
  process.exit(0)
}

const berkas = join(tmpdir(), `uji-sim-gaji-${TAHUN}.xlsx`)
await writeFile(berkas, Buffer.from(await buatWorkbookProyeksiGaji(data, { tahun: TAHUN })))

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(berkas)

// ---- Isi seperti pemakai: dinas pertama & terakhir, semua rekeningnya ----
const meta = wb.getWorksheet('_META')
const namaSheetDinas = []
meta.eachRow((row, i) => { if (i > 6) namaSheetDinas.push(String(row.getCell(1).value)) })

const dipilih = [namaSheetDinas[0], namaSheetDinas[namaSheetDinas.length - 1]]
const harapan = new Map() // `${kodeSkpd}|${kodeRekening}|${komponen}` -> nilai

for (const namaSheet of dipilih) {
  const ws = wb.getWorksheet(namaSheet)
  const kodeSkpd = String(meta.getRow(namaSheetDinas.indexOf(namaSheet) + 7).getCell(2).value)

  let indukKode = null
  isiKolomSim(ws, (row) => {
    const kode = String(row.getCell(1).value ?? '').trim()
    const nama = String(row.getCell(2).value ?? '')

    if (/^\d+(\.\d+)+$/.test(kode)) {
      indukKode = kode
      // Rekening ber-rincian: baris induknya rumus, jangan ditimpa — biar
      // baris rincian di bawahnya yang mengisi, persis seperti di lapangan.
      if (/tunjangan\s+keluarga/i.test(nama)) return null
      const nilai = 1_000_000 + (indukKode.length * 1000)
      harapan.set(`${kodeSkpd}|${indukKode}|`, nilai)
      return nilai
    }

    const cocok = !kode && /↳\s*(.+?)\s*\(isi manual\)/.exec(nama)
    if (cocok && indukKode) {
      const komponen = cocok[1].trim()
      const nilai = komponen.toLowerCase().includes('istri') ? 250_000 : 175_000
      harapan.set(`${kodeSkpd}|${indukKode}|${komponen}`, nilai)
      // Induk tidak ikut diisi — nilainya harus tersusun dari rinciannya.
      const kunciInduk = `${kodeSkpd}|${indukKode}|`
      harapan.set(kunciInduk, (harapan.get(kunciInduk) || 0) + nilai)
      return nilai
    }
    return null
  })
}

const berkasIsi = join(tmpdir(), `uji-sim-gaji-${TAHUN}-terisi.xlsx`)
await writeFile(berkasIsi, Buffer.from(await wb.xlsx.writeBuffer()))

// ---- Baca ulang dengan parser yang dipakai di layar ----
const buf = await import('node:fs/promises').then(fs => fs.readFile(berkasIsi))
const file = { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
const hasil = await bacaSimGajiDariWorkbook(file)

console.log('Pembacaan balik')
cek('tahun & bulan terbaca dari _META',
  hasil.tahun === TAHUN && hasil.bulan === data.bulanTerakhir,
  `tahun=${hasil.tahun} bulan=${hasil.bulan}`)
cek('hanya dinas yang diisi yang ikut terbaca', hasil.dinasTerisi === dipilih.length,
  `${hasil.dinasTerisi} dari ${hasil.dinas} dinas`)

const terbaca = new Map(hasil.rows.map(r => [`${r.kodeSkpd}|${r.kodeRekening}|${r.komponen}`, r.nilai]))
cek('jumlah baris terbaca = jumlah yang diisi', terbaca.size === harapan.size,
  `${terbaca.size} vs ${harapan.size}`)

const meleset = [...harapan.entries()].filter(([k, v]) => terbaca.get(k) !== v)
cek('tiap nilai kembali persis di dinas & rekening yang benar', meleset.length === 0,
  meleset.length ? `${meleset.length} meleset, mis. ${meleset[0][0]}` : `${harapan.size} nilai`)

// Inti perbaikan istri/anak: induk tidak diisi sendiri, harus terjumlah.
const kunciKeluarga = [...harapan.keys()].filter(k => k.endsWith('|Tunjangan Istri'))
if (!kunciKeluarga.length) {
  console.log('  (tidak ada rekening tunjangan keluarga di data ini — pemeriksaan rincian dilewati)')
} else {
  const dasar = kunciKeluarga[0].slice(0, -'Tunjangan Istri'.length)
  const istri = terbaca.get(`${dasar}Tunjangan Istri`)
  const anak = terbaca.get(`${dasar}Tunjangan Anak`)
  const induk = terbaca.get(dasar)
  cek('rincian istri & anak tersimpan terpisah', istri === 250_000 && anak === 175_000,
    `istri=${rp(istri)} anak=${rp(anak)}`)
  cek('baris induk = jumlah rinciannya (rumus dihitung sendiri, bukan dari cache Excel)',
    induk === istri + anak, `induk=${rp(induk)} vs ${rp(istri + anak)}`)
}

// ---- Yang lolos ke database ----
const bersih = bersihkanBaris(hasil.rows)
cek('semua baris terbaca lolos pembersihan', bersih.length === hasil.rows.length,
  `${bersih.length} dari ${hasil.rows.length}`)
cek('tidak ada nilai nol yang ikut tersimpan', bersih.every(r => r.nilai > 0))
cek('setiap baris punya kode SKPD & rekening', bersih.every(r => r.kodeSkpd && r.kodeRekening))

// ---- File asing harus ditolak, bukan tersimpan diam-diam salah ----
{
  const asing = new ExcelJS.Workbook()
  asing.addWorksheet('Sheet1').addRow(['5.1.01.01.001.00001', 'Belanja Gaji Pokok PNS'])
  const bufAsing = Buffer.from(await asing.xlsx.writeBuffer())
  let ditolak = null
  try {
    await bacaSimGajiDariWorkbook({
      arrayBuffer: async () => bufAsing.buffer.slice(bufAsing.byteOffset, bufAsing.byteOffset + bufAsing.byteLength),
    })
  } catch (err) { ditolak = err }
  cek('file tanpa _META ditolak', ditolak instanceof BerkasTidakDikenal,
    ditolak ? ditolak.message.slice(0, 60) + '…' : 'TIDAK DITOLAK')
}

await unlink(berkas).catch(() => {})
await unlink(berkasIsi).catch(() => {})

console.log(gagal ? `\n${gagal} PENGUJIAN GAGAL` : '\nSEMUA PENGUJIAN LULUS')
await db.end()
process.exit(gagal ? 1 : 0)
