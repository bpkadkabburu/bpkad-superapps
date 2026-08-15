// Pengujian utils/kodeRekening.js — penanganan perubahan lebar segmen kode
// rekening Permendagri (2024–2025: 1-1-2-2-2-4, 2026+: 1-1-2-2-3-5).
// Read-only terhadap database.
//
//   cd api && npm run uji:kode-rekening

import 'dotenv/config'
import db from '../src/db.js'
import {
  normalKodeRekening, jenisRekening, tingkatRekening, samaRekening,
  himpunanRekening, variasiAwalan, klausaAwalanRekening,
} from '../src/utils/kodeRekening.js'

let gagal = 0
function cek(nama, lulus, catatan) {
  if (lulus) console.log(`  ok    ${nama}${catatan ? `  (${catatan})` : ''}`)
  else { gagal++; console.log(`  GAGAL ${nama}${catatan ? `  (${catatan})` : ''}`) }
}
const sama = (a, b) => JSON.stringify(a) === JSON.stringify(b)

console.log('\nKode Rekening — penanganan dua format Permendagri\n')

console.log('Normalisasi')
cek('kode 2025 dilebarkan ke format 2026',
  normalKodeRekening('5.1.01.01.01.0001') === '5.1.01.01.001.00001')
cek('kode 2026 tidak berubah',
  normalKodeRekening('5.1.01.01.001.00001') === '5.1.01.01.001.00001')
cek('kode sampai objek tidak berubah',
  normalKodeRekening('5.1.01.01') === '5.1.01.01')
cek('kode sampai rincian objek dilebarkan',
  normalKodeRekening('5.1.02.02.02') === '5.1.02.02.002')
cek('segmen non-nol tetap utuh',
  normalKodeRekening('5.2.02.10.02.0003') === '5.2.02.10.002.00003')
cek('kosong/null tidak melempar galat',
  normalKodeRekening(null) === '' && normalKodeRekening(undefined) === '')

console.log('\nJenis & tingkat')
cek('jenis = 3 segmen pertama, sama di kedua format',
  jenisRekening('5.1.01.01.01.0001') === '5.1.01' &&
  jenisRekening('5.1.01.01.001.00001') === '5.1.01')
cek('tingkat dihitung dari jumlah segmen',
  tingkatRekening('5') === 'akun' &&
  tingkatRekening('5.1.01.01') === 'objek' &&
  tingkatRekening('5.1.01.01.01') === 'rincian objek' &&
  tingkatRekening('5.1.01.01.001.00001') === 'sub rincian objek')
cek('samaRekening mencocokkan lintas format',
  samaRekening('5.1.02.02.02.0059', '5.1.02.02.001.00059') === false &&
  samaRekening('5.1.02.02.01.0059', '5.1.02.02.001.00059') === true)

console.log('\nVarian awalan')
cek('awalan sampai objek: satu varian',
  sama(variasiAwalan('5.1.01.01'), ['5.1.01.01']), variasiAwalan('5.1.01.01').join(' | '))
cek('awalan rincian objek: dua varian',
  new Set(variasiAwalan('5.1.01.01.001')).size === 2 &&
  variasiAwalan('5.1.01.01.001').includes('5.1.01.01.01'),
  variasiAwalan('5.1.01.01.001').join(' | '))
cek('awalan format lama juga menghasilkan varian baru',
  variasiAwalan('5.1.01.01.01').includes('5.1.01.01.001'),
  variasiAwalan('5.1.01.01.01').join(' | '))
cek('kode penuh: dua varian',
  variasiAwalan('5.1.01.01.01.0001').includes('5.1.01.01.001.00001'),
  variasiAwalan('5.1.01.01.01.0001').join(' | '))
cek('segmen yang tak bisa dipersempit tidak dipaksakan',
  sama(variasiAwalan('5.1.01.01.100'), ['5.1.01.01.100']),
  variasiAwalan('5.1.01.01.100').join(' | '))
cek('segmen setengah diketik dibiarkan apa adanya',
  sama(variasiAwalan('5.1.01.01.0'), ['5.1.01.01.0']),
  variasiAwalan('5.1.01.01.0').join(' | '))
const kl = klausaAwalanRekening('kode_rekening', '5.1.01.01.001')
cek('klausa SQL dipaku di batas segmen (= atau LIKE "awalan.%")',
  kl.params.length === 4 &&
  kl.params.filter(p => p.endsWith('.%')).length === 2 &&
  !kl.params.some(p => /[^.%]%$/.test(p)),
  kl.params.join(' | '))

// ---- Uji terhadap data sungguhan ----
console.log('\nTerhadap data')
const [tahunRows] = await db.query('SELECT id, tahun FROM tahun_anggaran ORDER BY tahun')
const pola = k => String(k).split('.').map(s => s.length).join('-')

for (const t of tahunRows) {
  const [rows] = await db.query(
    `SELECT DISTINCT kode_rekening kode FROM anggaran_rekap WHERE tahun_id = ? AND kode_rekening IS NOT NULL`,
    [t.id])
  if (!rows.length) continue
  const polaSet = new Set(rows.map(r => pola(r.kode)))
  const normalSet = new Set(rows.map(r => normalKodeRekening(r.kode)))
  cek(`TA ${t.tahun}: normalisasi tidak menggabungkan kode berbeda`,
    normalSet.size === rows.length,
    `${rows.length} kode, pola ${[...polaSet].join('/')}`)
  cek(`TA ${t.tahun}: semua kode ternormal berpola 1-1-2-2-3-5`,
    [...normalSet].every(k => pola(k) === '1-1-2-2-3-5' || k.split('.').length < 6))
}

// Daftar NON_EFISIENSI harus kena di semua tahun (inti bug yang diperbaiki).
const NON_EFISIENSI = himpunanRekening([
  '5.1.02.02.001.00059', '5.1.02.02.001.00060',
  '5.1.02.02.001.00061', '5.1.02.02.001.00063',
])
for (const t of tahunRows) {
  const [rows] = await db.query(
    `SELECT DISTINCT kode_rekening kode, nama_rekening nama FROM anggaran_rekap
     WHERE tahun_id = ? AND kode_rekening IS NOT NULL`, [t.id])
  if (!rows.length) continue
  const kena = rows.filter(r => NON_EFISIENSI.punya(r.kode))
  const kenaMentah = rows.filter(r => [
    '5.1.02.02.001.00059', '5.1.02.02.001.00060',
    '5.1.02.02.001.00061', '5.1.02.02.001.00063',
  ].includes(r.kode))
  cek(`TA ${t.tahun}: rekening langganan (telepon/air/listrik/internet) dikenali`,
    kena.length === 4, `${kena.length}/4 dikenali, sebelum perbaikan ${kenaMentah.length}/4`)
}

// Filter awalan harus mengembalikan baris di kedua format, DAN tidak boleh
// menyambar rekening lain karena varian format lama bocor lewat batas segmen.
console.log('\nFilter awalan terhadap data')
for (const t of tahunRows) {
  // Gaji pokok: rincian objek 001 (2026) / 01 (2024–2025).
  const kl = klausaAwalanRekening('kode_rekening', '5.1.01.01.001')
  const [[hasil]] = await db.query(
    `SELECT COUNT(*) n FROM anggaran_rekap WHERE tahun_id = ? AND ${kl.sql}`,
    [t.id, ...kl.params])
  // Pembanding: awalan dalam format tahun itu sendiri, dipaku di batas segmen.
  const [[patokan]] = await db.query(
    `SELECT COUNT(*) n FROM anggaran_rekap WHERE tahun_id = ?
       AND (kode_rekening = ? OR kode_rekening LIKE ?
         OR kode_rekening = ? OR kode_rekening LIKE ?)`,
    [t.id, '5.1.01.01.001', '5.1.01.01.001.%', '5.1.01.01.01', '5.1.01.01.01.%'])
  const [[objek]] = await db.query(
    `SELECT COUNT(*) n FROM anggaran_rekap WHERE tahun_id = ? AND kode_rekening LIKE ?`,
    [t.id, '5.1.01.01.%'])
  if (!Number(objek.n)) continue
  cek(`TA ${t.tahun}: awalan "5.1.01.01.001" (gaji pokok) dapat baris`,
    Number(hasil.n) > 0, `${hasil.n} baris dari ${objek.n} baris objek 5.1.01.01`)
  cek(`TA ${t.tahun}: tidak menyambar rekening di luar rincian objek gaji pokok`,
    Number(hasil.n) === Number(patokan.n), `${hasil.n} vs patokan ${patokan.n}`)

  // Rincian objek lain di bawah objek yang sama tidak boleh ikut terbawa.
  const [lain] = await db.query(
    `SELECT DISTINCT kode_rekening kode, nama_rekening nama FROM anggaran_rekap
     WHERE tahun_id = ? AND ${kl.sql}`, [t.id, ...kl.params])
  const bukanGajiPokok = lain.filter(r => !/Gaji Pokok/i.test(String(r.nama)))
  cek(`TA ${t.tahun}: seluruh kode terpilih benar-benar Gaji Pokok`,
    bukanGajiPokok.length === 0,
    bukanGajiPokok.length ? bukanGajiPokok.slice(0, 3).map(r => `${r.kode} ${r.nama}`).join('; ')
      : `${lain.length} kode`)
}

console.log(`\n${gagal === 0 ? 'SEMUA PENGUJIAN LULUS' : `${gagal} PENGUJIAN GAGAL`}\n`)
await db.end()
process.exit(gagal === 0 ? 0 : 1)
