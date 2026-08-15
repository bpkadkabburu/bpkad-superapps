// Pengujian route /api/perbup-apbd terhadap database sungguhan.
//   cd api && npm run uji:perbup [tahun]
//
// Memakai tahun uji (default 2027) dan MENOLAK jalan kalau tahun itu sudah punya
// data perbup, supaya tidak pernah menimpa rantai pergeseran yang asli.
// Semua yang ditulis dibersihkan di akhir.

import 'dotenv/config'
import { Hono } from 'hono'
import jwt from 'jsonwebtoken'
import ExcelJS from 'exceljs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'

import db from '../src/db.js'
import perbup from '../src/routes/perbupApbd.js'
import { bacaLampiran } from '../../src/utils/perbupExcel.js'
import { buatRegistryDasar, prosesTahap, bandingPasal } from '../../src/utils/perbupEngine.js'

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TAHUN = Number(process.argv[2]) || 2027

let gagal = 0
const cek = (nama, aktual, harap) => {
  const ok = JSON.stringify(aktual) === JSON.stringify(harap)
  if (!ok) {
    gagal++
    console.log(`  GAGAL ${nama}\n        dapat : ${JSON.stringify(aktual)}\n        harap : ${JSON.stringify(harap)}`)
  } else console.log(`  ok    ${nama}`)
}
const bab = t => console.log(`\n${t}`)

// ------------------------------------------------------------------ pengaman
const [tahunRow] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [TAHUN])
if (!tahunRow.length) {
  console.error(`Tahun anggaran ${TAHUN} tidak ada di database. Pakai: npm run uji:perbup <tahun>`)
  process.exit(1)
}
const [terpakai] = await db.query(
  'SELECT COUNT(*) AS n FROM perbup_dokumen WHERE tahun_id = ?', [tahunRow[0].id]
)
if (Number(terpakai[0].n) > 0) {
  console.error(
    `TA ${TAHUN} sudah punya ${terpakai[0].n} dokumen perbup. Pengujian dibatalkan supaya ` +
    `data asli tidak tertimpa. Jalankan dengan tahun lain yang kosong.`
  )
  process.exit(1)
}

const berkas = n => join(AKAR, `Lampiran 1 APBD (Penjabaran) - 2026 - ${n}.xlsx`)
if (!['MURNI', 'P1', 'P2'].every(n => existsSync(berkas(n)))) {
  console.error('File "Lampiran 1 APBD (Penjabaran) - 2026 - *.xlsx" tidak ada di akar project.')
  process.exit(1)
}

// ------------------------------------------------------------------ persiapan
const app = new Hono()
app.route('/api/perbup-apbd', perbup)

const token = jwt.sign({ id: 'uji', username: 'uji', role: 'superadmin' }, process.env.JWT_SECRET)
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
const req = (path, init = {}) => app.request(`/api/perbup-apbd${path}`, { ...init, headers: H })
const json = async (path, init) => {
  const r = await req(path, init)
  return [r.status, await r.json()]
}

const baca = async n => {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(berkas(n))
  return bacaLampiran(wb.worksheets[0])
}
const murni = await baca('MURNI')
const p1 = await baca('P1')
const p2 = await baca('P2')
const reg0 = buatRegistryDasar(murni.rows, 3)
const OPTS = { tahunAnggaran: '2026', pasalMulai: 3 }

// Kolom JSON MySQL tidak menjaga urutan kunci objek, jadi registry dibandingkan
// sebagai pasangan yang diurutkan — bukan sebagai string JSON.
const pasangan = obj => Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : 1))

console.log(`\nPengujian API perbup-apbd, TA uji ${TAHUN}`)

bab('C1. otorisasi')
cek('tanpa token ditolak', (await app.request(`/api/perbup-apbd?tahun=${TAHUN}`)).status, 401)

bab('C2. keadaan awal')
cek('kosong', (await json(`?tahun=${TAHUN}`))[1], { pengaturan: null, dasar: null, arsip: [] })
cek('tahun tak dikenal tidak error', (await json('?tahun=1999'))[1].dasar, null)

bab('C3. simpan dokumen dasar dan rantai')
cek('PUT dasar', (await json(`/dasar?tahun=${TAHUN}`, {
  method: 'PUT',
  body: JSON.stringify({ nama: 'MURNI.xlsx', kolomNilai: 'jumlah', rows: murni.rows, reg: reg0 })
}))[0], 200)
cek('baris kosong ditolak', (await json(`/dasar?tahun=${TAHUN}`, {
  method: 'PUT', body: JSON.stringify({ rows: [] })
}))[0], 400)
cek('P1 urutan 1', (await json(`/pergeseran?tahun=${TAHUN}`, {
  method: 'POST',
  body: JSON.stringify({ nama: 'P1.xlsx', kolomNilai: 'setelah_perubahan', rows: p1.rows })
}))[1].urutan, 1)
cek('P2 urutan 2', (await json(`/pergeseran?tahun=${TAHUN}`, {
  method: 'POST',
  body: JSON.stringify({ nama: 'P2.xlsx', kolomNilai: 'setelah_perubahan', rows: p2.rows })
}))[1].urutan, 2)

bab('C4. muat ulang — bandingkan dengan hasil langsung dari Excel')
const [, data] = await json(`?tahun=${TAHUN}`)
cek('nama dokumen dasar', data.dasar.nama, 'MURNI.xlsx')
cek('250 baris utuh', data.dasar.rows.length, 250)
cek('registry identik (105 pasal)', pasangan(data.dasar.reg), pasangan(reg0))
cek('urutan baris terjaga', data.dasar.rows.slice(0, 4).map(r => r.kode), murni.rows.slice(0, 4).map(r => r.kode))
cek('desimal tidak rusak', data.dasar.rows.find(r => r.kode === '6.1').nilai, 206682681016.68)
cek('tertulisSebelum terjaga', data.arsip[0].rows.find(r => r.kode === '4').tertulisSebelum, 709089796121)
cek('2 pergeseran urut', data.arsip.map(a => [a.urutan, a.nama]), [[1, 'P1.xlsx'], [2, 'P2.xlsx']])

const dbT1 = prosesTahap({ rows: data.dasar.rows, reg: data.dasar.reg }, data.arsip[0].rows, 'P1', OPTS)
const xlT1 = prosesTahap({ rows: murni.rows, reg: reg0 }, p1.rows, 'P1', OPTS)
cek('P1 dari DB = P1 dari Excel',
  dbT1.diubah.map(k => dbT1.reg[k]).sort(bandingPasal),
  xlT1.diubah.map(k => xlT1.reg[k]).sort(bandingPasal))
cek('Pasal 62A tetap lahir', dbT1.sisipan.map(s => s.pasal), ['62A'])
const dbT2 = prosesTahap(dbT1, data.arsip[1].rows, 'P2', OPTS)
cek('P2 dari DB: 23 pasal, tanpa sisipan', [dbT2.diubah.length, dbT2.sisipan.length], [23, 0])
cek('62A tetap tercatat', dbT2.reg['5.1.05.02'], '62A')

bab('C5. pengaturan')
await json(`/pengaturan?tahun=${TAHUN}`, {
  method: 'PUT',
  body: JSON.stringify({
    pasalMulai: 3, nomorKlausul: true,
    meta: { daerah: 'BURU', nomor: '15' },
    templateAkun: { 6: 'Anggaran {uraian} Tahun Anggaran {tahun}, terdiri atas:' }
  })
})
const [, d2] = await json(`?tahun=${TAHUN}`)
cek('nomor klausul', d2.pengaturan.nomorKlausul, true)
cek('meta', d2.pengaturan.meta.nomor, '15')
cek('template akun', d2.pengaturan.templateAkun['6'], 'Anggaran {uraian} Tahun Anggaran {tahun}, terdiri atas:')

bab('C6. hapus berjenjang')
cek('urutan tidak valid ditolak', (await json(`/pergeseran/0?tahun=${TAHUN}`, { method: 'DELETE' }))[0], 400)
await json(`/pergeseran/1?tahun=${TAHUN}`, { method: 'DELETE' })
const [, d3] = await json(`?tahun=${TAHUN}`)
cek('hapus P1 ikut menghapus P2', d3.arsip.length, 0)
cek('dokumen dasar tetap', d3.dasar.rows.length, 250)

bab('C7. ganti dokumen dasar mengosongkan rantai')
await json(`/pergeseran?tahun=${TAHUN}`, { method: 'POST', body: JSON.stringify({ nama: 'P1.xlsx', rows: p1.rows }) })
await json(`/dasar?tahun=${TAHUN}`, {
  method: 'PUT',
  body: JSON.stringify({ nama: 'APBD-P.xlsx', kolomNilai: 'jumlah', rows: murni.rows, reg: reg0 })
})
const [, d4] = await json(`?tahun=${TAHUN}`)
cek('rantai dikosongkan', d4.arsip.length, 0)
cek('dasar terganti', d4.dasar.nama, 'APBD-P.xlsx')

bab('C8. bersih-bersih')
await json(`?tahun=${TAHUN}`, { method: 'DELETE' })
cek('kosong kembali', (await json(`?tahun=${TAHUN}`))[1], { pengaturan: null, dasar: null, arsip: [] })
const [sisa] = await db.query('SELECT COUNT(*) AS n FROM perbup_dokumen WHERE tahun_id = ?', [tahunRow[0].id])
cek('tidak ada sisa baris', Number(sisa[0].n), 0)

console.log(gagal ? `\n${gagal} PENGUJIAN GAGAL\n` : '\nSemua pengujian API lulus.\n')
process.exit(gagal ? 1 : 0)
