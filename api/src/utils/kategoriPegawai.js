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
  if (nama.includes('kesehatan')) return 'bpjs_kesehatan'
  if (nama.includes('kecelakaan')) return 'jkk'
  if (nama.includes('kematian')) return 'jkm'
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
