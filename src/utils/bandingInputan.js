import ExcelJS from 'exceljs'
import {
  normalKodeRekening, variasiAwalan, subRincianRekening,
} from '../../api/src/utils/kodeRekening.js'

// ---- Cek Inputan: adu usulan proyeksi dengan pagu yang sudah benar-benar diinput ----
//
// Alurnya sengaja SATU ARAH: file rekap anggaran hasil input dibaca DI BROWSER
// saja dan tidak pernah dikirim ke server. Tabel `anggaran_rekap` di aplikasi
// (yang jadi sumber kolom Pagu di seluruh perhitungan proyeksi) tidak tersentuh,
// jadi mengunggah pembanding di sini TIDAK menggeser angka usulan yang sedang
// dibandingkan. Kalau file ini ikut disimpan, pagunya berubah → proyeksinya
// ikut berubah → yang dibandingkan jadi dirinya sendiri.

export class BerkasTidakDikenal extends Error {}

// Nama kolom mengikuti file rekap anggaran (rekap4/rekap5) yang sudah dipakai
// halaman Anggaran Rekap — bukan format baru, supaya berkas yang sama bisa
// dipakai di dua tempat tanpa diolah dulu.
const KOL_KODE_REK = 'KODE REKENING'
const KOL_NAMA_REK = 'NAMA REKENING'
const KOL_KODE_UNIT = 'KODE SUB UNIT'
const KOL_NAMA_UNIT = 'NAMA SUB UNIT'
const KOL_PAGU = 'PAGU'

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

// Pagu bisa datang sebagai angka, sebagai hasil rumus, atau sebagai teks
// berformat Indonesia ("1.234.567.890" / "1.234.567,89"). Titik hanya dibuang
// kalau polanya memang pemisah ribuan — kalau tidak, "1.5" akan terbaca 15.
export function angkaRp(nilai) {
  if (nilai == null) return 0
  if (typeof nilai === 'number') return nilai
  if (typeof nilai === 'object') {
    if ('result' in nilai) return Number(nilai.result) || 0
    return angkaRp(teks(nilai))
  }
  let s = String(nilai).trim().replace(/rp\.?/gi, '').replace(/\s/g, '')
  if (!s) return 0
  const adaKoma = s.includes(',')
  const adaTitik = s.includes('.')
  if (adaKoma && adaTitik) s = s.replace(/\./g, '').replace(',', '.')
  else if (adaKoma) s = s.replace(',', '.')
  else if (adaTitik && /^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// Pencocokan awalan DIPAKU DI BATAS SEGMEN, sama persis dengan
// klausaAwalanRekening di sisi API — kalau pakai startsWith polos, awalan
// 5.1.01.01.01 ikut menyambar 5.1.01.01.010.* pada data 2026.
function penyaringAwalan(prefix) {
  const varian = variasiAwalan(String(prefix || '').replace(/[^0-9.]/g, ''))
  return (kode) => {
    const k = String(kode || '').trim()
    return varian.some(v => v && (k === v || k.startsWith(v + '.')))
  }
}

/**
 * Baca file rekap anggaran hasil input, saring ke awalan rekening yang sedang
 * dipakai, lalu jumlahkan per Unit SKPD × rekening — kunci yang SAMA dengan
 * pengelompokan pagu di hitungProyeksiGaji (GROUP BY kode_sub_unit,
 * kode_rekening), supaya barisnya bisa dipasangkan satu-satu.
 *
 * Kode rekening dinormalkan ke format terlebar dulu, jadi file lama (segmen
 * 2/4 digit) tetap berpasangan dengan proyeksi TA 2026 (3/5 digit).
 */
export async function bacaRekapAnggaran(file, { prefix }) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) throw new BerkasTidakDikenal('File Excel-nya tidak berisi sheet apa pun.')

  const kolom = {}
  ws.getRow(1).eachCell((cell, no) => {
    const nama = teks(cell.value).trim().toUpperCase()
    if (nama) kolom[nama] = no
  })
  for (const wajib of [KOL_KODE_REK, KOL_KODE_UNIT, KOL_PAGU]) {
    if (!kolom[wajib]) {
      throw new BerkasTidakDikenal(
        `Kolom "${wajib}" tidak ada di baris pertama file. Yang diharapkan berkas rekap anggaran ` +
        '(rekap4/rekap5) — file yang sama dengan yang dipakai di menu Anggaran Rekap.'
      )
    }
  }

  const cocokAwalan = penyaringAwalan(prefix)
  const sel = (row, nama) => (kolom[nama] ? row.getCell(kolom[nama]).value : null)

  const peta = new Map()
  let barisData = 0
  let barisTerpakai = 0
  let totalPagu = 0
  ws.eachRow((row, no) => {
    if (no === 1) return
    const kodeRek = teks(sel(row, KOL_KODE_REK)).trim()
    if (!kodeRek) return // baris hierarki (urusan/program/kegiatan) tanpa rekening
    barisData += 1
    if (!cocokAwalan(kodeRek)) return

    const kodeSkpd = teks(sel(row, KOL_KODE_UNIT)).trim()
    const kunci = `${kodeSkpd}|${normalKodeRekening(kodeRek)}`
    const pagu = angkaRp(sel(row, KOL_PAGU))
    let e = peta.get(kunci)
    if (!e) {
      e = {
        kunci, kodeSkpd,
        namaSkpd: teks(sel(row, KOL_NAMA_UNIT)).trim(),
        kodeRekening: kodeRek,
        namaRekening: teks(sel(row, KOL_NAMA_REK)).trim(),
        pagu: 0, baris: 0,
      }
      peta.set(kunci, e)
    }
    e.pagu += pagu
    e.baris += 1
    barisTerpakai += 1
    totalPagu += pagu
  })

  if (!peta.size) {
    throw new BerkasTidakDikenal(
      `Tidak ada satu pun baris berawalan ${prefix} di file itu. Pastikan file rekap anggarannya ` +
      'memuat belanja gaji, dan kode rekening di kotak "Kode rekening" sudah sesuai.'
    )
  }

  return {
    peta,
    namaBerkas: file.name,
    barisData,
    barisTerpakai,
    jumlahRekening: peta.size,
    jumlahDinas: new Set([...peta.values()].map(e => e.kodeSkpd)).size,
    totalPagu,
  }
}

export const STATUS = {
  SESUAI: 'sesuai',   // selisihnya di dalam toleransi
  KURANG: 'kurang',   // diinput lebih kecil dari usulan — dinas bisa kehabisan gaji
  LEBIH: 'lebih',     // diinput lebih besar dari usulan
  HILANG: 'hilang',   // ada di usulan, tidak ada barisnya di file inputan
  EKSTRA: 'ekstra',   // ada di file inputan, tidak ada di usulan proyeksi
}

const ringkasanKosong = () => ({
  sesuai: 0, kurang: 0, lebih: 0, hilang: 0, ekstra: 0,
  jumlah: 0, usulan: 0, inputan: 0, selisih: 0,
  selisihKurang: 0, selisihLebih: 0,
})

function hitungRingkasan(target, b) {
  target.jumlah += 1
  target[b.status] += 1
  target.usulan += b.usulan
  target.inputan += b.inputan || 0
  target.selisih += b.selisih
  if (b.selisih < 0) target.selisihKurang += b.selisih
  else if (b.selisih > 0) target.selisihLebih += b.selisih
}

/**
 * Pasangkan tiap rekening usulan dengan baris inputan yang sepadan.
 *
 * `sisi` memilih usulan mana yang jadi patokan: 'rumus' (dari tren realisasi)
 * atau 'sim' (dari isian Sim Gaji) — dua-duanya sudah ada di payload, jadi
 * pemakai bisa mengecek terhadap angka yang benar-benar ia pakai waktu
 * menginput. `toleransi` dalam rupiah: selisih di bawahnya dianggap sesuai,
 * berguna kalau waktu input angkanya dibulatkan ke ribuan.
 */
export function bandingkanInputan(akhir, inputan, { sisi = 'rumus', toleransi = 0 } = {}) {
  const tol = Math.max(0, Number(toleransi) || 0)
  const pakaiSim = sisi === 'sim'
  const terpakai = new Set()
  const baris = []
  const petaDinas = new Map()

  for (const s of akhir?.skpd || []) {
    for (const r of s.rekening || []) {
      const kunci = `${s.kodeSkpd}|${normalKodeRekening(r.kodeRekening)}`
      const e = inputan.peta.get(kunci)
      if (e) terpakai.add(kunci)
      const usulan = pakaiSim ? r.alokasiSim : r.alokasi
      const inputPagu = e ? e.pagu : null
      const selisih = (inputPagu ?? 0) - usulan
      const status = !e ? STATUS.HILANG
        : Math.abs(selisih) <= tol ? STATUS.SESUAI
        : selisih < 0 ? STATUS.KURANG : STATUS.LEBIH
      const b = {
        kunci,
        kodeSkpd: s.kodeSkpd, namaSkpd: s.namaSkpd, terkunci: !!s.terkunci,
        kodeRekening: r.kodeRekening, namaRekening: r.namaRekening,
        golongan: r.golongan,
        // Pagu yang masih tercatat di aplikasi — pembanding ketiga, supaya
        // kelihatan apakah input itu memang menggeser sesuatu atau tidak.
        paguAplikasi: r.pagu,
        kebutuhan: pakaiSim ? r.kebutuhanSim : r.kebutuhan,
        usulan, inputan: inputPagu, selisih, status,
        // Kurang dari kebutuhan riil = benar-benar berisiko kehabisan gaji,
        // beda dari sekadar meleset dari usulan (yang sudah termasuk acress).
        dibawahKebutuhan: e ? inputPagu < (pakaiSim ? r.kebutuhanSim : r.kebutuhan) : false,
      }
      baris.push(b)

      let d = petaDinas.get(s.kodeSkpd)
      if (!d) {
        d = { kodeSkpd: s.kodeSkpd, namaSkpd: s.namaSkpd, terkunci: !!s.terkunci, ...ringkasanKosong() }
        petaDinas.set(s.kodeSkpd, d)
      }
      hitungRingkasan(d, b)
    }
  }

  // Baris yang ada di file tapi tidak punya pasangan di proyeksi: rekening gaji
  // yang baru dibuka di dinas itu, atau kode/unit yang salah ketik waktu input.
  const ekstra = []
  for (const e of inputan.peta.values()) {
    if (terpakai.has(e.kunci)) continue
    ekstra.push({
      ...e, golongan: null, paguAplikasi: null, kebutuhan: 0,
      usulan: 0, inputan: e.pagu, selisih: e.pagu,
      status: STATUS.EKSTRA, dibawahKebutuhan: false,
      terkunci: false,
    })
  }

  const total = ringkasanKosong()
  for (const b of baris) hitungRingkasan(total, b)
  for (const b of ekstra) {
    total.jumlah += 1
    total.ekstra += 1
    total.inputan += b.inputan
    total.selisih += b.selisih
    total.selisihLebih += b.selisih
  }

  const dinas = [...petaDinas.values()].sort((a, b) =>
    (a.sesuai === a.jumlah ? 1 : 0) - (b.sesuai === b.jumlah ? 1 : 0) ||
    a.selisih - b.selisih)

  return {
    sisi, toleransi: tol,
    baris: [...baris, ...ekstra],
    dinas,
    total,
    // Berapa rekening yang benar-benar perlu ditengok — dipakai buat lencana tab.
    jumlahBermasalah: total.jumlah - total.sesuai,
    jumlahDibawahKebutuhan: baris.filter(b => b.dibawahKebutuhan).length,
  }
}

// ---- Matriks: dinas × komponen gaji, dipisah per golongan ----
//
// Susunan yang sama dengan lembar kerja manual selama ini: satu tabel per
// golongan (PNS, PPPK), baris = perangkat daerah, kolom = komponen gaji
// (Gaji Pokok … Kematian). Tiga lapis angka — Hitungan, Inputan, lalu
// Perbandingan TRUE/FALSE — dibangun dari hasil bandingkanInputan, jadi
// pasangan dan toleransinya persis sama dengan tabel rincian di bawahnya.

// "Belanja Iuran Jaminan Kematian PNS" → "Kematian". Cukup pendek untuk judul
// kolom tanpa kehilangan pembeda antar-komponen.
export function labelKomponen(namaRekening) {
  const kata = String(namaRekening || '').trim().split(/\s+/)
  if (kata.length > 1 && /^(PNS|PPPK)$/i.test(kata[kata.length - 1])) kata.pop()
  return kata.join(' ')
    .replace(/^Belanja\s+/i, '')
    .replace(/^Iuran\s+Jaminan\s+/i, '')
    .replace(/^Tunjangan\s+(?!PPh)/i, '')
    .replace(/^Tunjangan\s+PPh\/Tunjangan\s+Khusus$/i, 'PPh/Khusus')
    .trim() || String(namaRekening || '')
}

const urutKode = (a, b) => String(a).localeCompare(String(b), 'id', { numeric: true })

/**
 * Susun hasil bandingkanInputan jadi matriks per golongan.
 *
 * Sel yang tidak ada di kedua sisi (dinas itu memang tidak punya rekening
 * tersebut) bernilai null — bukan TRUE, supaya tidak ikut dihitung "cocok".
 * Sel yang hanya ada di salah satu sisi dibaca 0 di sisi lainnya, sama seperti
 * sel kosong di Excel: usulan 0 yang tidak diinput = TRUE, inputan tanpa
 * usulan = FALSE.
 *
 * Keputusannya diambil di tingkat TOTAL, bukan per sel. Rekening yang meleset
 * tapi jumlah dinas-golongannya tetap sama dengan hitungan = "saling tutup"
 * (satu rekening sengaja ditebalkan, rekening lain di dinas & golongan yang
 * sama ditipiskan) — tetap ditampilkan, tapi bukan masalah. Baru dianggap
 * SIGNIFIKAN kalau selisih jumlahnya melewati `toleransiTotal`. Saling tutup
 * tidak boleh lintas golongan (PNS tidak menutup PPPK), sama seperti aturan
 * pergeseran.
 */
export const STATUS_TOTAL = {
  COCOK: 'cocok',
  SALING_TUTUP: 'salingTutup',
  SIGNIFIKAN: 'signifikan',
}

function statusTotal(salah, selisih, tolTotal) {
  if (Math.abs(selisih) > tolTotal) return STATUS_TOTAL.SIGNIFIKAN
  return salah ? STATUS_TOTAL.SALING_TUTUP : STATUS_TOTAL.COCOK
}

export function matriksBanding(hasil, { toleransiTotal = 0 } = {}) {
  if (!hasil) return []
  const tol = hasil.toleransi || 0
  const tolTotal = Math.max(0, Number(toleransiTotal) || 0)
  const petaGol = new Map()

  for (const b of hasil.baris) {
    const kunciGol = subRincianRekening(b.kodeRekening) || '-'
    let g = petaGol.get(kunciGol)
    if (!g) {
      g = { kunci: kunciGol, label: null, kolom: new Map(), dinas: new Map() }
      petaGol.set(kunciGol, g)
    }
    if (!g.label) {
      const akhirKata = String(b.namaRekening || '').trim().split(/\s+/).pop()
      if (akhirKata) g.label = akhirKata.toUpperCase()
    }

    const kodeKolom = normalKodeRekening(b.kodeRekening)
    if (!g.kolom.has(kodeKolom)) {
      g.kolom.set(kodeKolom, {
        kode: kodeKolom, kodeAsli: b.kodeRekening,
        nama: b.namaRekening, label: labelKomponen(b.namaRekening),
      })
    }

    let d = g.dinas.get(b.kodeSkpd)
    if (!d) {
      d = { kodeSkpd: b.kodeSkpd, namaSkpd: b.namaSkpd, terkunci: !!b.terkunci, sel: {} }
      g.dinas.set(b.kodeSkpd, d)
    }
    const hitungan = b.status === STATUS.EKSTRA ? 0 : (b.usulan || 0)
    const input = b.inputan ?? 0
    d.sel[kodeKolom] = {
      hitungan, inputan: input,
      adaHitungan: b.status !== STATUS.EKSTRA,
      adaInputan: b.inputan != null,
      selisih: input - hitungan,
      cocok: Math.abs(input - hitungan) <= tol,
      status: b.status,
    }
  }

  return [...petaGol.values()]
    .sort((a, b) => urutKode(a.kunci, b.kunci))
    .map(g => {
      const kolom = [...g.kolom.values()].sort((a, b) => urutKode(a.kode, b.kode))
      const baris = [...g.dinas.values()]
        .sort((a, b) => urutKode(a.kodeSkpd, b.kodeSkpd))
        .map(d => {
          let jumlahHitungan = 0, jumlahInputan = 0, salah = 0
          for (const k of kolom) {
            const c = d.sel[k.kode]
            if (!c) continue
            jumlahHitungan += c.hitungan
            jumlahInputan += c.inputan
            if (!c.cocok) salah += 1
          }
          const selisih = jumlahInputan - jumlahHitungan
          return {
            ...d, jumlahHitungan, jumlahInputan, selisih,
            salah, cocok: salah === 0,
            status: statusTotal(salah, selisih, tolTotal),
          }
        })
      const total = { hitungan: {}, inputan: {}, salah: {} }
      for (const k of kolom) {
        total.hitungan[k.kode] = 0
        total.inputan[k.kode] = 0
        total.salah[k.kode] = 0
        for (const d of baris) {
          const c = d.sel[k.kode]
          if (!c) continue
          total.hitungan[k.kode] += c.hitungan
          total.inputan[k.kode] += c.inputan
          if (!c.cocok) total.salah[k.kode] += 1
        }
      }
      const jumlahHitungan = baris.reduce((a, d) => a + d.jumlahHitungan, 0)
      const jumlahInputan = baris.reduce((a, d) => a + d.jumlahInputan, 0)
      const hitung = (st) => baris.filter(d => d.status === st)
      const signifikan = hitung(STATUS_TOTAL.SIGNIFIKAN)
      const salingTutup = hitung(STATUS_TOTAL.SALING_TUTUP)
      return {
        kunci: g.kunci,
        label: g.label || `Sub rincian ${g.kunci}`,
        kolom, baris, total, toleransiTotal: tolTotal,
        jumlahHitungan, jumlahInputan,
        selisih: jumlahInputan - jumlahHitungan,
        // Total golongan sekabupaten melewati batas atau tidak — terpisah dari
        // status per dinas: dua dinas bisa meleset berlawanan arah dan
        // totalnya tetap pas, tapi masing-masing dinas tetap SIGNIFIKAN.
        totalSignifikan: Math.abs(jumlahInputan - jumlahHitungan) > tolTotal,
        jumlahSalah: baris.reduce((a, d) => a + d.salah, 0),
        dinasSalah: baris.filter(d => !d.cocok).length,
        dinasSignifikan: signifikan.length,
        dinasSalingTutup: salingTutup.length,
        selSalingTutup: salingTutup.reduce((a, d) => a + d.salah, 0),
        selisihSignifikan: signifikan.reduce((a, d) => a + d.selisih, 0),
      }
    })
}
