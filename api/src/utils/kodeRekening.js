// Kode rekening Permendagri berubah lebar segmennya mulai TA 2026: rincian objek
// 2 → 3 digit, sub rincian objek 4 → 5 digit. Empat segmen pertama tidak berubah.
//
//   2024–2025 : 5.1.01.01.01.0001    pola lebar 1-1-2-2-2-4
//   2026+     : 5.1.01.01.001.00001  pola lebar 1-1-2-2-3-5
//
// Konsekuensinya (sudah diverifikasi ke data: 0 dari 293 kode 2025 cocok persis
// dengan kode 2026, tapi 198 cocok setelah dinormalkan tanpa satu pun nama
// bertabrakan):
//   - Aman  : pengelompokan/awalan yang berhenti di segmen ke-4 (mis. 5.1.01.01),
//             karena itu hanya menyentuh akun/kelompok/jenis/objek.
//   - Bahaya: mencocokkan kode PENUH antar tahun, dan awalan yang menyentuh dua
//             segmen terakhir.
//
// Semua pencocokan kode rekening di API sebaiknya lewat modul ini, supaya kalau
// Kemendagri menambah digit lagi cukup satu tempat yang diubah.

// indeks segmen (0-based) -> lebar yang dikenal, terlebar lebih dulu
const LEBAR = {
  4: [3, 2], // rincian objek
  5: [5, 4], // sub rincian objek
}

export function segmenKode(kode) {
  return String(kode ?? '').trim().split('.')
}

/**
 * Ubah ke bentuk baku, yaitu format terlebar (2026+), supaya kode dari tahun
 * berbeda bisa dibandingkan. Kode yang sudah lebar tidak berubah.
 *   5.1.01.01.01.0001 -> 5.1.01.01.001.00001
 */
export function normalKodeRekening(kode) {
  const s = segmenKode(kode)
  for (const i of [4, 5]) {
    if (s[i] == null) break
    s[i] = s[i].padStart(LEBAR[i][0], '0')
  }
  return s.join('.')
}

/** Tiga segmen pertama (jenis belanja), mis. 5.1.01 — sama di semua format. */
export function jenisRekening(kode) {
  return segmenKode(kode).slice(0, 3).join('.')
}

const NAMA_TINGKAT = ['akun', 'kelompok', 'jenis', 'objek', 'rincian objek', 'sub rincian objek']

/**
 * Segmen sub rincian objek dalam bentuk baku (5 digit), mis. 00001.
 * Di kelompok belanja gaji, segmen inilah yang memisahkan golongan pegawai
 * (…00001 = PNS, …00002 = PPPK) di format lama maupun 2026+.
 */
export function subRincianRekening(kode) {
  return segmenKode(normalKodeRekening(kode))[5] || null
}

/** Tingkat hierarki dihitung dari jumlah segmen, jadi tidak tergantung lebar digit. */
export function tingkatRekening(kode) {
  const n = segmenKode(kode).filter(Boolean).length
  return NAMA_TINGKAT[n - 1] || null
}

/** Bandingkan dua kode lintas format. */
export function samaRekening(a, b) {
  return normalKodeRekening(a) === normalKodeRekening(b)
}

/**
 * Himpunan kode yang tahan format — untuk daftar rekening tertentu yang dipakai
 * di beberapa tahun anggaran sekaligus.
 */
export function himpunanRekening(daftar) {
  const set = new Set(daftar.map(normalKodeRekening))
  return {
    punya: (kode) => set.has(normalKodeRekening(kode)),
    get ukuran() { return set.size },
  }
}

/**
 * Varian awalan untuk klausa LIKE, supaya satu awalan bisa mencocokkan data
 * tahun lama maupun baru.
 *   5.1.01.01           -> ['5.1.01.01']                        (tidak terpengaruh)
 *   5.1.01.01.001       -> ['5.1.01.01.001', '5.1.01.01.01']
 *   5.1.01.01.01.0001   -> ['5.1.01.01.001.00001', '5.1.01.01.01.0001']
 *   5.1.01.01.100       -> ['5.1.01.01.100']  (tak ada padanan 2 digit)
 *
 * Awalan yang segmennya masih diketik separuh (mis. 5.1.01.01.0) dibiarkan apa
 * adanya — melebarkannya akan mengubah arti.
 */
export function variasiAwalan(awalan) {
  const asli = String(awalan ?? '').trim()
  const s = segmenKode(asli)
  const varian = new Set([asli])
  if (s.length < 5) return [...varian]

  // Hanya segmen yang lebarnya dikenal boleh diubah.
  for (const i of [4, 5]) {
    if (s[i] != null && !LEBAR[i].includes(s[i].length)) return [...varian]
  }

  for (const pilihLebar of [0, 1]) {
    const t = [...s]
    let sah = true
    for (const i of [4, 5]) {
      if (t[i] == null) continue
      const target = LEBAR[i][pilihLebar]
      if (t[i].length > target) {
        const dibuang = t[i].slice(0, t[i].length - target)
        // Hanya boleh dipersempit kalau yang dibuang cuma nol di depan.
        if (!/^0+$/.test(dibuang)) { sah = false; break }
        t[i] = t[i].slice(t[i].length - target)
      } else if (t[i].length < target) {
        t[i] = t[i].padStart(target, '0')
      }
    }
    if (sah) varian.add(t.join('.'))
  }
  return [...varian]
}

const escapeLike = (s) => String(s).replace(/[\\%_]/g, m => '\\' + m)

/**
 * Potongan SQL untuk menyaring dengan awalan kode rekening di semua format.
 *
 * Pencocokannya DIPAKU DI BATAS SEGMEN: `kode = awalan` atau `kode LIKE 'awalan.%'`,
 * bukan `LIKE 'awalan%'`. Tanpa pakuan itu, varian format lama akan bocor —
 * awalan 5.1.01.01.01 ikut menyambar 5.1.01.01.010.* dan 5.1.01.01.011.*
 * (iuran jaminan) pada data 2026, sehingga total gaji pokok menggelembung.
 *
 * Efek sampingnya: awalan yang segmen terakhirnya diketik separuh (mis.
 * 5.1.01.01.0) tidak lagi mencocokkan apa pun. Itu disengaja — lebih baik
 * kosong dan kelihatan daripada diam-diam salah jumlah.
 *
 * @returns {{sql: string, params: string[]}} sql sudah dalam tanda kurung
 */
export function klausaAwalanRekening(kolom, awalan) {
  const varian = variasiAwalan(awalan)
  const bagian = []
  const params = []
  for (const v of varian) {
    bagian.push(`(${kolom} = ? OR ${kolom} LIKE ? ESCAPE '\\\\')`)
    params.push(v, `${escapeLike(v)}.%`)
  }
  return { sql: `(${bagian.join(' OR ')})`, params }
}
