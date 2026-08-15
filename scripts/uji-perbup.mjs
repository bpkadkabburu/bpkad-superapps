// Pengujian engine Perbup Penjabaran APBD.
//   node scripts/uji-perbup.mjs
//
// Bagian A menguji logika dengan data buatan, termasuk skenario yang tidak ada
// di file 2026: pasal sisipan yang baru berubah nilai beberapa pergeseran kemudian.
// Bagian B memverifikasi ke data 2026 asli dan ke angka Perbup Nomor 2 Tahun 2026
// yang sudah diundangkan. Jalankan ulang setiap kali logika penomoran atau bunyi
// pasal disentuh — naskahnya mengikat secara hukum.

import ExcelJS from 'exceljs'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { bacaLampiran } from '../src/utils/perbupExcel.js'
import {
  buatRegistryDasar, prosesTahap, jalankanRantai, matriksNilai, bandingPasal,
  naskahDasar, ucwords
} from '../src/utils/perbupEngine.js'
import { terbilangAngka, rupiahTerbilang } from '../src/utils/terbilang.js'
import { naskahPergeseran, blokKeParagraf } from '../src/utils/perbupNaskah.js'
import { buatDocx } from '../src/utils/docxWriter.js'

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..')
let gagal = 0
const cek = (nama, aktual, harap) => {
  const ok = JSON.stringify(aktual) === JSON.stringify(harap)
  if (!ok) {
    gagal++
    console.log(`  GAGAL ${nama}\n        dapat : ${JSON.stringify(aktual)}\n        harap : ${JSON.stringify(harap)}`)
  } else console.log(`  ok    ${nama}`)
}
const bab = t => console.log(`\n${t}`)

const OPTS = { tahunAnggaran: '2026', pasalMulai: 3 }
const R = (kode, uraian, nilai, sebelum) => ({
  kode, uraian, nilai, tertulisSebelum: sebelum === undefined ? null : sebelum
})

// =============================================================== A. data buatan

bab('A1. terbilang')
cek('913.772.477.137,68', terbilangAngka(913772477137.68),
  'sembilan ratus tiga belas milyar tujuh ratus tujuh puluh dua juta empat ratus tujuh puluh tujuh ribu seratus tiga puluh tujuh koma enam delapan')
cek('nol', terbilangAngka(0), 'nol')
cek('seribu', terbilangAngka(1000), 'seribu')
cek('sebelas', terbilangAngka(11), 'sebelas')
cek('dua milyar', terbilangAngka(2000000000), 'dua milyar')
cek('desimal nol lima', terbilangAngka(205.05), 'dua ratus lima koma nol lima')
cek('nol lengkap', rupiahTerbilang(0), 'Rp. 0,00 (Nol rupiah)')
cek('negatif', rupiahTerbilang(-1500000), 'Rp. (1.500.000,00) (Satu juta lima ratus ribu rupiah)')
cek('tanpa non-breaking space', / /.test(rupiahTerbilang(-1500000)), false)

bab('A2. urutan pasal')
cek('62 < 62A', bandingPasal('62', '62A') < 0, true)
cek('62A < 62B', bandingPasal('62A', '62B') < 0, true)
cek('62Z < 62AA', bandingPasal('62Z', '62AA') < 0, true)
cek('62B < 63', bandingPasal('62B', '63') < 0, true)

bab('A3. ucwords')
cek('akronim dalam kurung utuh', ucwords('PENDAPATAN ASLI DAERAH (PAD)'), 'Pendapatan Asli Daerah (PAD)')
cek('teks campur dibiarkan', ucwords('Belanja Hibah Dana BOSP'), 'Belanja Hibah Dana BOSP')

const murniUji = [
  R('4', 'Pendapatan Daerah', 1000),
  R('4.1', 'Pendapatan Asli Daerah', 1000),
  R('4.1.01', 'Pajak Daerah', 1000),
  R('4.1.01.06', 'Pajak Hotel', 600),
  R('4.1.01.06.001', 'Pajak Hotel Bintang', 600),
  R('4.1.01.07', 'Pajak Restoran', 400),
  R('4.1.01.07.001', 'Pajak Restoran A', 400),
  R('5', 'Belanja Daerah', 3000),
  R('5.1', 'Belanja Operasi', 3000),
  R('5.1.05', 'Belanja Hibah', 1000),
  R('5.1.05.05', 'Belanja Hibah kepada Badan', 1000),
  R('5.1.05.05.001', 'Hibah Badan X', 1000),
  R('6', 'Pembiayaan Daerah', 500),
  R('6.1', 'Penerimaan Pembiayaan', 500),
  R('6.1.01', 'SiLPA', 500),
  R('6.1.01.01', 'SiLPA Tahun Sebelumnya', 500),
  R('6.1.01.01.001', 'SiLPA', 500)
]
const regUji = buatRegistryDasar(murniUji, 3)
const salin = rows => rows.map(r => R(r.kode, r.uraian, r.nilai, r.nilai))
const ubah = (rows, kode, nilai) => { rows.find(r => r.kode === kode).nilai = nilai; return rows }

bab('A4. rantai pergeseran — sisipan lahir di P1')
const p1 = salin(murniUji)
p1.splice(p1.findIndex(r => r.kode === '5.1.05.05'), 0,
  R('5.1.05.02', 'Belanja Hibah kepada Pemerintah', 0),
  R('5.1.05.02.002', 'Hibah Pemerintah Y', 0))
const T1u = prosesTahap({ rows: murniUji, reg: regUji }, p1, 'P1', OPTS)
cek('label sisipan = pasal induk + A', T1u.sisipan.map(s => s.pasal), [regUji['5.1.05'] + 'A'])
cek('induk ikut diubah karena ayat bergeser', T1u.diubah.includes('5.1.05'), true)
cek('tanpa peringatan', T1u.peringatan.length, 0)

bab('A5. P2 — sisipan lain, sisipan P1 tidak berubah nilai')
const p2 = salin(T1u.rows)
p2.splice(p2.findIndex(r => r.kode === '4.1.01.06'), 0,
  R('4.1.01.03', 'Pajak Reklame', 50), R('4.1.01.03.001', 'Reklame A', 50))
ubah(ubah(ubah(p2, '4.1.01', 1050), '4.1', 1050), '4', 1050)
const T2u = prosesTahap(T1u, p2, 'P2', OPTS)
cek('nomor sisipan P1 tidak berubah', T2u.reg['5.1.05.02'], T1u.reg['5.1.05.02'])
cek('sisipan baru pakai basis sendiri', T2u.sisipan.map(s => s.pasal), [regUji['4.1.01'] + 'A'])
cek('sisipan P1 TIDAK diulang di P2', T2u.klausul.some(k => k.kode === '5.1.05.02'), false)

bab('A6. P3 — sisipan P1 baru sekarang berubah nilai')
const p3 = salin(T2u.rows)
ubah(ubah(ubah(p3, '5.1.05.02', 300), '5.1.05.02.002', 300), '5.1.05', 1300)
const T3u = prosesTahap(T2u, p3, 'P3', OPTS)
const kl3 = T3u.klausul.find(k => k.kode === '5.1.05.02')
cek('muncul sebagai "diubah", bukan "disisipkan"', kl3.jenis, 'ubah')
cek('nomor pasalnya tetap', kl3.pasal, T1u.reg['5.1.05.02'])
cek('sisipan P2 tidak ikut terbawa', T3u.diubah.includes('4.1.01.03'), false)

bab('A7. simpan ke JSON lalu lanjut besok — registry wajib utuh')
const disimpan = JSON.parse(JSON.stringify({ rows: T3u.rows, reg: T3u.reg }))
const p4 = ubah(ubah(salin(disimpan.rows), '4.1.01.03', 75), '4.1.01.03.001', 75)
const T4u = prosesTahap(disimpan, p4, 'P4', OPTS)
cek('sisipan P1 utuh', T4u.reg['5.1.05.02'], T1u.reg['5.1.05.02'])
cek('sisipan P2 utuh', T4u.reg['4.1.01.03'], T2u.reg['4.1.01.03'])
cek('sisipan P2 diubah di P4', T4u.diubah.includes('4.1.01.03'), true)

bab('A8. validator dan deteksi anomali')
const T5u = prosesTahap(T4u, T4u.rows.map(r => R(r.kode, r.uraian, r.nilai, 999999)), 'P5', OPTS)
cek('nilai tidak cocok ditandai', T5u.peringatan.some(w => w.tipe === 'nilai'), true)
cek('setiap peringatan punya catatan', T5u.peringatan.every(w => !!w.catatan), true)

bab('A9. diagnosis baseline vs angka asing')
// Rantai lengkap lewat jalankanRantai supaya riwayat nilai ikut dirawat.
const arsipUji = [{ nama: 'P1', rows: p1 }, { nama: 'P2', rows: p2 }, { nama: 'P3', rows: p3 }]
const rantai = jalankanRantai({ rows: murniUji, reg: regUji }, arsipUji, OPTS)
cek('rantai bersih tanpa peringatan', rantai.flatMap(t => t.peringatan).length, 0)

// P4 versi "penyusun memakai baseline MURNI", seperti P2.xlsx yang asli.
const p4baseline = rantai[2].rows.map(r => {
  const asal = murniUji.find(m => m.kode === r.kode)
  return R(r.kode, r.uraian, r.nilai, asal ? asal.nilai : r.nilai)
})
const rBaseline = jalankanRantai({ rows: murniUji, reg: regUji },
  [...arsipUji, { nama: 'P4', rows: p4baseline }], OPTS)
const w4 = rBaseline[3].peringatan
cek('terdiagnosis sebagai baseline, bukan salah ketik', [...new Set(w4.map(w => w.tipe))], ['baseline'])
cek('baseline ditunjuk namanya', [...new Set(w4.map(w => w.baseline))], ['MURNI'])
cek('tidak ada yang dianggap asing', w4.filter(w => w.tipe === 'nilai').length, 0)

// Satu baris dengan angka yang tidak pernah ada di tahap mana pun.
const p4asing = rantai[2].rows.map(r => R(r.kode, r.uraian, r.nilai, r.nilai))
p4asing.find(r => r.kode === '4.1.01.06').tertulisSebelum = 123456789
const rAsing = jalankanRantai({ rows: murniUji, reg: regUji },
  [...arsipUji, { nama: 'P4', rows: p4asing }], OPTS)
const wAsing = rAsing[3].peringatan
cek('angka asing ditandai tepat satu', wAsing.filter(w => w.tipe === 'nilai').map(w => w.kode), ['4.1.01.06'])
cek('baseline-nya null', wAsing.find(w => w.tipe === 'nilai').baseline, null)
cek('selisih dilaporkan', typeof wAsing.find(w => w.tipe === 'nilai').selisih, 'number')

bab('A10. matriks riwayat nilai')
const m = matriksNilai({ rows: murniUji, reg: regUji }, rantai)
cek('kolom = MURNI + 3 tahap', m.labels, ['MURNI', 'P1', 'P2', 'P3'])
const bSisipan = m.baris.find(b => b.kode === '5.1.05.02')
cek('sisipan belum ada di MURNI', bSisipan.perTahap[0], undefined)
cek('lahir di P1 dengan nilai 0', bSisipan.perTahap[1], 0)
cek('berubah di P3 jadi 300', bSisipan.perTahap[3], 300)
cek('perubahan P3 ditandai', bSisipan.beda[3], true)
cek('P2 tidak ditandai berubah', bSisipan.beda[2], false)
const bTetap = m.baris.find(b => b.kode === '6.1.01.01')
cek('rekening yang tidak pernah bergerak', bTetap.berubah, false)
const T6u = prosesTahap(T4u, salin(T4u.rows.filter(r => r.kode !== '4.1.01.03')), 'P6', OPTS)
cek('kode hilang terdeteksi', T6u.dihapus.map(d => d.kode), ['4.1.01.03'])
cek('kode hilang tidak memicu penomoran ulang', T6u.reg['4.1.01.06'], T4u.reg['4.1.01.06'])
cek('tidak dibuat klausul "dihapus" otomatis', T6u.klausul.some(k => k.kode === '4.1.01.03'), false)

bab('A11. heading BAB dokumen dasar')
cek('BAB II/III/IV', naskahDasar(murniUji, regUji, OPTS).filter(b => b.jenis === 'bab' && b.teks.startsWith('BAB')).map(b => b.teks),
  ['BAB II', 'BAB III', 'BAB IV'])

// =============================================================== B. data nyata

const berkas = n => join(AKAR, `Lampiran 1 APBD (Penjabaran) - 2026 - ${n}.xlsx`)
const adaData = ['MURNI', 'P1', 'P2'].every(n => existsSync(berkas(n)))

if (!adaData) {
  bab('B. data 2026 asli — DILEWATI')
  console.log('  File "Lampiran 1 APBD (Penjabaran) - 2026 - *.xlsx" tidak ada di akar project.')
} else {
  const baca = async n => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(berkas(n))
    return bacaLampiran(wb.worksheets[0])
  }
  const murni = await baca('MURNI')
  const fp1 = await baca('P1')
  const fp2 = await baca('P2')

  bab('B1. pembacaan file')
  cek('MURNI pakai kolom jumlah', murni.kolomNilai, 'jumlah')
  cek('P1 pakai kolom setelah_perubahan', fp1.kolomNilai, 'setelah_perubahan')
  cek('sub rincian dibuang: 250 baris', murni.rows.length, 250)
  // Sel numerik pernah diurai sebagai teks berformat Indonesia sehingga titik
  // desimalnya hilang dan nilainya jadi 100x. Angka ini penjaganya.
  cek('desimal utuh: 5 Belanja Daerah', murni.rows.find(r => r.kode === '5').nilai, 913772477137.68)
  cek('desimal utuh: 6.1 Penerimaan Pembiayaan', murni.rows.find(r => r.kode === '6.1').nilai, 206682681016.68)
  cek('15 baris berdesimal', murni.rows.filter(r => r.nilai % 1 !== 0).length, 15)
  cek('P1 juga utuh', fp1.rows.find(r => r.kode === '5').nilai % 1 !== 0, true)

  bab('B2. penomoran pasal vs Perbup Nomor 2 Tahun 2026 (yang sudah diundangkan)')
  const reg0 = buatRegistryDasar(murni.rows, 3)
  const label = Object.values(reg0).sort(bandingPasal)
  cek('105 pasal rekening', Object.keys(reg0).length, 105)
  cek('Pasal 3 sampai 107', [label[0], label[label.length - 1]], ['3', '107'])
  cek('4 Pendapatan Daerah -> 3', reg0['4'], '3')
  cek('4.1 -> 4', reg0['4.1'], '4')
  cek('4.1.01 -> 5', reg0['4.1.01'], '5')
  cek('4.1.01.06 Pajak Hotel -> 6', reg0['4.1.01.06'], '6')
  cek('5 Belanja Daerah -> 43', reg0['5'], '43')
  cek('5.1 Belanja Operasi -> 44', reg0['5.1'], '44')
  cek('6 Pembiayaan Daerah -> 99', reg0['6'], '99')
  cek('6.1 -> 100', reg0['6.1'], '100')
  cek('6.2 -> 105', reg0['6.2'], '105')

  bab('B3. MURNI -> P1')
  // Lewat jalankanRantai supaya riwayat nilai ikut dirawat dan peringatan bisa
  // menunjuk baseline. prosesTahap langsung tetap sah, cuma tanpa diagnosis.
  const rantaiNyata = jalankanRantai({ rows: murni.rows, reg: reg0 },
    [{ nama: 'P1', rows: fp1.rows }, { nama: 'P2', rows: fp2.rows }], OPTS)
  const T1 = rantaiNyata[0]
  // Dokumen serah-terima menyebut 31 pasal termasuk Pasal 105, dengan alasan kode 6.2
  // bernilai salah di P1. Isi sel yang sebenarnya: 6.2 = 2.000.000.000 di MURNI, P1,
  // dan P2 — identik. Jadi Pasal 105 memang tidak berubah; daftar 31 itu kelebihan satu.
  cek('30 pasal diubah', T1.diubah.length, 30)
  cek('daftar pasal diubah', T1.diubah.map(k => T1.reg[k]).sort(bandingPasal),
    ['3', '31', '32', '33', '43', '44', '45', '46', '52', '53', '54', '55', '56', '62', '63',
      '64', '65', '68', '71', '72', '75', '78', '83', '84', '90', '91', '92', '93', '97', '98'])
  cek('Pasal 105 tidak ikut berubah', T1.diubah.map(k => T1.reg[k]).includes('105'), false)
  cek('sisipan tunggal Pasal 62A', T1.sisipan.map(s => [s.kode, s.pasal]), [['5.1.05.02', '62A']])
  cek('P1 cocok penuh dengan MURNI', T1.peringatan.filter(w => w.tipe === 'nilai').length, 0)
  cek('tidak ada kode hilang', T1.dihapus.length, 0)

  bab('B4. P1 -> P2')
  const T2 = rantaiNyata[1]
  cek('23 pasal diubah', T2.diubah.length, 23)
  cek('daftar pasal diubah', T2.diubah.map(k => T2.reg[k]).sort(bandingPasal),
    ['44', '45', '46', '47', '52', '53', '54', '55', '56', '57', '62', '63', '68', '71', '72',
      '75', '80', '82', '83', '85', '90', '91', '92'])
  cek('tanpa sisipan baru', T2.sisipan.length, 0)
  cek('Pasal 62A tidak diulang', T2.diubah.map(k => T2.reg[k]).includes('62A'), false)
  cek('registry 62A tetap tercatat', T2.reg['5.1.05.02'], '62A')
  cek('39 baris kolom sebelum_perubahan tidak cocok', T2.peringatan.length, 39)
  cek('semuanya terdiagnosis baseline, bukan angka asing',
    [...new Set(T2.peringatan.map(w => w.tipe))], ['baseline'])
  cek('baseline-nya MURNI', [...new Set(T2.peringatan.map(w => w.baseline))], ['MURNI'])
  cek('tidak ada satu pun angka asing', T2.peringatan.filter(w => w.tipe === 'nilai').length, 0)

  bab('B5. matriks riwayat nilai data 2026')
  const mN = matriksNilai({ rows: murni.rows, reg: reg0 }, rantaiNyata)
  cek('kolom MURNI, P1, P2', mN.labels, ['MURNI', 'P1', 'P2'])
  cek('250 rekening + 2 kode baru', mN.baris.length, 254)
  const b62A = mN.baris.find(b => b.kode === '5.1.05.02')
  cek('62A belum ada di MURNI', b62A.perTahap[0], undefined)
  cek('62A lahir di P1 dengan Rp 0', b62A.perTahap[1], 0)
  cek('62A tidak bergerak di P2', b62A.beda[2], false)
  const bDanaDesa = mN.baris.find(b => b.kode === '4.2.01.05')
  cek('Dana Desa: MURNI -> P1 turun', [bDanaDesa.perTahap[0], bDanaDesa.perTahap[1]],
    [63436384000, 26862027000])
  cek('Dana Desa ditandai berubah di P1', bDanaDesa.beda[1], true)
  cek('Dana Desa tidak berubah lagi di P2', bDanaDesa.beda[2], false)
  console.log(`        ${mN.baris.filter(b => b.berubah).length} rekening pernah berubah nilai sepanjang rantai.`)

  bab('B6. tampilan per tahap — matriks dan peringatan ikut tahap yang dipilih')
  // Persis yang dilakukan komponen: rantai dipotong sampai tahap terpilih.
  const sampai = i => rantaiNyata.slice(0, i + 1)

  const mMurni = matriksNilai({ rows: murni.rows, reg: reg0 }, sampai(-1))
  cek('pilih MURNI: satu kolom saja', mMurni.labels, ['MURNI'])
  cek('pilih MURNI: 250 rekening', mMurni.baris.length, 250)
  cek('pilih MURNI: tidak ada yang "berubah"', mMurni.baris.some(b => b.berubah), false)
  cek('pilih MURNI: 62A belum ada', mMurni.baris.some(b => b.kode === '5.1.05.02'), false)

  const mP1 = matriksNilai({ rows: murni.rows, reg: reg0 }, sampai(0))
  cek('pilih P1: dua kolom', mP1.labels, ['MURNI', 'P1'])
  cek('pilih P1: 62A sudah muncul', mP1.baris.some(b => b.kode === '5.1.05.02'), true)
  cek('pilih P1: 4.1.02.03 belum ada (baru di P2)',
    mP1.baris.some(b => b.kode === '5.1.02.03.001'), false)

  const mP2 = matriksNilai({ rows: murni.rows, reg: reg0 }, sampai(1))
  cek('pilih P2: tiga kolom', mP2.labels, ['MURNI', 'P1', 'P2'])
  cek('pilih P2: 254 rekening', mP2.baris.length, 254)

  // Yang bikin pusing sebelumnya: melihat P1 tapi kena peringatan milik P2.
  const wSampai = i => sampai(i).flatMap(t => t.peringatan)
  cek('pilih MURNI: nol peringatan', wSampai(-1).length, 0)
  cek('pilih P1: nol peringatan', wSampai(0).length, 0)
  cek('pilih P2: 39 peringatan, semua milik P2', wSampai(1).length, 39)

  // Registry juga sesuai tahap: nilai berlaku diambil dari state tahap itu.
  cek('nilai 62A saat P1', sampai(0).at(-1).rows.find(r => r.kode === '5.1.05.02').nilai, 0)
  cek('62A ada di registry P1', sampai(0).at(-1).reg['5.1.05.02'], '62A')

  bab('B7. ekspor .docx')
  const meta = {
    daerah: 'BURU', provinsi: 'MALUKU', nomor: '15', tahun: '2026',
    perbupDasar: 'Nomor 2 Tahun 2026', tahunAnggaran: '2026',
    tempatTanggal: 'Namlea, 5 Agustus 2026',
    menimbang: 'bahwa perlu menetapkan Peraturan Bupati;',
    mengingat: 'Peraturan Menteri Dalam Negeri Nomor 64 Tahun 2020;',
    jabatanPenetap: 'BUPATI BURU,', namaPenetap: '-',
    jabatanPengundang: 'SEKRETARIS DAERAH BURU,', namaPengundang: '-'
  }
  const par = blokKeParagraf(naskahPergeseran(T1, meta, { nomorKlausul: true }))
  cek('setiap paragraf punya teks', par.every(p => typeof p.teks === 'string'), true)
  const buf = Buffer.from(await (await buatDocx(par)).arrayBuffer())
  cek('docx terbentuk', buf.length > 4000, true)
  cek('tanda tangan zip (PK)', buf.subarray(0, 2).toString(), 'PK')
}

console.log(gagal ? `\n${gagal} PENGUJIAN GAGAL\n` : '\nSemua pengujian lulus.\n')
process.exit(gagal ? 1 : 0)
