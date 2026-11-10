// Impor arsip JSON DPA hasil download penat-extension versi lama ke tabel
// sipd_jadwal / sipd_tim_tapd / dpa_*. Memakai fungsi simpan yang sama dengan
// POST /api/sync/jadwal, /tim-tapd, /dpa (src/routes/syncDpa.js), jadi sinkron
// ulang dari extension nanti cukup menimpa, tidak menggandakan.
//
//   cd api && node scripts/impor-arsip-dpa.mjs "/mnt/d/PENAT OUTPUT" --dry-run
//   cd api && node scripts/impor-arsip-dpa.mjs "/mnt/d/PENAT OUTPUT"
//
// Opsi:
//   --dry-run          hitung saja, tidak menulis ke DB
//   --tahun 2024,2025  batasi tahun (bawaan: semua folder tahun di arsip)
//   --laporan <file>   lokasi CSV laporan yang dilewati (bawaan: ./laporan-impor-arsip-dpa.csv)
//   --alias-kode 2024:<kode lain>=<kode yang disimpan>   (boleh berulang)
//                      dua kode SKPD dianggap satu dinas pada tahun itu. Dipakai
//                      untuk dinas yang ganti kode: SIPD mengisi sebagian field
//                      arsip lama dengan kode master yang berlaku SAAT DOWNLOAD,
//                      sehingga kode di file dan di referensi tidak sama. Kolom
//                      kode_skpd di tabel diisi <kode yang disimpan>; kolom data
//                      tetap apa adanya. Hasilnya tetap dilewati kalau kedua kode
//                      menunjuk ke id berbeda.
//
//                      Contoh — Dinas Perumahan 2024: DPA aslinya memakai
//                      1.04.1.03.1.05.01.0000 (kode yang berlaku 2024–2025),
//                      sedangkan rincian yang didownload 2026 dan referensi SKPD
//                      2024 sudah memakai kode baru 1.04.2.10.0.00.01.0000:
//                        --alias-kode 2024:1.04.2.10.0.00.01.0000=1.04.1.03.1.05.01.0000
//   --timpa            timpa dokumen yang SUDAH ada di DB. Bawaannya dilewati:
//                      dokumen yang sudah ada berasal dari extension baru, lebih
//                      baru dari arsip ini.
//
// Struktur arsip:
//   {tahun}/jadwal.json, {tahun}/tim-tapd.json
//   {tahun}/{nama jadwal}/{nama SKPD}/1. depan - persetujuan.json … 5. pembiayaan.json
//   {tahun}/{nama jadwal}/{nama SKPD}/{nama sub SKPD}/{kode_sub_giat}.json   (rincian belanja)
//
// File lama tidak menyimpan id_skpd / id_sub_skpd / id_sub_giat. Semuanya
// diturunkan dari kode di DALAM file lewat referensi tahun itu (skpd,
// sub_kegiatan). Kode yang tidak ketemu TIDAK ditebak: dilewati dan dicatat.

import 'dotenv/config'
import { readdir, readFile, writeFile } from 'fs/promises'
import { join, relative } from 'path'

import db from '../src/db.js'
import { simpanJadwal, simpanTimTapd, simpanDpa, TABEL_DPA } from '../src/routes/syncDpa.js'

// ---- argumen ----
const argv = process.argv.slice(2)
const opsi = (nama) => {
  const i = argv.indexOf(nama)
  return i >= 0 ? argv[i + 1] : undefined
}
const AKAR = argv.find((a, i) => !a.startsWith('--') && !['--tahun', '--laporan', '--alias-kode'].includes(argv[i - 1]))
const DRY = argv.includes('--dry-run')
const TIMPA = argv.includes('--timpa')
const FILTER_TAHUN = opsi('--tahun')?.split(',').map(Number)
const LAPORAN = opsi('--laporan') || 'laporan-impor-arsip-dpa.csv'

// tahun → Map(kode → daftar kode setara, kode yang disimpan di depan)
const ALIAS = new Map()
for (const [i, a] of argv.entries()) {
  if (a !== '--alias-kode') continue
  const m = /^(\d{4}):([^=]+)=(.+)$/.exec(argv[i + 1] ?? '')
  if (!m) { console.log(`--alias-kode tidak valid: ${argv[i + 1]} (bentuk: 2024:<kode lain>=<kode yang disimpan>)`); process.exit(1) }
  const [, t, lain, disimpan] = m
  if (!ALIAS.has(+t)) ALIAS.set(+t, new Map())
  const grup = [disimpan, lain]
  ALIAS.get(+t).set(lain, grup).set(disimpan, grup)
}
const setara = (tahun, kode) => ALIAS.get(tahun)?.get(kode) ?? [kode]
const kanonik = (tahun, kode) => setara(tahun, kode)[0]
if (!AKAR) {
  console.log('Pemakaian: node scripts/impor-arsip-dpa.mjs <folder arsip> [--dry-run] [--tahun 2024,2025] [--laporan file.csv] [--alias-kode 2024:lain=disimpan] [--timpa]')
  process.exit(1)
}

const FILE_JENIS = {
  '1. depan - persetujuan.json': 'persetujuan_depan',
  '2. skpd.json': 'skpd',
  '3. pendapatan.json': 'pendapatan',
  '4. belanja.json': 'belanja',
  '5. pembiayaan.json': 'pembiayaan',
}
const SEMUA_JENIS = Object.keys(TABEL_DPA)

// Sanitasi nama folder yang dipakai extension lama.
const sanitasi = (nama) => String(nama ?? '').replace(/[/\\?%*:|"<>]/g, '-').trim()

// ---- laporan ----
const dilewati = []   // { tahun, jenis, alasan, kode, path }
const pakaiAlias = new Set()   // path file yang terpetakan berkat --alias-kode
function lewati(tahun, jenis, alasan, kode, path) {
  dilewati.push({ tahun, jenis, alasan, kode: kode ?? '', path: relative(AKAR, path) })
  hitung(tahun, jenis).dilewati++
}
const rekap = new Map()   // `${tahun}|${jenis}` → { masuk, dilewati }
function hitung(tahun, jenis) {
  const k = `${tahun}|${jenis}`
  if (!rekap.has(k)) rekap.set(k, { masuk: 0, dilewati: 0 })
  return rekap.get(k)
}

async function bacaJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function isiFolder(path) {
  const isi = await readdir(path, { withFileTypes: true })
  return {
    folder: isi.filter(e => e.isDirectory()).map(e => e.name).sort(),
    file: isi.filter(e => e.isFile()).map(e => e.name).sort(),
  }
}

// ---- referensi per tahun ----
async function muatReferensi(tahun_id) {
  const [skpd] = await db.query('SELECT id_skpd, kode_skpd, nama_skpd FROM skpd WHERE tahun_id = ?', [tahun_id])
  const skpdPerKode = new Map(skpd.map(s => [s.kode_skpd, { ...s, id_skpd: Number(s.id_skpd) }]))

  const [sub] = await db.query(
    `SELECT DISTINCT id_skpd, id_sub_skpd, kode_sub_skpd, id_sub_giat, kode_sub_giat
     FROM sub_kegiatan WHERE tahun_id = ?`,
    [tahun_id]
  )
  // Kunci yang muncul lebih dari sekali dengan id berbeda = ambigu, tidak dipakai.
  const subPerKode = new Map()
  const subAmbigu = new Set()
  for (const s of sub) {
    const k = `${s.kode_sub_skpd}|${s.kode_sub_giat}`
    if (subPerKode.has(k)) subAmbigu.add(k)
    else subPerKode.set(k, { id_skpd: Number(s.id_skpd), id_sub_skpd: Number(s.id_sub_skpd), id_sub_giat: Number(s.id_sub_giat) })
  }
  return { skpdPerKode, subPerKode, subAmbigu }
}

// Kunci dokumen yang sudah ada di DB, untuk melewati yang tidak boleh ditimpa.
async function kunciTersimpan(tahun_id) {
  const ada = new Set()
  for (const [jenis, tabel] of Object.entries(TABEL_DPA)) {
    const rincian = jenis === 'rincian_belanja'
    const [rows] = await db.query(
      `SELECT t.sipd_jadwal_id, t.id_skpd${rincian ? ', t.id_sub_skpd, t.id_sub_giat' : ''}
       FROM ${tabel} t JOIN sipd_jadwal j ON j.id = t.sipd_jadwal_id
       WHERE j.tahun_id = ?`,
      [tahun_id]
    )
    for (const r of rows) ada.add(kunciDok(jenis, r.sipd_jadwal_id, r.id_skpd, r.id_sub_skpd, r.id_sub_giat))
  }
  return ada
}
const kunciDok = (jenis, jadwal, id_skpd, id_sub_skpd, id_sub_giat) =>
  jenis === 'rincian_belanja'
    ? `${jenis}|${jadwal}|${id_skpd}|${id_sub_skpd}|${id_sub_giat}`
    : `${jenis}|${jadwal}|${id_skpd}`

// ---- jadwal & tim TAPD: bandingkan dengan DB, lalu simpan ----
function tukarTapd(row) {
  // Sama dengan nipTertukar di syncDpa.js — hanya untuk membandingkan di laporan.
  const nama = String(row.nama_tapd ?? '').trim()
  const nip = String(row.nip_tapd ?? '').trim()
  const tukar = /^[\d\s]+$/.test(nama) || /[A-Za-z]/.test(nip)
  return { nama: tukar ? nip : nama, nip: tukar ? nama : nip }
}

async function bandingReferensi(tahun_id, jadwalArsip, tapdArsip) {
  const [jadwalDb] = await db.query(
    'SELECT id_jadwal, id_jadwal_sipd, nama, tahapan FROM sipd_jadwal WHERE tahun_id = ?', [tahun_id]
  )
  const [tapdDb] = await db.query(
    'SELECT no_urut, nama, nip, jabatan FROM sipd_tim_tapd WHERE tahun_id = ? ORDER BY no_urut', [tahun_id]
  )
  const sJ = (j) => `${j.id_jadwal}|${j.id_jadwal_sipd}|${String(j.nama ?? '').trim()}|${String(j.tahapan ?? '').trim()}`
  const arsipJ = new Set(jadwalArsip.map(j => sJ({ ...j, nama: j.jadwal_sipd_penatausahaan })))
  const dbJ = jadwalDb.map(sJ)
  const jadwalBaru = jadwalArsip.filter(j => !jadwalDb.some(d => d.id_jadwal === Number(j.id_jadwal))).length
  const jadwalBerbeda = dbJ.filter(x => !arsipJ.has(x) && jadwalArsip.some(j => x.startsWith(`${j.id_jadwal}|`))).length

  const sT = (t) => `${Number(t.no_urut)}|${String(t.nama ?? '').trim()}|${String(t.nip ?? '').trim()}|${String(t.jabatan ?? '').trim()}`
  const arsipT = tapdArsip.map(t => sT({ no_urut: t.no_urut, ...tukarTapd(t), jabatan: t.jabatan_tapd })).sort()
  const dbT = tapdDb.map(sT).sort()
  const tapdSama = arsipT.join('\n') === dbT.join('\n')

  return { jadwalDb: jadwalDb.length, jadwalBaru, jadwalBerbeda, tapdDb: tapdDb.length, tapdSama }
}

// ---- proses satu tahun ----
async function prosesTahun(tahun) {
  const folderTahun = join(AKAR, String(tahun))
  const [[ta]] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  if (!ta) {
    console.log(`\n== ${tahun}: tidak ada di tahun_anggaran, dilewati`)
    return
  }
  const tahun_id = ta.id
  console.log(`\n== ${tahun}`)

  const jadwalArsip = await bacaJson(join(folderTahun, 'jadwal.json'))
  const tapdArsip = await bacaJson(join(folderTahun, 'tim-tapd.json'))
  const banding = await bandingReferensi(tahun_id, jadwalArsip, tapdArsip)
  console.log(`  jadwal.json   : ${jadwalArsip.length} jadwal (di DB ${banding.jadwalDb}; baru ${banding.jadwalBaru}; berbeda dari arsip ${banding.jadwalBerbeda})`)
  console.log(`  tim-tapd.json : ${tapdArsip.length} anggota (di DB ${banding.tapdDb}; ${banding.tapdDb ? (banding.tapdSama ? 'isi SAMA' : 'isi BERBEDA — akan diganti versi arsip') : 'kosong'})`)

  // Nama folder → jadwal. Nama yang sama setelah sanitasi = ambigu, tidak dipakai.
  const jadwalPerNama = new Map()
  const namaAmbigu = new Set()
  for (const j of jadwalArsip) {
    const k = sanitasi(j.jadwal_sipd_penatausahaan)
    if (jadwalPerNama.has(k)) namaAmbigu.add(k)
    jadwalPerNama.set(k, j)
  }

  if (!DRY) {
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      await simpanJadwal(conn, tahun_id, jadwalArsip)
      await simpanTimTapd(conn, tahun_id, tapdArsip)
      await conn.commit()
    } catch (err) {
      await conn.rollback()
      throw err
    } finally {
      conn.release()
    }
  }
  const [jadwalDb] = await db.query('SELECT id, id_jadwal FROM sipd_jadwal WHERE tahun_id = ?', [tahun_id])
  // Saat dry-run jadwal baru belum ada di DB — pakai penanda sementara agar
  // hitungan tetap jalan (kunci dokumennya tidak mungkin bentrok dengan DB).
  const uuidJadwal = new Map(jadwalDb.map(j => [Number(j.id_jadwal), j.id]))
  const idJadwalDb = (id_jadwal) => uuidJadwal.get(id_jadwal) ?? `baru:${id_jadwal}`

  const ref = await muatReferensi(tahun_id)
  const sudahAda = await kunciTersimpan(tahun_id)
  const dilihat = new Map()   // kunci → path, untuk duplikat di dalam arsip

  const { folder: folderJadwal } = await isiFolder(folderTahun)
  for (const namaJadwal of folderJadwal) {
    const pathJadwal = join(folderTahun, namaJadwal)
    const jadwal = jadwalPerNama.get(namaJadwal.trim())
    if (!jadwal || namaAmbigu.has(namaJadwal.trim())) {
      lewati(tahun, '*', jadwal ? 'nama jadwal ambigu' : 'folder jadwal tidak ada di jadwal.json', namaJadwal, pathJadwal)
      continue
    }
    const sipd_jadwal_id = idJadwalDb(Number(jadwal.id_jadwal))
    const { folder: folderSkpd } = await isiFolder(pathJadwal)
    let nJadwal = 0

    for (const namaSkpd of folderSkpd) {
      const pathSkpd = join(pathJadwal, namaSkpd)
      const { file, folder: folderSub } = await isiFolder(pathSkpd)

      // Kumpulkan dokumen satu SKPD dulu (sudah tervalidasi), lalu tulis dalam
      // satu transaksi. Hanya satu folder SKPD yang dipegang di memori.
      const antre = []
      const periksa = async (path, jenis) => {
        let isi
        try { isi = await bacaJson(path) } catch (e) {
          return lewati(tahun, jenis, `JSON tidak terbaca: ${e.message}`, '', path)
        }
        if (!isi || typeof isi !== 'object') return lewati(tahun, jenis, 'isi file bukan objek JSON', '', path)
        let viaAlias = false
        // Semua kode setara (alias) dicoba; harus berujung ke SATU id_skpd.
        const calonSkpd = [...new Map(setara(tahun, isi.kode_skpd)
          .map(k => ref.skpdPerKode.get(k)).filter(Boolean)
          .map(s => [s.id_skpd, s])).values()]
        if (calonSkpd.length > 1) return lewati(tahun, jenis, 'kode_skpd setara menunjuk ke beberapa id_skpd', isi.kode_skpd, path)
        const skpd = calonSkpd[0]
        if (!skpd) return lewati(tahun, jenis, 'kode_skpd tidak ada di referensi SKPD', isi.kode_skpd, path)

        const kodeSkpd = kanonik(tahun, isi.kode_skpd)
        if (kodeSkpd !== isi.kode_skpd || !ref.skpdPerKode.has(isi.kode_skpd)) viaAlias = true
        const dok = { jenis, sipd_jadwal_id, id_skpd: skpd.id_skpd, kode_skpd: kodeSkpd, nama_skpd: isi.nama_skpd ?? skpd.nama_skpd, data: isi }
        if (jenis === 'rincian_belanja') {
          if (isi.id_jadwal_sipd != null && Number(isi.id_jadwal_sipd) !== Number(jadwal.id_jadwal_sipd))
            return lewati(tahun, jenis, `id_jadwal_sipd di file (${isi.id_jadwal_sipd}) ≠ jadwal folder (${jadwal.id_jadwal_sipd})`, '', path)
          const k = `${isi.kode_sub_skpd}|${isi.kode_sub_giat}`
          const kunciSetara = setara(tahun, isi.kode_sub_skpd).map(ks => `${ks}|${isi.kode_sub_giat}`)
          if (kunciSetara.some(x => ref.subAmbigu.has(x))) return lewati(tahun, jenis, 'kode sub SKPD + sub kegiatan ambigu di referensi', k, path)
          const calonSub = [...new Map(kunciSetara
            .map(x => ref.subPerKode.get(x)).filter(Boolean)
            .map(c => [`${c.id_sub_skpd}|${c.id_sub_giat}`, c])).values()]
          if (calonSub.length > 1) return lewati(tahun, jenis, 'kode sub SKPD setara menunjuk ke sub kegiatan berbeda', k, path)
          const sub = calonSub[0]
          if (!sub) return lewati(tahun, jenis, 'kode sub SKPD + sub kegiatan tidak ada di referensi Sub Kegiatan', k, path)
          if (!ref.subPerKode.has(k)) viaAlias = true
          if (sub.id_skpd !== skpd.id_skpd)
            return lewati(tahun, jenis, `sub kegiatan milik id_skpd ${sub.id_skpd}, file menyebut ${skpd.id_skpd}`, k, path)
          Object.assign(dok, {
            id_sub_skpd: sub.id_sub_skpd, nama_sub_skpd: isi.nama_sub_skpd,
            id_sub_giat: sub.id_sub_giat, kode_sub_giat: isi.kode_sub_giat, nama_sub_giat: isi.nama_sub_giat,
          })
        }

        const kunci = kunciDok(jenis, sipd_jadwal_id, dok.id_skpd, dok.id_sub_skpd, dok.id_sub_giat)
        if (dilihat.has(kunci))
          return lewati(tahun, jenis, `duplikat di arsip (kunci sama dengan ${relative(AKAR, dilihat.get(kunci))})`, '', path)
        dilihat.set(kunci, path)
        if (sudahAda.has(kunci) && !TIMPA)
          return lewati(tahun, jenis, 'sudah ada di DB (dari extension), tidak ditimpa', '', path)
        if (viaAlias) pakaiAlias.add(path)
        antre.push(dok)
      }

      for (const nama of file) {
        const jenis = FILE_JENIS[nama]
        if (!jenis) { lewati(tahun, '?', 'nama file tidak dikenal', nama, join(pathSkpd, nama)); continue }
        await periksa(join(pathSkpd, nama), jenis)
      }
      for (const namaSub of folderSub) {
        const pathSub = join(pathSkpd, namaSub)
        const { file: fileRincian, folder: lebih } = await isiFolder(pathSub)
        for (const f of lebih) lewati(tahun, 'rincian_belanja', 'folder tak terduga di dalam folder sub SKPD', f, join(pathSub, f))
        for (const nama of fileRincian) {
          if (!nama.endsWith('.json')) { lewati(tahun, 'rincian_belanja', 'bukan file .json', nama, join(pathSub, nama)); continue }
          await periksa(join(pathSub, nama), 'rincian_belanja')
        }
      }

      if (!DRY && antre.length) {
        const conn = await db.getConnection()
        try {
          await conn.beginTransaction()
          for (const dok of antre) await simpanDpa(conn, dok)
          await conn.commit()
        } catch (err) {
          await conn.rollback()
          throw err
        } finally {
          conn.release()
        }
      }
      for (const dok of antre) hitung(tahun, dok.jenis).masuk++
      nJadwal += antre.length
    }
    console.log(`  ${namaJadwal}: ${nJadwal} dokumen ${DRY ? 'akan masuk' : 'masuk'}`)
  }
}

// ---- jalan ----
console.log(`Impor arsip DPA dari ${AKAR}${DRY ? '  [DRY-RUN — tidak menulis ke DB]' : ''}${TIMPA ? '  [--timpa]' : ''}`)
const { folder: folderAkar } = await isiFolder(AKAR)
const daftarTahun = folderAkar.filter(f => /^\d{4}$/.test(f)).map(Number)
  .filter(t => !FILTER_TAHUN || FILTER_TAHUN.includes(t))

try {
  for (const tahun of daftarTahun) await prosesTahun(tahun)
} finally {
  // Ringkasan tahun × jenis
  console.log(`\nRingkasan (${DRY ? 'akan masuk' : 'masuk'} / dilewati):`)
  const kolom = [...SEMUA_JENIS, '*', '?'].filter(j => daftarTahun.some(t => rekap.has(`${t}|${j}`)))
  console.log('  tahun  ' + kolom.map(j => j.padStart(18)).join(''))
  for (const t of daftarTahun) {
    console.log(`  ${t}   ` + kolom.map(j => {
      const r = rekap.get(`${t}|${j}`)
      return (r ? `${r.masuk} / ${r.dilewati}` : '-').padStart(18)
    }).join(''))
  }

  const csv = (v) => `"${String(v).replace(/"/g, '""')}"`
  const isiCsv = ['tahun,jenis,alasan,kode,path', ...dilewati.map(d => [d.tahun, d.jenis, d.alasan, d.kode, d.path].map(csv).join(','))]
  await writeFile(LAPORAN, '﻿' + isiCsv.join('\n') + '\n')

  // Alasan dilewati, dikelompokkan — biar laporan panjang tetap terbaca sekilas.
  const perAlasan = new Map()
  for (const d of dilewati) {
    const k = `${d.tahun} ${d.jenis}: ${d.alasan.replace(/\(.*\)/, '(…)')}`
    perAlasan.set(k, (perAlasan.get(k) || 0) + 1)
  }
  if (perAlasan.size) {
    console.log('\nDilewati per alasan:')
    for (const [k, n] of [...perAlasan].sort()) console.log(`  ${String(n).padStart(6)}  ${k}`)
  }
  if (ALIAS.size) console.log(`\nTerpetakan lewat --alias-kode: ${pakaiAlias.size} file`)
  console.log(`\nLaporan: ${LAPORAN} (${dilewati.length} baris)`)
  await db.end()
}
