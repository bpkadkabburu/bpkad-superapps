import ExcelJS from 'exceljs'
import { VERSI_META } from './proyeksiGajiExcel.js'

// Pembaca balik file export "Proyeksi Kebutuhan Gaji dan Tunjangan": mengambil
// kolom kuning "Sim Gaji /Bln" yang sudah diisi manual dari aplikasi SIM Gaji.
//
// Yang dibaca cuma kolom F tiap sheet dinas. Kode SKPD-nya TIDAK ditebak dari
// nama sheet (terpotong 31 karakter) atau dari teks judul (gampang berubah),
// melainkan dari sheet tersembunyi _META yang ditulis saat file dibuat.

// Kode rekening selalu berbentuk angka bertitik. Dipakai memisahkan baris
// rekening dari baris SUBTOTAL/TOTAL dan baris pembatas golongan, tanpa perlu
// mengenali label-labelnya satu per satu.
const POLA_KODE = /^\d+(\.\d+)+$/
// Baris rincian ditulis "        ↳ Tunjangan Istri (isi manual)".
const POLA_RINCIAN = /↳\s*(.+?)\s*\(isi manual\)/

const KOL_KODE = 1
const KOL_NAMA = 2
const KOL_SIM = 6

function teksSel(nilai) {
  if (nilai == null) return ''
  if (typeof nilai === 'object' && nilai.richText) return nilai.richText.map(r => r.text).join('')
  if (typeof nilai === 'object' && nilai.text) return nilai.text
  return String(nilai)
}

// Sel bisa berisi angka biasa atau hasil rumus. ExcelJS menyimpan rumus sebagai
// { formula, result }, dan `result` hanya ada kalau filenya pernah disimpan ulang
// oleh Excel — jadi tidak boleh diandalkan, lihat cara baris induk ditangani.
function angkaSel(nilai) {
  if (nilai == null) return 0
  if (typeof nilai === 'number') return nilai
  if (typeof nilai === 'object' && 'result' in nilai) return Number(nilai.result) || 0
  const angka = Number(String(nilai).replace(/[^\d.-]/g, ''))
  return Number.isFinite(angka) ? angka : 0
}

export class BerkasTidakDikenal extends Error {}

function bacaMeta(wb) {
  const ws = wb.getWorksheet('_META')
  if (!ws) {
    throw new BerkasTidakDikenal(
      'File ini bukan hasil export Proyeksi Gaji (penanda _META tidak ada). ' +
      'Pakai file yang diunduh lewat tombol Export Excel di halaman ini.'
    )
  }

  const versi = Number(ws.getRow(1).getCell(2).value)
  if (versi !== VERSI_META) {
    throw new BerkasTidakDikenal(
      `File ini keluaran format versi ${versi || '?'}, sedangkan yang dikenali versi ${VERSI_META}. ` +
      'Export ulang dulu, isi lagi kolom Sim Gaji-nya, baru diunggah.'
    )
  }

  const peta = new Map()
  ws.eachRow((row, i) => {
    if (i <= 6) return
    const nama = teksSel(row.getCell(1).value)
    const kodeSkpd = teksSel(row.getCell(2).value)
    if (nama && kodeSkpd) peta.set(nama, { kodeSkpd, namaSkpd: teksSel(row.getCell(3).value) })
  })

  return {
    tahun: Number(ws.getRow(2).getCell(2).value) || null,
    prefix: teksSel(ws.getRow(3).getCell(2).value),
    bulan: Number(ws.getRow(4).getCell(2).value) || null,
    peta,
  }
}

/**
 * @param {File} file berkas .xlsx hasil export yang sudah diisi
 * @returns {Promise<{tahun: number, prefix: string, bulan: number,
 *   rows: Array, dinas: number, dinasTerisi: number}>}
 */
export async function bacaSimGajiDariWorkbook(file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())

  const meta = bacaMeta(wb)
  if (!meta.bulan) {
    throw new BerkasTidakDikenal('File ini tidak mencantumkan bulan realisasi — export ulang dulu.')
  }

  const rows = []
  const dinasTerisi = new Set()

  for (const ws of wb.worksheets) {
    const info = meta.peta.get(ws.name)
    if (!info) continue // sheet ringkasan & _META

    // Baris rincian menempel pada baris rekening terakhir yang terlihat, jadi
    // sheet-nya dibaca berurutan dari atas.
    let induk = null
    const simpanInduk = () => {
      if (!induk) return
      // Baris induk ber-rincian isinya rumus SUM; hasilnya belum tentu ter-cache
      // di file, jadi dijumlahkan sendiri dari baris rinciannya. Kalau pemakai
      // justru menimpa rumus itu dengan angka langsung, angka itu yang dipakai.
      const dariRincian = induk.rincian.reduce((a, d) => a + d.nilai, 0)
      const nilai = dariRincian > 0 ? dariRincian : induk.nilaiSel
      if (nilai > 0) {
        rows.push({
          kodeSkpd: info.kodeSkpd, namaSkpd: info.namaSkpd,
          kodeRekening: induk.kodeRekening, namaRekening: induk.namaRekening,
          komponen: '', nilai,
        })
        dinasTerisi.add(info.kodeSkpd)
      }
      for (const d of induk.rincian) {
        if (d.nilai <= 0) continue
        rows.push({
          kodeSkpd: info.kodeSkpd, namaSkpd: info.namaSkpd,
          kodeRekening: induk.kodeRekening, namaRekening: induk.namaRekening,
          komponen: d.komponen, nilai: d.nilai,
        })
      }
      induk = null
    }

    ws.eachRow((row) => {
      const kode = teksSel(row.getCell(KOL_KODE).value).trim()
      const nama = teksSel(row.getCell(KOL_NAMA).value)

      if (POLA_KODE.test(kode)) {
        simpanInduk()
        induk = {
          kodeRekening: kode,
          namaRekening: nama.trim(),
          nilaiSel: angkaSel(row.getCell(KOL_SIM).value),
          rincian: [],
        }
        return
      }

      const cocok = !kode && POLA_RINCIAN.exec(nama)
      if (cocok && induk) {
        induk.rincian.push({
          komponen: cocok[1].trim(),
          nilai: angkaSel(row.getCell(KOL_SIM).value),
        })
        return
      }

      // SUBTOTAL / TOTAL / pembatas golongan — menutup rekening sebelumnya.
      if (kode) simpanInduk()
    })
    simpanInduk()
  }

  return {
    tahun: meta.tahun,
    prefix: meta.prefix,
    bulan: meta.bulan,
    rows,
    dinas: meta.peta.size,
    dinasTerisi: dinasTerisi.size,
  }
}
