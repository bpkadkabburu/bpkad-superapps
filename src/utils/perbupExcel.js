// Pembacaan Lampiran I APBD dari worksheet ExcelJS.
// Dipakai bersama oleh komponen (browser) dan skrip pengujian (Node),
// jadi fungsinya hanya menerima worksheet, bukan file.

import { ucwords, isSubRincian } from './perbupEngine.js'

const teksSel = nilai => {
  if (nilai === null || nilai === undefined) return ''
  if (typeof nilai === 'object') {
    if (nilai.text !== undefined) return String(nilai.text)
    if (nilai.result !== undefined) return String(nilai.result)
    if (nilai.richText) return nilai.richText.map(t => t.text).join('')
    return ''
  }
  return String(nilai)
}

const angkaSel = nilai => {
  if (nilai === null || nilai === undefined || nilai === '') return null

  // Sel numerik dipakai apa adanya. Jangan diubah jadi teks lalu diurai ulang:
  // 206682681016.68 akan kehilangan titik desimalnya dan jadi 100x lebih besar.
  if (typeof nilai === 'number') return nilai
  if (typeof nilai === 'object') {
    if (typeof nilai.result === 'number') return nilai.result
    if (nilai.result !== undefined) return angkaSel(nilai.result)
    return null
  }

  let s = String(nilai).trim().replace(/\s/g, '')
  if (!s) return null
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.')   // 206.682.681.016,68
  } else if (s.includes(',') && !s.includes('.')) {
    s = s.replace(',', '.')                      // 1016,68
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * @returns {{rows: Array, kolomNilai: string, barisHeader: number}}
 * rows: [{ kode, uraian, nilai, tertulisSebelum }]
 * Sub rincian objek (panjang 17/19) dibuang di sini.
 */
export function bacaLampiran(ws) {
  // Cari baris header: baris pertama yang punya sel "kode".
  let barisHeader = 0
  const kolom = {}
  const batas = Math.min(ws.rowCount, 15)
  for (let r = 1; r <= batas; r++) {
    const peta = {}
    ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
      const key = teksSel(cell.value).trim().toLowerCase()
      if (key) peta[key] = col
    })
    if (peta['kode']) {
      barisHeader = r
      Object.assign(kolom, peta)
      break
    }
  }
  if (!barisHeader) throw new Error('Kolom "kode" tidak ditemukan pada 15 baris pertama.')
  if (!kolom['uraian']) throw new Error('Kolom "uraian" tidak ditemukan.')

  // Kolom nilai: `jumlah` (dokumen dasar) atau `setelah_perubahan` (pergeseran).
  const kolomNilai = kolom['jumlah'] ? 'jumlah'
    : kolom['setelah_perubahan'] ? 'setelah_perubahan'
      : null
  if (!kolomNilai) {
    throw new Error('Kolom nilai tidak ditemukan. Harus ada "jumlah" atau "setelah_perubahan".')
  }

  const rows = []
  ws.eachRow((row, nomor) => {
    if (nomor <= barisHeader) return
    const kode = teksSel(row.getCell(kolom['kode']).value).trim()
    if (!kode) return
    if (isSubRincian(kode)) return

    const nilai = angkaSel(row.getCell(kolom[kolomNilai]).value)
    const sebelum = kolom['sebelum_perubahan']
      ? angkaSel(row.getCell(kolom['sebelum_perubahan']).value)
      : null

    rows.push({
      kode,
      uraian: ucwords(teksSel(row.getCell(kolom['uraian']).value).trim()),
      nilai: nilai === null ? 0 : nilai,
      tertulisSebelum: sebelum
    })
  })

  return { rows, kolomNilai, barisHeader }
}
