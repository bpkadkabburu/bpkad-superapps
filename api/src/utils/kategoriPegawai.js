import { rincianObjekRekening } from './kodeRekening.js'

// Awalan kode rekening Permendagri untuk dua komponen belanja pegawai yang
// sudah ikut tersinkron lewat DPA/SIPD ke anggaran_rekap, persis seperti gaji
// (lihat proyeksiGaji.js / dokumenRealisasi.js) — hanya belum pernah difilter
// terpisah di aplikasi ini.
export const PREFIX_GAJI = '5.1.01.01'
export const PREFIX_TPP = '5.1.01.02'

// Segmen rincian objek (rincianObjekRekening) pada kode TPP memisahkan
// kriteria TPP-nya, mis. 5.1.01.02.001.00001 = Beban Kerja PNS.
export const LABEL_JENIS_TPP = {
  '001': 'Beban Kerja',
  '002': 'Tempat Bertugas',
  '003': 'Kondisi Kerja',
  '004': 'Kelangkaan Profesi',
  '005': 'Pertimbangan Objektif Lainnya',
}

// Kategori TPP dibatasi ke kriteria di atas saja (5.1.01.02.001–005). Rincian
// objek lain di bawah 5.1.01.02 BUKAN TPP — mis. 5.1.01.02.006.00074 Tunjangan
// Khusus Dokter Spesialis — dan tidak ada di rancangan TPP, jadi kalau ikut
// terambil akan selalu tampil tidak sesuai.
export const AWALAN_TPP = Object.keys(LABEL_JENIS_TPP).map(j => `${PREFIX_TPP}.${j}`)

export function labelJenisTpp(kodeRekening) {
  const jenis = rincianObjekRekening(kodeRekening)
  return (jenis && LABEL_JENIS_TPP[jenis]) || null
}

// PPPK Paruh Waktu (kategori baru TA 2027) belum punya awalan kode rekening
// yang pasti diketahui — dikenali lewat nama rekening saja.
export function isPppkParuhWaktu(namaRekening) {
  return /paruh\s*waktu/i.test(String(namaRekening || ''))
}

/**
 * Klasifikasi komponen belanja PPPK Paruh Waktu dari nama rekening:
 * gaji/jasa, BPJS Kesehatan, JKK (kecelakaan kerja), atau JKM (kematian).
 */
export function jenisKomponenPppkPw(namaRekening) {
  const nama = String(namaRekening || '').toLowerCase()
  if (!/paruh\s*waktu/.test(nama)) return null
  // Jangan cocokkan kata "kesehatan" saja: rekening jabatan tenaga kesehatan
  // juga memuatnya ("…jasa PPPK Paruh Waktu pada jabatan tenaga kesehatan",
  // "…Kecelakaan Kerja … Jabatan Tenaga Kesehatan"), sehingga gaji/JKK/JKM
  // nakes ikut terbaca sebagai BPJS. Cek frasa iurannya secara spesifik.
  if (nama.includes('kecelakaan')) return 'jkk'
  if (nama.includes('kematian')) return 'jkm'
  if (/jaminan\s+kesehatan/.test(nama)) return 'bpjs_kesehatan'
  return 'gaji'
}

export const LABEL_KOMPONEN_PPPK_PW = {
  gaji: 'Gaji',
  bpjs_kesehatan: 'BPJS Kesehatan',
  jkk: 'JKK',
  jkm: 'JKM',
}

/** Kode rekening sintetis dipakai sebagai key pembanding untuk PPPK Paruh Waktu. */
export function kodeSintetisPppkPw(komponen) {
  return `pppk_pw:${komponen}`
}
