// Penyusun naskah: dari hasil engine menjadi daftar blok bergaya.
// Satu daftar blok dipakai dua kali — untuk pratinjau di layar dan untuk .docx —
// supaya yang dilihat di aplikasi sama dengan yang keluar di Word.

import { naskahDasar } from './perbupEngine.js'

// gaya: judul | tengah | instruksi | isi | normal | kanan | kiri-bold | bab
const B = (teks, gaya = 'normal', extra = {}) => ({ teks, gaya, ...extra })

const titel = s => String(s || '').toLowerCase().split(' ')
  .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')

function judulPerubahan(meta) {
  return `PERUBAHAN ATAS PERATURAN BUPATI ${meta.daerah} ` +
    `${String(meta.perbupDasar || '').toUpperCase()} TENTANG PENJABARAN ANGGARAN PENDAPATAN ` +
    `DAN BELANJA DAERAH KABUPATEN ${meta.daerah} TAHUN ANGGARAN ${meta.tahunAnggaran}`
}

function kepalaNaskah(meta, judul) {
  return [
    B(`BUPATI ${meta.daerah}`, 'judul'),
    B(`PROVINSI ${meta.provinsi}`, 'judul'),
    B(`PERATURAN BUPATI ${meta.daerah}`, 'judul'),
    B(`NOMOR ${meta.nomor || '...'} TAHUN ${meta.tahun}`, 'judul'),
    B('TENTANG', 'judul'),
    B(judul, 'judul'),
    B('DENGAN RAHMAT TUHAN YANG MAHA ESA', 'judul'),
    B(`BUPATI ${meta.daerah},`, 'judul')
  ]
}

function daftarKonsideran(label, teks, penanda) {
  const baris = String(teks || '').split('\n').map(s => s.trim()).filter(Boolean)
  return baris.map((b, i) => B(
    `${i === 0 ? label + ' : ' : '     '}${penanda(i)} ${b}`, 'konsideran'
  ))
}

function kakiNaskah(meta) {
  const kab = titel(meta.daerah)
  return [
    B(`Ditetapkan di ${meta.tempatTanggal || '...'}`, 'kanan'),
    B(meta.jabatanPenetap, 'kanan-bold', { after: 720 }),
    B(meta.namaPenetap, 'kanan-bold'),
    B(`Diundangkan di ${meta.tempatTanggal || '...'}`, 'normal'),
    B(meta.jabatanPengundang, 'kiri-bold', { after: 720 }),
    B(meta.namaPengundang, 'kiri-bold'),
    B(`BERITA DAERAH KABUPATEN ${kab.toUpperCase()} TAHUN ${meta.tahun} ` +
      `NOMOR ${meta.nomor || '...'}`, 'normal')
  ]
}

/** Naskah lengkap perbup pergeseran (Pasal I / Pasal II). */
export function naskahPergeseran(tahap, meta, opsi = {}) {
  const kab = titel(meta.daerah)
  const judul = judulPerubahan(meta)
  const blok = []

  if (opsi.lengkap !== false) {
    blok.push(...kepalaNaskah(meta, judul))
    blok.push(...daftarKonsideran('Menimbang', meta.menimbang, i => String.fromCharCode(97 + i) + '.'))
    blok.push(...daftarKonsideran('Mengingat', meta.mengingat, i => (i + 1) + '.'))
    blok.push(B('MEMUTUSKAN:', 'judul'))
    blok.push(B(`Menetapkan : ${judul}.`, 'normal'))
  } else {
    blok.push(B(judul, 'judul'))
  }

  blok.push(B('Pasal I', 'tengah'))
  blok.push(B(
    `Beberapa ketentuan dalam Peraturan Bupati ${kab} ${meta.perbupDasar} tentang Penjabaran ` +
    `Anggaran Pendapatan dan Belanja Daerah Kabupaten ${kab} Tahun Anggaran ` +
    `${meta.tahunAnggaran}, diubah sebagai berikut:`, 'normal'))

  tahap.klausul.forEach((k, i) => {
    const nomor = opsi.nomorKlausul ? `${i + 1}. ` : ''
    blok.push(B(nomor + k.instruksi, 'instruksi'))
    blok.push(B(`Pasal ${k.pasal}`, 'tengah'))
    k.isi.forEach(b => blok.push(B(b.teks, 'isi', { level: b.level })))
  })

  const nomorLampiran = opsi.nomorKlausul ? `${tahap.klausul.length + 1}. ` : ''
  blok.push(B(nomorLampiran + 'Ketentuan Lampiran diubah, sebagaimana tercantum dalam Lampiran ' +
    'Peraturan Bupati ini.', 'instruksi'))

  blok.push(B('Pasal II', 'tengah'))
  blok.push(B('Peraturan Bupati ini mulai berlaku pada tanggal diundangkan.', 'normal'))

  if (opsi.lengkap !== false) {
    blok.push(B('Agar setiap orang mengetahuinya, memerintahkan pengundangan Peraturan Bupati ini ' +
      `dengan penempatannya dalam Berita Daerah Kabupaten ${kab}.`, 'normal', { after: 480 }))
    blok.push(...kakiNaskah(meta))
  }

  return blok
}

/**
 * Naskah pasal rekening dokumen dasar (BAB II dan seterusnya).
 * BAB I Ketentuan Umum, Pasal 1-2, serta pasal penutup (defisit, lampiran, DPA)
 * tetap ditulis manual — engine tidak mengarangnya.
 */
export function naskahDokumenDasar(rows, reg, opts) {
  return naskahDasar(rows, reg, opts).map(b => {
    if (b.jenis === 'bab') return B(b.teks, 'bab')
    if (b.jenis === 'pasal') return B(b.teks, 'tengah')
    return B(b.teks, 'isi', { level: b.level })
  })
}

// ---------------------------------------------------------------- pemetaan gaya

const DOCX = {
  judul: { align: 'center', bold: true },
  bab: { align: 'center', bold: true, after: 60 },
  tengah: { align: 'center', bold: true },
  instruksi: { align: 'justify', italic: true, indent: 360, after: 160 },
  isi: { align: 'justify' },
  konsideran: { align: 'justify', indent: 1080 },
  normal: { align: 'justify' },
  kanan: { align: 'right' },
  'kanan-bold': { align: 'right', bold: true },
  'kiri-bold': { align: 'left', bold: true }
}

/** Blok bergaya -> paragraf untuk docxWriter. */
export function blokKeParagraf(blok) {
  return blok.map(b => {
    const g = DOCX[b.gaya] || DOCX.normal
    const indent = b.gaya === 'isi'
      ? 360 + (b.level || 0) * 360
      : g.indent
    return {
      teks: b.teks,
      bold: !!g.bold,
      italic: !!g.italic,
      align: g.align,
      indent,
      after: b.after !== undefined ? b.after : g.after
    }
  })
}

const PRATINJAU = {
  judul: 'text-align:center;font-weight:700;',
  bab: 'text-align:center;font-weight:700;margin-top:14px;',
  tengah: 'text-align:center;font-weight:700;margin-top:12px;',
  instruksi: 'font-style:italic;margin-left:18px;margin-top:12px;',
  isi: 'text-align:justify;',
  konsideran: 'margin-left:36px;text-align:justify;',
  normal: 'text-align:justify;',
  kanan: 'text-align:right;',
  'kanan-bold': 'text-align:right;font-weight:700;',
  'kiri-bold': 'font-weight:700;'
}

export function gayaPratinjau(b) {
  const dasar = PRATINJAU[b.gaya] || PRATINJAU.normal
  if (b.gaya === 'isi' && b.level) return dasar + `margin-left:${18 + b.level * 18}px;`
  return dasar
}
