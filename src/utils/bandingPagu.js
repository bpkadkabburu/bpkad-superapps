import ExcelJS from 'exceljs'
import { normalKodeRekening, subRincianRekening } from '../../api/src/utils/kodeRekening.js'
import {
  PREFIX_GAJI, AWALAN_TPP, kodeSintetisPppkPw, LABEL_KOMPONEN_PPPK_PW,
} from '../../api/src/utils/kategoriPegawai.js'
import api from './api.js'
import { angkaRp, BerkasTidakDikenal } from './bandingInputan.js'

export { angkaRp, BerkasTidakDikenal }

// ---- Cek Rancangan Pagu: pagu yang SUDAH tersinkron di anggaran_rekap (hasil
// DPA/SIPD) dibandingkan dengan rancangan pagu BPKAD (file terpisah, murni
// dibaca di browser, tidak pernah dikirim ke server) ----
//
// Berbeda dari tab "Cek Inputan" di Proyeksi Gaji: di sana usulan = hasil
// proyeksi/reallocation, inputan = file upload. Di sini usulan ("akhir") =
// pagu yang sudah ada di aplikasi (anggaran_rekap.pagu), inputan = rancangan
// pagu BPKAD. `bandingkanInputan`/`matriksBanding` dipakai apa adanya karena
// keduanya cuma peduli bentuk datanya, bukan arti kedua sisinya.

/**
 * Pagu yang sudah tersinkron di anggaran_rekap untuk satu kategori (gaji/tpp/
 * pppk_pw), dibentuk ulang jadi bentuk {skpd:[{kodeSkpd,namaSkpd,rekening:[]}]}
 * supaya bisa langsung dipasangkan oleh bandingkanInputan seperti sisi "akhir".
 */
export async function ambilPaguSistem(tahun, kategori) {
  const res = await api.get('/sumber-data/anggaran/rekap-pegawai', { params: { tahun, kategori } })
  const petaSkpd = new Map()
  for (const r of res.data?.data || []) {
    const pagu = Number(r.pagu || 0)
    // Rekening berpagu 0 dilewati, sama seperti sel kosong/0 yang dilewati
    // waktu baca rancangan (lihat bacaBarisPivot) — kalau tidak, rekening yang
    // sama-sama tidak relevan di kedua sisi (sistem 0, rancangan tak diisi)
    // akan selalu tampil HILANG padahal sebenarnya cocok (nol == nol).
    if (!pagu) continue
    let s = petaSkpd.get(r.kodeSkpd)
    if (!s) {
      s = { kodeSkpd: r.kodeSkpd, namaSkpd: r.namaSkpd, terkunci: false, rekening: [] }
      petaSkpd.set(r.kodeSkpd, s)
    }
    s.rekening.push({
      kodeRekening: r.kodeRekening,
      namaRekening: r.namaRekening,
      golongan: subRincianRekening(r.kodeRekening),
      pagu,
      alokasi: pagu,
      kebutuhan: 0,
    })
  }
  return { skpd: [...petaSkpd.values()] }
}

// ---- Penyimpanan rancangan pagu ----
//
// Berbeda dari file pembanding "Cek Inputan" (sengaja tidak pernah disimpan,
// karena itu salinan dari angka yang sedang diadu), rancangan pagu BPKAD
// bukan derivasi dari anggaran_rekap — jadi aman, dan malah perlu, disimpan
// supaya tidak diunggah ulang tiap buka halaman. Satu upload menimpa seluruh
// rancangan kategori itu untuk tahun tsb (lihat migrasi rancangan_pagu).

function hasilDariPeta(peta, namaBerkas) {
  return {
    peta, namaBerkas,
    barisData: peta.size, barisTerpakai: peta.size,
    jumlahRekening: peta.size,
    jumlahDinas: new Set([...peta.values()].map(e => e.kodeSkpd)).size,
    totalPagu: [...peta.values()].reduce((a, e) => a + e.pagu, 0),
  }
}

/** Ambil rancangan pagu tersimpan, kalau ada — bentuknya sama seperti hasil parser. */
export async function ambilRancanganTersimpan(tahun, kategori) {
  const res = await api.get('/rancangan-pagu', { params: { tahun, kategori } })
  const data = res.data?.data
  if (!data) return null

  const peta = new Map()
  for (const r of data.baris) {
    peta.set(`${r.kodeSkpd}|${normalKodeRekening(r.kodeRekening)}`, {
      kunci: `${r.kodeSkpd}|${normalKodeRekening(r.kodeRekening)}`,
      kodeSkpd: r.kodeSkpd, namaSkpd: r.namaSkpd,
      kodeRekening: r.kodeRekening, namaRekening: r.namaRekening,
      pagu: r.pagu, baris: 1,
    })
  }
  const hasil = hasilDariPeta(peta, data.namaBerkas)
  hasil.uploadedAt = data.uploadedAt
  return hasil
}

/** Simpan hasil parser (peta) sebagai rancangan pagu tetap untuk tahun+kategori itu. */
export async function simpanRancangan(tahun, kategori, hasil) {
  const data = [...hasil.peta.values()].map(e => ({
    kodeSkpd: e.kodeSkpd, namaSkpd: e.namaSkpd,
    kodeRekening: e.kodeRekening, namaRekening: e.namaRekening,
    pagu: e.pagu,
  }))
  await api.post('/rancangan-pagu', { tahun, kategori, namaBerkas: hasil.namaBerkas, data })
}

export async function hapusRancangan(tahun, kategori) {
  await api.delete('/rancangan-pagu', { params: { tahun, kategori } })
}

const normalisasiNama = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase()

function teks(nilai) {
  if (nilai == null) return ''
  if (typeof nilai === 'object') {
    if (nilai.richText) return nilai.richText.map(r => r.text).join('')
    if (nilai.text) return String(nilai.text)
    if ('result' in nilai) return String(nilai.result ?? '')
    return ''
  }
  return String(nilai)
}

function tambahBaris(peta, { kodeSkpd, namaSkpd, kodeRekening, namaRekening, pagu }) {
  const kunci = `${kodeSkpd}|${normalKodeRekening(kodeRekening)}`
  let e = peta.get(kunci)
  if (!e) {
    e = { kunci, kodeSkpd, namaSkpd, kodeRekening, namaRekening, pagu: 0, baris: 0 }
    peta.set(kunci, e)
  }
  e.pagu += pagu
  e.baris += 1
}

// ---- Pembaca umum: tabel pivot — satu baris per OPD (kolom "Kode SKPD",
// "Nama SKPD"), lalu satu kolom data per rekening/komponen. Kolom lain
// (mis. TOTAL) dilewati begitu saja karena headernya tidak dikenali oleh
// `petakanKolom`. Dipakai oleh ketiga kategori (Gaji, TPP, PPPK Paruh Waktu) —
// yang beda cuma cara mengenali header kolom datanya.
const KOL_KODE_SKPD = 'KODE SKPD'
const KOL_NAMA_SKPD = 'NAMA SKPD'

/** Cari kolom "Kode SKPD"/"Nama SKPD" + kolom data yang dikenali `petakanKolom` di baris pertama sheet. */
function deteksiKolomPivot(ws, petakanKolom) {
  const kolom = {}
  const kolomData = new Map() // nomor kolom -> { kodeRekening, namaRekening }
  ws.getRow(1).eachCell((cell, no) => {
    const h = teks(cell.value).trim()
    const hNorm = normalisasiNama(h)
    if (hNorm === KOL_KODE_SKPD) kolom.kodeSkpd = no
    else if (hNorm === KOL_NAMA_SKPD) kolom.namaSkpd = no
    else {
      const d = petakanKolom(h)
      if (d) kolomData.set(no, d)
    }
  })
  return { kolom, kolomData }
}

function bacaBarisPivot(ws, kolom, kolomData, namaBerkas) {
  const peta = new Map()
  let barisData = 0
  let barisTerpakai = 0

  ws.eachRow((row, no) => {
    if (no === 1) return
    const kodeSkpd = teks(row.getCell(kolom.kodeSkpd).value).trim()
    if (!kodeSkpd) return
    barisData += 1
    const namaSkpd = kolom.namaSkpd ? teks(row.getCell(kolom.namaSkpd).value).trim() : kodeSkpd
    for (const [no2, d] of kolomData) {
      const pagu = angkaRp(row.getCell(no2).value)
      // Sel kosong/nol dilewati, bukan disimpan sebagai pagu 0 — kebanyakan OPD
      // memang tidak punya baris anggaran sama sekali untuk sebagian kriteria
      // (mis. TPP Kelangkaan Profesi), jadi kalau tetap disimpan 0, baris itu
      // akan selalu "EKSTRA" (ada di rancangan, tidak ada di sistem) walau
      // sebenarnya sama-sama tidak relevan buat OPD itu.
      if (!pagu) continue
      tambahBaris(peta, { kodeSkpd, namaSkpd, kodeRekening: d.kodeRekening, namaRekening: d.namaRekening, pagu })
      barisTerpakai += 1
    }
  })

  if (!peta.size) {
    throw new BerkasTidakDikenal(`Tidak ada satu pun baris berisi Kode SKPD di sheet "${ws.name}".`)
  }
  return {
    peta, namaBerkas, barisData, barisTerpakai,
    jumlahRekening: peta.size,
    jumlahDinas: new Set([...peta.values()].map(e => e.kodeSkpd)).size,
    totalPagu: [...peta.values()].reduce((a, e) => a + e.pagu, 0),
  }
}

// Kolom rekening ditulis sebagai kode rekening itu sendiri sebagai header,
// persis seperti di aplikasi (mis. "5.1.01.01.001.00001") — berlaku sama
// untuk Gaji (awalan 5.1.01.01) dan TPP (awalan 5.1.01.02).
const KODE_REKENING_LIKE = /^\d+\.\d+(\.\d+)+$/
function cocokAwalan(kode, prefix) {
  const k = String(kode || '').trim()
  return k === prefix || k.startsWith(prefix + '.')
}
function kolomKodeRekening(daftarAwalan) {
  return (h) => (KODE_REKENING_LIKE.test(h) && daftarAwalan.some(a => cocokAwalan(h, a)))
    ? { kodeRekening: h, namaRekening: h } : null
}

// PPPK Paruh Waktu tidak punya kode rekening pasti (lihat kategoriPegawai.js)
// — kolomnya dikenali lewat nama komponennya langsung.
const KOMPONEN_DARI_LABEL = new Map([
  ['GAJI', 'gaji'], ['GAJI (RP)', 'gaji'],
  ['BPJS KESEHATAN', 'bpjs_kesehatan'], ['BPJS KESEHATAN (RP)', 'bpjs_kesehatan'],
  ['JKK', 'jkk'], ['JKK (RP)', 'jkk'],
  ['JKM', 'jkm'], ['JKM (RP)', 'jkm'],
])

const PETAKAN_KOLOM_PPPK_PW = (h) => {
  const komponen = KOMPONEN_DARI_LABEL.get(normalisasiNama(h))
  return komponen ? { kodeRekening: kodeSintetisPppkPw(komponen), namaRekening: LABEL_KOMPONEN_PPPK_PW[komponen] } : null
}

// ---- Satu berkas gabungan: tiap kategori (Gaji/TPP/PPPK Paruh Waktu) jadi
// satu sheet dalam workbook yang sama. Tiap sheet dikenali kategorinya sendiri
// dari header baris pertama (dicoba ke ketiga `petakanKolom`, yang cocoknya
// paling banyak kolom yang menang) — jadi tidak bergantung nama sheet.

const KATEGORI_PETAKAN = {
  gaji: kolomKodeRekening([PREFIX_GAJI]),
  tpp: kolomKodeRekening(AWALAN_TPP),
  pppk_pw: PETAKAN_KOLOM_PPPK_PW,
}
const LABEL_KATEGORI = { gaji: 'Gaji', tpp: 'TPP', pppk_pw: 'PPPK Paruh Waktu' }

/**
 * Baca satu workbook berisi beberapa sheet (satu per kategori), simpan tiap
 * kategori yang terbaca sebagai rancangan pagu tetap (menimpa yang lama).
 * @returns {Promise<{tersimpan: Record<string, object>, sheetTakDikenali: string[]}>}
 */
export async function bacaDanSimpanRancanganGabungan(file, tahun) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  if (!wb.worksheets.length) throw new BerkasTidakDikenal('File Excel-nya tidak berisi sheet apa pun.')

  const tersimpan = {}
  const sheetTakDikenali = []

  for (const ws of wb.worksheets) {
    let terbaik = null // { kategori, kolom, kolomData }
    for (const [kategori, petakanKolom] of Object.entries(KATEGORI_PETAKAN)) {
      const { kolom, kolomData } = deteksiKolomPivot(ws, petakanKolom)
      if (!kolom.kodeSkpd || !kolomData.size) continue
      if (!terbaik || kolomData.size > terbaik.kolomData.size) terbaik = { kategori, kolom, kolomData }
    }
    if (!terbaik) { sheetTakDikenali.push(ws.name); continue }

    const hasil = bacaBarisPivot(ws, terbaik.kolom, terbaik.kolomData, file.name)
    await simpanRancangan(tahun, terbaik.kategori, hasil)
    tersimpan[terbaik.kategori] = { ...hasil, label: LABEL_KATEGORI[terbaik.kategori], namaSheet: ws.name }
  }

  if (!Object.keys(tersimpan).length) {
    throw new BerkasTidakDikenal(
      'Tidak ada satu pun sheet yang dikenali sebagai Gaji, TPP, atau PPPK Paruh Waktu di file itu.'
    )
  }
  return { tersimpan, sheetTakDikenali }
}
