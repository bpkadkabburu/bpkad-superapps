// Engine konversi Lampiran I APBD -> naskah Perbup Penjabaran.
// Semua fungsi murni (tanpa state komponen) supaya bisa diuji terpisah.
//
// Fondasinya panjang string kode rekening:
//    1     akun          -> dapat pasal, sekaligus jadi BAB
//    3     kelompok      -> dapat pasal
//    6     jenis         -> dapat pasal
//    9     objek         -> dapat pasal (pasal terakhir dalam rantai)
//   12/13  rincian objek -> TIDAK dapat pasal, muncul sebagai ayat/huruf
//   17/19  sub rincian   -> dibuang sebelum diproses
//
// Dua prinsip yang tidak boleh dilanggar (lihat KONTEKS-Konverter-Perbup-APBD.md):
//  1. `sebelum_perubahan` hanya validator, tidak pernah dipakai menghitung.
//  2. Pasal sisipan yang sudah terbit tidak pernah dinomori ulang.

import { rupiah, rupiahTerbilang } from './terbilang.js'

const PANJANG_INDUK = { 3: 1, 6: 3, 9: 6, 12: 9, 13: 9, 17: 13, 19: 13 }
const NAMA_ANAK = { 1: 'kelompok', 3: 'jenis', 6: 'objek', 9: 'rincian objek' }

export const TEMPLATE_AKUN_DEFAULT = {
  4: 'Anggaran {uraian} Tahun Anggaran {tahun} direncanakan sebesar {nilai}, yang bersumber dari:',
  5: 'Anggaran {uraian} Tahun Anggaran {tahun} direncanakan sebesar {nilai}, terdiri atas:',
  6: 'Anggaran {uraian} Tahun Anggaran {tahun}, terdiri atas:',
  lain: 'Anggaran {uraian} Tahun Anggaran {tahun} direncanakan sebesar {nilai}, terdiri atas:'
}

export const indukDari = kode => {
  const p = PANJANG_INDUK[kode.length]
  return p ? kode.slice(0, p) : null
}
export const isSubRincian = kode => kode.length === 17 || kode.length === 19
export const isRincian = kode => kode.length === 12 || kode.length === 13
export const punyaPasal = kode => !isSubRincian(kode) && !isRincian(kode)

/** Urutan pasal: angka dulu, lalu huruf. 62 < 62A < 62B < 62Z < 62AA < 63 */
const pecahLabel = label => {
  const m = /^(\d+)([A-Z]*)$/.exec(String(label)) || [null, '0', '']
  return { angka: parseInt(m[1], 10), huruf: m[2] }
}
export function bandingPasal(a, b) {
  const pa = pecahLabel(a)
  const pb = pecahLabel(b)
  if (pa.angka !== pb.angka) return pa.angka - pb.angka
  if (pa.huruf.length !== pb.huruf.length) return pa.huruf.length - pb.huruf.length
  return pa.huruf < pb.huruf ? -1 : pa.huruf > pb.huruf ? 1 : 0
}

/** A, B, ... Z, AA, AB, ... — huruf pertama yang belum terpakai pada satu basis. */
function hurufBerikut(terpakai) {
  for (let i = 0; i < 26 * 27; i++) {
    let n = i
    let s = ''
    do {
      s = String.fromCharCode(65 + (n % 26)) + s
      n = Math.floor(n / 26) - 1
    } while (n >= 0)
    if (!terpakai.has(s)) return s
  }
  return 'ZZ'
}

/**
 * Judul KAPITAL -> Title Case. Teks yang sudah campur dibiarkan apa adanya.
 * Akronim dalam tanda kurung dipertahankan: "(PAD)" tidak jadi "(pad)".
 */
export function ucwords(teks) {
  const s = String(teks ?? '')
  if (s !== s.toUpperCase()) return s
  return s.split(' ')
    .map(w => {
      if (!w) return w
      if (/^\([A-Z0-9]{2,}\)[.,;]?$/.test(w)) return w
      const kecil = w.toLowerCase()
      return kecil.charAt(0).toUpperCase() + kecil.slice(1)
    })
    .join(' ')
}

// ---------------------------------------------------------------- registry

/** Nomori ulang dari nol. HANYA dipakai untuk dokumen dasar yang baru diunggah. */
export function buatRegistryDasar(rows, pasalMulai = 3) {
  const reg = {}
  let p = Number(pasalMulai) || 3
  rows.forEach(r => { if (punyaPasal(r.kode)) reg[r.kode] = String(p++) })
  return reg
}

/** Peta anak + rujukan "sebagaimana dimaksud pada ...". */
export function konteks(rows, reg) {
  const byKode = {}
  const anak = {}
  const dimaksud = {}

  rows.forEach(r => { byKode[r.kode] = r })
  rows.forEach(r => {
    const i = indukDari(r.kode)
    if (i) (anak[i] = anak[i] || []).push(r)
  })

  Object.keys(anak).forEach(k => {
    if (!reg[k]) return
    const ch = anak[k]
    ch.forEach((c, i) => {
      if (ch.length === 1) dimaksud[c.kode] = `Pasal ${reg[k]}`
      else if (c.kode.length === 3) dimaksud[c.kode] = `Pasal ${reg[k]} huruf ${String.fromCharCode(97 + i)}`
      else dimaksud[c.kode] = `Pasal ${reg[k]} ayat (${i + 2})`
    })
  })

  return { byKode, anak, dimaksud }
}

function kalimatAkun(r, opts) {
  const tmpl = (opts.templateAkun || TEMPLATE_AKUN_DEFAULT)
  const teks = tmpl[r.kode] || tmpl.lain || TEMPLATE_AKUN_DEFAULT.lain
  return teks
    .replace(/\{uraian\}/g, r.uraian)
    .replace(/\{tahun\}/g, opts.tahunAnggaran)
    .replace(/\{nilai\}/g, rupiahTerbilang(r.nilai))
}

const penutupHuruf = (i, total) => (i === total - 1 ? '.' : i === total - 2 ? '; dan' : ';')

/** Bunyi lengkap satu pasal sebagai daftar blok berlevel. */
export function bunyiPasal(kode, ktx, opts) {
  const r = ktx.byKode[kode]
  const ch = ktx.anak[kode] || []
  const dim = ktx.dimaksud[kode]
  const isi = []

  // Akun: kalimat pembuka dari template + daftar huruf, tanpa ayat.
  if (kode.length === 1) {
    isi.push({ level: 0, teks: kalimatAkun(r, opts) })
    ch.forEach((c, i) => isi.push({
      level: 1,
      teks: `${String.fromCharCode(97 + i)}. ${c.uraian}${penutupHuruf(i, ch.length)}`
    }))
    return isi
  }

  if (ch.length === 0) {
    isi.push({
      level: 0,
      teks: `Anggaran ${r.uraian} sebagaimana dimaksud pada ${dim} direncanakan sebesar ` +
        `${rupiahTerbilang(r.nilai)}.`
    })
    return isi
  }

  if (ch.length === 1) {
    isi.push({
      level: 0,
      teks: `Anggaran ${r.uraian} sebagaimana dimaksud pada ${dim} direncanakan sebesar ` +
        `${rupiahTerbilang(r.nilai)}, merupakan ${NAMA_ANAK[kode.length] || 'rincian objek'} ` +
        `${ch[0].uraian}.`
    })
    return isi
  }

  isi.push({
    level: 0,
    teks: `(1) Anggaran ${r.uraian} sebagaimana dimaksud pada ${dim} direncanakan sebesar ` +
      `${rupiahTerbilang(r.nilai)}, terdiri atas:`
  })
  ch.forEach((c, i) => isi.push({
    level: 1,
    teks: `${String.fromCharCode(97 + i)}. ${c.uraian}${penutupHuruf(i, ch.length)}`
  }))
  ch.forEach((c, i) => isi.push({
    level: 0,
    teks: `(${i + 2}) ${c.uraian} sebagaimana dimaksud pada ayat (1) huruf ` +
      `${String.fromCharCode(97 + i)} direncanakan sebesar ${rupiahTerbilang(c.nilai)}.`
  }))
  return isi
}

export function renderSemua(rows, reg, opts) {
  const ktx = konteks(rows, reg)
  const out = {}
  Object.keys(reg).forEach(k => {
    if (!ktx.byKode[k]) return   // kode sudah tidak ada di file ini
    out[k] = bunyiPasal(k, ktx, opts)
  })
  return out
}

const sidik = isi => isi.map(b => b.level + '|' + b.teks).join('\n')

// ---------------------------------------------------------------- satu tahap

/**
 * Proses satu file pergeseran terhadap state sebelumnya.
 * @param {{rows: Array, reg: Object}} sebelum state hasil tahap sebelumnya
 * @param {Array} rows baris file pergeseran (snapshot lengkap)
 * @param {string} nama nama file, untuk pelabelan
 * @param {Object} opts { tahunAnggaran, templateAkun, pasalMulai }
 */
export function prosesTahap(sebelum, rows, nama, opts) {
  const reg = { ...sebelum.reg }
  const peringatan = []

  const nilaiBerlaku = {}
  sebelum.rows.forEach(r => { nilaiBerlaku[r.kode] = r.nilai })

  // Validator: kolom sebelum_perubahan vs nilai yang benar-benar berlaku.
  // Kalau tidak cocok, dicari tahap mana yang nilainya sama dengan yang tertulis.
  // Ketemu -> penyusun memakai baseline tahap itu, bukan hasil tahap terakhir:
  // hanya catatan. Tidak ketemu -> angkanya tidak berasal dari mana pun dalam
  // rantai, dan itu yang benar-benar perlu diperiksa manusia.
  const jejakNilai = opts.riwayatNilai || {}
  rows.forEach(r => {
    if (r.tertulisSebelum === null || r.tertulisSebelum === undefined) return
    const berlaku = nilaiBerlaku[r.kode] !== undefined ? nilaiBerlaku[r.kode] : 0
    if (Math.abs(r.tertulisSebelum - berlaku) <= 0.005) return

    // jejak urut kronologis. Tahap TERTUA yang cocok dipakai sebagai baseline,
    // karena itulah file yang paling mungkin disalin penyusun.
    const jejak = jejakNilai[r.kode] || []
    const cocok = jejak
      .filter(j => Math.abs(j.nilai - r.tertulisSebelum) <= 0.005)
      .map(j => j.label)
    const baseline = cocok.length ? cocok[0] : null
    const jugaSama = cocok.length > 1 ? ` (nilainya sama di ${cocok.slice(1).join(', ')})` : ''

    peringatan.push({
      tipe: baseline ? 'baseline' : 'nilai',
      baseline,
      cocokDi: cocok,
      kode: r.kode,
      uraian: r.uraian,
      tertulis: r.tertulisSebelum,
      berlaku,
      selisih: r.tertulisSebelum - berlaku,
      catatan: baseline
        ? `Kolom sebelum_perubahan berisi ${rupiah(r.tertulisSebelum)}, yaitu nilai pada ` +
          `${baseline}${jugaSama} — bukan nilai yang berlaku (${rupiah(berlaku)}). Penyusun ` +
          `memakai ${baseline} sebagai baseline. Naskah tidak terpengaruh: engine memakai ` +
          `state hasil tahap sebelumnya, bukan kolom ini.`
        : `Kolom sebelum_perubahan berisi ${rupiah(r.tertulisSebelum)}, sedangkan nilai yang ` +
          `berlaku ${rupiah(berlaku)}. Angka ini tidak cocok dengan nilai mana pun sepanjang ` +
          `rantai, jadi kemungkinan salah ketik atau file pergeserannya bukan yang semestinya.`
    })
  })

  // Rekening yang hilang dari file ini. Tidak pernah terjadi di data nyata
  // (kode jadi 0, bukan hilang), jadi diperingatkan dan tidak ditebak.
  const kodeBaru = new Set(rows.map(r => r.kode))
  const dihapus = sebelum.rows
    .filter(r => !kodeBaru.has(r.kode))
    .map(r => ({ kode: r.kode, uraian: r.uraian, pasal: reg[r.kode] || null, nilai: r.nilai }))

  dihapus.forEach(d => peringatan.push({
    tipe: 'hapus',
    kode: d.kode,
    uraian: d.uraian,
    catatan: d.pasal
      ? `Kode ini ada di state sebelumnya (Pasal ${d.pasal}) tetapi tidak ada di file ini. ` +
        `Engine tidak membuat klausul "dihapus" otomatis — putuskan manual.`
      : `Kode ini ada di state sebelumnya tetapi tidak ada di file ini.`
  }))

  if (dihapus.length > 10) {
    peringatan.unshift({
      tipe: 'parsial',
      kode: '-',
      uraian: '-',
      catatan: `${dihapus.length} kode hilang dibanding state sebelumnya. ` +
        `File pergeseran harus berisi SELURUH rekening (snapshot lengkap), bukan hanya baris yang berubah.`
    })
  }

  // Penomoran sisipan. Basis = angka pasal ber-nomor terdekat sebelumnya.
  const terpakai = {}
  Object.values(reg).forEach(v => {
    const p = pecahLabel(v)
    ;(terpakai[p.angka] = terpakai[p.angka] || new Set()).add(p.huruf)
  })

  const sisipan = []
  let sebelumnya = null
  rows.forEach(r => {
    if (!punyaPasal(r.kode)) return
    if (reg[r.kode]) { sebelumnya = reg[r.kode]; return }

    if (!sebelumnya) sebelumnya = String((Number(opts.pasalMulai) || 3) - 1)

    const basis = pecahLabel(sebelumnya).angka
    const set = terpakai[basis] = terpakai[basis] || new Set()
    const huruf = hurufBerikut(set)
    set.add(huruf)
    const label = `${basis}${huruf}`

    // Posisi hierarki menuntut label lebih kecil, tapi huruf itu sudah terbit.
    if (bandingPasal(label, sebelumnya) < 0) {
      peringatan.push({
        tipe: 'urutan',
        kode: r.kode,
        uraian: r.uraian,
        catatan: `Menurut posisi hierarkinya pasal ini seharusnya berada sebelum ` +
          `Pasal ${sebelumnya}, tetapi huruf itu sudah diundangkan dan tidak boleh dipindah. ` +
          `Diberi Pasal ${label} — periksa manual.`
      })
    }

    reg[r.kode] = label
    sisipan.push({ kode: r.kode, uraian: r.uraian, pasal: label, setelah: sebelumnya })
    sebelumnya = label
  })

  // Deteksi perubahan dengan membandingkan TEKS pasal, bukan nominal.
  const lama = renderSemua(sebelum.rows, sebelum.reg, opts)
  const baru = renderSemua(rows, reg, opts)
  const kodeSisipan = new Set(sisipan.map(s => s.kode))

  const diubah = []
  Object.keys(baru).forEach(k => {
    if (kodeSisipan.has(k)) return
    if (!lama[k]) return
    if (sidik(lama[k]) !== sidik(baru[k])) diubah.push(k)
  })

  // Susun klausul, urut nomor pasal.
  const semua = [
    ...diubah.map(k => ({ kode: k, jenis: 'ubah' })),
    ...sisipan.map(s => ({ kode: s.kode, jenis: 'sisip', setelah: s.setelah }))
  ]
  semua.sort((a, b) => bandingPasal(reg[a.kode], reg[b.kode]))

  const urutPasal = Object.values(reg).sort(bandingPasal)
  const klausul = semua.map(s => {
    const label = reg[s.kode]
    let instruksi
    if (s.jenis === 'ubah') {
      instruksi = `Ketentuan Pasal ${label} diubah, sehingga berbunyi sebagai berikut:`
    } else {
      const berikut = urutPasal[urutPasal.indexOf(label) + 1]
      instruksi = `Di antara Pasal ${s.setelah} dan Pasal ${berikut} disisipkan 1 (satu) pasal, ` +
        `yakni Pasal ${label}, sehingga berbunyi sebagai berikut:`
    }
    return { kode: s.kode, pasal: label, jenis: s.jenis, instruksi, isi: baru[s.kode] }
  })

  return { nama, rows, reg, diubah, sisipan, dihapus, klausul, peringatan }
}

export const labelTahap = i => `P${i + 1}`

/**
 * Jalankan seluruh rantai. Registry dasar TIDAK dinomori ulang di sini.
 * Riwayat nilai tiap tahap dirawat sambil jalan lalu diteruskan ke tahap
 * berikutnya, supaya validator bisa menunjuk baseline yang dipakai penyusun.
 */
export function jalankanRantai(dasar, arsip, opts) {
  const riwayatNilai = {}
  const catat = (label, rows) => rows.forEach(r => {
    (riwayatNilai[r.kode] = riwayatNilai[r.kode] || []).push({ label, nilai: r.nilai })
  })

  catat('MURNI', dasar.rows)

  let state = dasar
  return arsip.map((a, i) => {
    const t = prosesTahap(state, a.rows, a.nama, { ...opts, riwayatNilai })
    catat(labelTahap(i), t.rows)
    state = t
    return t
  })
}

/**
 * Matriks nilai per tahap: kode x (MURNI, P1, P2, ...).
 * Urutan baris mengikuti tahap terakhir (urutan hierarki file Excel); kode yang
 * sudah hilang dari tahap terakhir ditaruh di belakang supaya tidak lenyap.
 */
export function matriksNilai(dasar, tahapan) {
  const tahap = [
    { label: 'MURNI', rows: dasar.rows },
    ...tahapan.map((t, i) => ({ label: labelTahap(i), rows: t.rows }))
  ]

  const uraian = {}
  const nilai = {}
  const tertulis = {}
  tahap.forEach(({ label, rows }) => rows.forEach(r => {
    uraian[r.kode] = r.uraian
    ;(nilai[r.kode] = nilai[r.kode] || {})[label] = r.nilai
    if (r.tertulisSebelum !== null && r.tertulisSebelum !== undefined) {
      (tertulis[r.kode] = tertulis[r.kode] || {})[label] = r.tertulisSebelum
    }
  }))

  const urut = []
  const sudah = new Set()
  for (let i = tahap.length - 1; i >= 0; i--) {
    tahap[i].rows.forEach(r => { if (!sudah.has(r.kode)) { sudah.add(r.kode); urut.push(r.kode) } })
  }

  const labels = tahap.map(t => t.label)
  const baris = urut.map(kode => {
    const perTahap = labels.map(l => (nilai[kode] || {})[l])
    // Berubah bila ada nilai yang beda dari nilai terakhir yang diketahui.
    let acuan
    let berubah = false
    const beda = perTahap.map(v => {
      if (v === undefined) return false
      const b = acuan !== undefined && Math.abs(v - acuan) > 0.005
      if (b) berubah = true
      acuan = v
      return b
    })
    return { kode, uraian: uraian[kode], perTahap, beda, berubah, tertulis: tertulis[kode] || {} }
  })

  return { labels, baris }
}

// ---------------------------------------------------------------- naskah

/** Naskah dokumen dasar: seluruh pasal rekening + heading BAB tiap akun. */
export function naskahDasar(rows, reg, opts) {
  const ktx = konteks(rows, reg)
  const blok = []
  let bab = 1   // BAB I Ketentuan Umum ditulis manual, akun pertama jadi BAB II

  Object.keys(reg)
    .filter(k => ktx.byKode[k])
    .sort((a, b) => bandingPasal(reg[a], reg[b]))
    .forEach(k => {
      if (k.length === 1) {
        bab += 1
        blok.push({ jenis: 'bab', teks: `BAB ${angkaRomawi(bab)}` })
        blok.push({ jenis: 'bab', teks: ktx.byKode[k].uraian.toUpperCase() })
      }
      blok.push({ jenis: 'pasal', teks: `Pasal ${reg[k]}` })
      bunyiPasal(k, ktx, opts).forEach(b => blok.push({ jenis: 'isi', level: b.level, teks: b.teks }))
    })

  return blok
}

export function angkaRomawi(n) {
  const peta = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let sisa = n
  let out = ''
  peta.forEach(([v, s]) => { while (sisa >= v) { out += s; sisa -= v } })
  return out
}
