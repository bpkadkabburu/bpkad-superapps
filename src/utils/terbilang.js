// Format nominal untuk naskah peraturan.
// Konversi angka -> kata memakai @develoka/angka-terbilang-js, paket yang sama
// dengan yang dipakai saat menyusun Perbup Nomor 2 Tahun 2026.

import angkaTerbilang from '@develoka/angka-terbilang-js'

/** "sembilan ratus tiga belas milyar ... koma enam delapan". Selalu nilai absolut. */
export function terbilangAngka(angka) {
  const abs = Math.abs(Number(angka) || 0)
  // Dibulatkan ke 2 desimal supaya pembacaan sen sejalan dengan angka yang tercetak.
  const bulat = Math.round(abs * 100) / 100
  return angkaTerbilang(String(bulat))
}

/**
 * "Rp. 1.500.000,00" — nilai negatif jadi "Rp. (1.500.000,00)".
 * Angka disusun manual, bukan lewat style:'currency', karena Intl menyisipkan
 * non-breaking space setelah "Rp" yang ikut terbawa ke naskah Word.
 */
export function rupiah(angka) {
  const n = Number(angka) || 0
  const teks = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Math.abs(n))
  return n < 0 ? `Rp. (${teks})` : `Rp. ${teks}`
}

/** Bentuk lengkap untuk naskah: "Rp. 0,00 (Nol rupiah)". */
export function rupiahTerbilang(angka) {
  const t = terbilangAngka(angka)
  return `${rupiah(angka)} (${t.charAt(0).toUpperCase()}${t.slice(1)} rupiah)`
}
