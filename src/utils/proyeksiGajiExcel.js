import ExcelJS from 'exceljs'

// Pembangun workbook "Proyeksi Kebutuhan Gaji dan Tunjangan".
//
// Struktur file:
//   REKAP          – satu baris per dinas, menarik angka dari baris TOTAL sheet dinas
//   PER BULAN      – realisasi SP2D per bulan per dinas (dasar hitungan bulan-gaji)
//   REKAP REKENING – rekap lintas dinas per kode rekening
//   1..N           – satu sheet per dinas, isinya rekening urut kode
//
// Tidak ada asumsi yang perlu diisi pemakai. Dua angka kunci diturunkan dari data:
//   - Bulan-gaji sudah dibayar = realisasi ÷ nilai satu bulan gaji rutin (median).
//     8 bulan kalender bisa berarti ~10 bulan-gaji karena THR dan gaji ke-13.
//   - Bulan-gaji sisa          = 12 − bulan terakhir yang sudah ada realisasinya.
// Keduanya ditulis sebagai sel biasa di tiap sheet dan seluruh kolom turunan
// memakainya lewat FORMULA, jadi angkanya bisa ditelusuri (dan ditimpa manual
// kalau memang perlu). Kolom "Sim Gaji /Bln" sengaja dibiarkan kosong: begitu
// diisi, kolom Kebutuhan, Selisih, dan Status ikut terhitung ulang.

const NAMA_BULAN = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

const FMT_RP = '#,##0'
const FMT_RP_MERAH = '#,##0;[Red]-#,##0' // kekurangan anggaran langsung terlihat
const FMT_DESIMAL = '0.00'

const ABU = 'FFF2F4F7'
const KUNING = 'FFFFF6D6' // kolom isian manual (Sim Gaji)
const BIRU = 'FFEAF3FF'   // baris total
const HIJAU = 'FFEAF7EC'  // sel angka turunan dari data
const MERAH = 'FFFDE7E9'  // baris/sel yang anggarannya kurang
const MERAH_TEKS = 'FFB42318'

// Nama sheet Excel: maks 31 karakter, tidak boleh memuat : \ / ? * [ ]
// Nomor urut di depan menjamin nama tetap unik walau nama dinas terpotong.
function namaSheet(no, nama) {
  const bersih = String(nama || '')
    .replace(/[\\/?*[\]:']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `${no}. ${bersih}`.slice(0, 31)
}

function garis() {
  const tipis = { style: 'thin', color: { argb: 'FFD0D5DD' } }
  return { top: tipis, left: tipis, bottom: tipis, right: tipis }
}

function styleHeader(row, kolomTerakhir) {
  row.font = { bold: true, size: 10 }
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  row.height = 32
  for (let c = 1; c <= kolomTerakhir; c++) {
    const cell = row.getCell(c)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ABU } }
    cell.border = garis()
  }
}

function styleBarisTotal(row, kolomTerakhir) {
  row.font = { bold: true, size: 10 }
  for (let c = 1; c <= kolomTerakhir; c++) {
    const cell = row.getCell(c)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BIRU } }
    cell.border = garis()
  }
}

// Baris yang anggarannya tidak cukup diberi latar merah. Kolom isian manual
// (Sim Gaji) dilewati supaya penanda "silakan diisi" warna kuningnya tetap ada.
function tandaiKurang(row, kolomTerakhir, { lewati = [], kolomTeks = [] } = {}) {
  for (let c = 1; c <= kolomTerakhir; c++) {
    if (lewati.includes(c)) continue
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MERAH } }
  }
  for (const c of kolomTeks) {
    const cell = row.getCell(c)
    cell.font = { ...(cell.font || {}), bold: true, color: { argb: MERAH_TEKS } }
  }
}

// Latar merah statis di atas mengikuti angka saat file dibuat. Aturan format
// bersyarat ini yang membuat kolom Selisih tetap ikut berubah warna setelah
// kolom Sim Gaji diisi dan Excel menghitung ulang.
function aturanSelisihMerah(ws, kolom, dari, sampai) {
  if (sampai < dari) return
  ws.addConditionalFormatting({
    ref: `${kolom}${dari}:${kolom}${sampai}`,
    rules: [{
      type: 'cellIs',
      operator: 'lessThan',
      formulae: ['0'],
      priority: 1,
      style: {
        font: { bold: true, color: { argb: MERAH_TEKS } },
        fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: MERAH } },
      },
    }],
  })
}

function judul(ws, teks, kolomTerakhir, opsi = {}) {
  const row = ws.addRow([teks])
  ws.mergeCells(row.number, 1, row.number, kolomTerakhir)
  row.getCell(1).font = {
    bold: opsi.bold !== false,
    size: opsi.size || 12,
    color: { argb: opsi.color || 'FF1D2939' },
  }
  row.getCell(1).alignment = { vertical: 'middle' }
  if (opsi.height) row.height = opsi.height
  return row
}

// Baris "label ... : nilai" — label di A:B (digabung), nilai di kolom C.
function barisAngka(ws, label, nilai, keterangan) {
  const row = ws.addRow([label, null, nilai, keterangan || null])
  ws.mergeCells(row.number, 1, row.number, 2)
  row.getCell(1).font = { bold: true, size: 10 }
  const sel = row.getCell(3)
  sel.font = { bold: true, size: 11 }
  sel.numFmt = FMT_DESIMAL
  sel.alignment = { horizontal: 'center' }
  sel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HIJAU } }
  sel.border = garis()
  if (keterangan) row.getCell(4).font = { size: 9, italic: true, color: { argb: 'FF98A2B3' } }
  return row
}

function jumlahRekeningKurang(skpd) {
  return (skpd.rekening || []).filter(r => r.selisih < 0).length
}

function labelSisaBulan(bulanTerakhir) {
  if (!bulanTerakhir || bulanTerakhir >= 12) return 'sisa tahun'
  const dari = NAMA_BULAN[bulanTerakhir + 1]
  return `${dari}–${NAMA_BULAN[12]}`
}

/**
 * @param {object} data payload GET /api/proyeksi-gaji
 * @param {object} opsi { tahun }
 * @returns {Promise<ArrayBuffer>}
 */
export async function buatWorkbookProyeksiGaji(data, opsi) {
  const tahun = opsi.tahun
  const prefix = data.prefix
  const bulanList = data.bulanList || []
  const bulanTerakhir = data.bulanTerakhir
  const bulanSisa = data.bulanSisa || 0
  const rentangSisa = labelSisaBulan(bulanTerakhir)
  const labelRealisasi = bulanTerakhir
    ? `SP2D s.d. ${NAMA_BULAN[bulanTerakhir]} ${tahun}`
    : 'SP2D (belum ada data bulan)'

  const wb = new ExcelJS.Workbook()
  wb.creator = 'BPKAD Superapps'

  // Sheet REKAP dibuat lebih dulu supaya jadi tab pertama, tapi baris datanya
  // ditulis paling akhir — rumusnya menunjuk ke baris TOTAL sheet tiap dinas yang
  // nomornya baru diketahui setelah sheet itu dibangun.
  const wsRekap = wb.addWorksheet('REKAP', { views: [{ state: 'frozen', ySplit: 6 }] })

  const KOLOM_REKAP = [
    { header: 'No', width: 5 },
    { header: 'Nama SKPD', width: 40 },
    { header: 'Anggaran', width: 18 },
    { header: `Realisasi\n(${labelRealisasi})`, width: 18 },
    { header: 'Sisa Anggaran', width: 18 },
    { header: 'Sim Gaji /Bln\n(isi di sheet dinas)', width: 17 },
    { header: 'Rata²/Bln\n(dari Realisasi)', width: 17 },
    { header: `Kebutuhan ${bulanSisa} Bln\n(dari Realisasi)`, width: 18 },
    { header: `Kebutuhan ${bulanSisa} Bln\n(dari Sim Gaji)`, width: 18 },
    { header: 'Selisih\n(Sisa − Kebutuhan)', width: 19 },
    { header: 'Status', width: 11 },
    { header: 'Rekening\nKurang', width: 11 },
    { header: 'Bulan-Gaji\nSudah Dibayar', width: 13 },
  ]
  const REKAP_KOL = KOLOM_REKAP.length

  judul(wsRekap, 'PROYEKSI KEBUTUHAN BELANJA GAJI DAN TUNJANGAN', REKAP_KOL, { size: 14, height: 22 })
  judul(
    wsRekap,
    `TA ${tahun} · Rekening ${prefix}* · Realisasi ${labelRealisasi} · Sumber: SIPD (Anggaran Rekap + Dokumen Realisasi)`,
    REKAP_KOL,
    { bold: false, size: 10, color: 'FF667085' }
  )
  judul(
    wsRekap,
    `Realisasi s.d. sekarang setara ${data.bulanGajiTerbayarTotal} bulan-gaji (bulan rutin + THR + gaji ke-13); ` +
    `sisa yang masih harus dibayar ${bulanSisa} bulan (${rentangSisa}). ` +
    `Kebutuhan tiap dinas dihitung dengan laju bayar dinas itu sendiri, bukan angka rata-rata kabupaten.`,
    REKAP_KOL,
    { bold: false, size: 9, color: 'FF667085' }
  )
  judul(
    wsRekap,
    'Kolom "Sim Gaji /Bln" diisi di sheet tiap dinas (kolom kuning) — kolom Kebutuhan, Selisih, dan Status ikut terhitung ulang otomatis. ' +
    'Baris berlatar MERAH = anggarannya tidak cukup sampai akhir tahun; kolom "Rekening Kurang" menunjukkan berapa rekening yang kurang di dinas itu.',
    REKAP_KOL,
    { bold: false, size: 9, color: 'FF98A2B3' }
  )
  wsRekap.addRow([])

  const headerRekap = wsRekap.addRow(KOLOM_REKAP.map(k => k.header))
  styleHeader(headerRekap, REKAP_KOL)
  KOLOM_REKAP.forEach((k, i) => { wsRekap.getColumn(i + 1).width = k.width })

  // ---- Sheet per dinas ----
  const sheetInfo = [] // { nama, barisTotal }

  data.skpd.forEach((s, idx) => {
    const nama = namaSheet(idx + 1, s.namaSkpd)
    // ySplit 5 = judul(2) + dua sel angka + baris header ikut terkunci.
    const ws = wb.addWorksheet(nama, { views: [{ state: 'frozen', xSplit: 2, ySplit: 5 }] })

    const KOLOM = [
      { header: 'Kode Rek', width: 21 },
      { header: 'Nama Rekening', width: 46 },
      { header: 'Anggaran', width: 18 },
      { header: `Realisasi\n(${labelRealisasi})`, width: 18 },
      { header: 'Sim Gaji /Bln\n(isi manual)', width: 17 },
      { header: 'Sisa Anggaran', width: 18 },
      { header: 'Rata²/Bln\n(dari Realisasi)', width: 17 },
      { header: `Kebutuhan ${bulanSisa} Bln\n(dari Realisasi)`, width: 18 },
      { header: `Kebutuhan ${bulanSisa} Bln\n(dari Sim Gaji)`, width: 18 },
      { header: 'Selisih\n(Sisa − Kebutuhan)', width: 19 },
      { header: 'Status', width: 11 },
    ]
    const KOL = KOLOM.length

    judul(ws, s.namaSkpd, KOL, { size: 12, height: 20 })
    judul(ws, `Kode SKPD ${s.kodeSkpd} · TA ${tahun} · Rekening ${prefix}* · Realisasi ${labelRealisasi}`, KOL,
      { bold: false, size: 10, color: 'FF667085' })

    // Dua sel ini yang dipakai seluruh rumus di sheet ini. Nomor barisnya dipakai
    // langsung untuk menyusun referensi, jadi menambah/mengurangi baris judul di
    // atasnya tidak akan membuat rumus menunjuk sel yang salah.
    const barisTerbayar = barisAngka(ws, 'Bulan-gaji sudah dibayar', s.bulanGajiTerbayar,
      s.pembagiPerkiraan
        ? 'perkiraan: realisasi bulanan belum bisa dihitung, dipakai jumlah bulan kalender'
        : 'dihitung dari realisasi per bulan (lihat sheet PER BULAN)')
    const barisSisa = barisAngka(ws, 'Bulan-gaji sisa', bulanSisa, rentangSisa)

    const header = ws.addRow(KOLOM.map(k => k.header))
    styleHeader(header, KOL)
    KOLOM.forEach((k, i) => { ws.getColumn(i + 1).width = k.width })

    const REF_TERBAYAR = `$C$${barisTerbayar.number}`
    const REF_SISA = `$C$${barisSisa.number}`
    const barisPertama = header.number + 1

    for (const r of s.rekening) {
      const n = ws.rowCount + 1
      const row = ws.addRow([
        r.kodeRekening,
        r.namaRekening,
        r.pagu,
        r.sp2d,
        null, // Sim Gaji — isian manual
        { formula: `C${n}-D${n}` },
        { formula: `IFERROR(D${n}/${REF_TERBAYAR},0)` },
        { formula: `G${n}*${REF_SISA}` },
        { formula: `IF(E${n}="","",E${n}*${REF_SISA})` },
        // Selama Sim Gaji belum diisi, selisih memakai kebutuhan versi realisasi.
        { formula: `F${n}-IF(E${n}="",H${n},I${n})` },
        { formula: `IF(J${n}<0,"KURANG","CUKUP")` },
      ])
      row.font = { size: 10 }
      for (let c = 1; c <= KOL; c++) row.getCell(c).border = garis()
      row.getCell(1).font = { size: 10, name: 'Consolas' }
      row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KUNING } }
      row.getCell(11).alignment = { horizontal: 'center' }
      // Rekening yang anggarannya tidak cukup sampai akhir tahun.
      if (r.selisih < 0) tandaiKurang(row, KOL, { lewati: [5], kolomTeks: [10, 11] })
    }

    const barisTerakhir = ws.rowCount
    const n = barisTerakhir + 1
    const adaData = barisTerakhir >= barisPertama
    const jum = (kol) => adaData ? `SUM(${kol}${barisPertama}:${kol}${barisTerakhir})` : '0'

    const total = ws.addRow([
      'TOTAL', s.namaSkpd,
      { formula: jum('C') },
      { formula: jum('D') },
      { formula: jum('E') },
      { formula: jum('F') },
      { formula: `IFERROR(D${n}/${REF_TERBAYAR},0)` },
      { formula: `G${n}*${REF_SISA}` },
      { formula: `IF(E${n}=0,"",E${n}*${REF_SISA})` },
      { formula: `F${n}-IF(E${n}=0,H${n},I${n})` },
      { formula: `IF(J${n}<0,"KURANG","CUKUP")` },
    ])
    styleBarisTotal(total, KOL)
    total.getCell(11).alignment = { horizontal: 'center' }
    if (s.selisih < 0) tandaiKurang(total, KOL, { kolomTeks: [10, 11] })

    for (const kol of ['C', 'D', 'E', 'G', 'H', 'I']) ws.getColumn(kol).numFmt = FMT_RP
    for (const kol of ['F', 'J']) ws.getColumn(kol).numFmt = FMT_RP_MERAH
    if (adaData) {
      ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: barisTerakhir, column: KOL } }
      aturanSelisihMerah(ws, 'J', barisPertama, total.number)
    }

    sheetInfo.push({ nama, barisTotal: total.number, refTerbayar: REF_TERBAYAR })
  })

  // ---- Isi baris REKAP (menarik dari baris TOTAL tiap sheet dinas) ----
  const rekapBarisPertama = headerRekap.number + 1

  data.skpd.forEach((s, idx) => {
    const info = sheetInfo[idx]
    const ref = `'${info.nama}'!`
    const t = info.barisTotal
    const row = wsRekap.addRow([
      idx + 1,
      s.namaSkpd,
      { formula: `${ref}C${t}` },
      { formula: `${ref}D${t}` },
      { formula: `${ref}F${t}` },
      { formula: `${ref}E${t}` },
      { formula: `${ref}G${t}` },
      { formula: `${ref}H${t}` },
      { formula: `${ref}I${t}` },
      { formula: `${ref}J${t}` },
      { formula: `${ref}K${t}` },
      jumlahRekeningKurang(s) || null,
      { formula: `${ref}${info.refTerbayar}` },
    ])
    row.font = { size: 10 }
    for (let c = 1; c <= REKAP_KOL; c++) row.getCell(c).border = garis()
    row.getCell(1).alignment = { horizontal: 'center' }
    for (const c of [11, 12, 13]) row.getCell(c).alignment = { horizontal: 'center' }
    if (s.selisih < 0) tandaiKurang(row, REKAP_KOL, { kolomTeks: [10, 11] })
    if (jumlahRekeningKurang(s)) {
      row.getCell(12).font = { size: 10, bold: true, color: { argb: MERAH_TEKS } }
    }
  })

  const rekapBarisTerakhir = wsRekap.rowCount
  if (rekapBarisTerakhir >= rekapBarisPertama) {
    const n = rekapBarisTerakhir + 1
    const jum = (kol) => `SUM(${kol}${rekapBarisPertama}:${kol}${rekapBarisTerakhir})`
    const total = wsRekap.addRow([
      null, 'TOTAL SELURUH SKPD',
      { formula: jum('C') },
      { formula: jum('D') },
      { formula: jum('E') },
      { formula: jum('F') },
      { formula: jum('G') },
      { formula: jum('H') },
      { formula: jum('I') },
      { formula: jum('J') },
      { formula: `IF(J${n}<0,"KURANG","CUKUP")` },
      { formula: `SUM(L${rekapBarisPertama}:L${rekapBarisTerakhir})` },
      null,
    ])
    styleBarisTotal(total, REKAP_KOL)
    for (const c of [11, 12]) total.getCell(c).alignment = { horizontal: 'center' }
    wsRekap.autoFilter = {
      from: { row: headerRekap.number, column: 1 },
      to: { row: rekapBarisTerakhir, column: REKAP_KOL },
    }
    aturanSelisihMerah(wsRekap, 'J', rekapBarisPertama, total.number)
  }

  for (const kol of ['C', 'D', 'F', 'G', 'H', 'I']) wsRekap.getColumn(kol).numFmt = FMT_RP
  for (const kol of ['E', 'J']) wsRekap.getColumn(kol).numFmt = FMT_RP_MERAH
  wsRekap.getColumn('M').numFmt = FMT_DESIMAL

  // ---- Sheet PER BULAN: dasar hitungan bulan-gaji ----
  {
    const ws = wb.addWorksheet('PER BULAN', { views: [{ state: 'frozen', xSplit: 2, ySplit: 5 }] })
    const KOL = 2 + bulanList.length + 3

    judul(ws, 'REALISASI SP2D PER BULAN', KOL, { size: 12, height: 20 })
    judul(ws, `TA ${tahun} · Rekening ${prefix}* · dasar perhitungan jumlah bulan-gaji yang sudah dibayar`, KOL,
      { bold: false, size: 10, color: 'FF667085' })
    judul(ws,
      '"Median Bulan Rutin" = nilai satu bulan gaji normal, diambil median supaya tidak tertarik naik oleh bulan ber-THR / gaji ke-13. ' +
      '"Bulan-Gaji Sudah Dibayar" = Total ÷ Median — inilah pembagi yang dipakai di sheet tiap dinas.',
      KOL, { bold: false, size: 9, color: 'FF98A2B3' })
    ws.addRow([])

    const header = ws.addRow([
      'No', 'Nama SKPD',
      ...bulanList.map(b => NAMA_BULAN[b]),
      'Total', 'Median Bulan Rutin', 'Bulan-Gaji Sudah Dibayar',
    ])
    styleHeader(header, KOL)
    ws.getColumn(1).width = 5
    ws.getColumn(2).width = 40
    for (let i = 0; i < bulanList.length; i++) ws.getColumn(3 + i).width = 16
    ws.getColumn(2 + bulanList.length + 1).width = 18
    ws.getColumn(2 + bulanList.length + 2).width = 18
    ws.getColumn(2 + bulanList.length + 3).width = 15

    const barisPertama = header.number + 1
    data.skpd.forEach((s, idx) => {
      const row = ws.addRow([
        idx + 1, s.namaSkpd,
        ...bulanList.map(b => s.perBulan?.[b] || 0),
        s.sp2d,
        s.medianBulan || 0,
        s.bulanGajiTerbayar,
      ])
      row.font = { size: 10 }
      for (let c = 1; c <= KOL; c++) row.getCell(c).border = garis()
      row.getCell(1).alignment = { horizontal: 'center' }
      row.getCell(KOL).alignment = { horizontal: 'center' }
    })

    const barisTerakhir = ws.rowCount
    if (barisTerakhir >= barisPertama) {
      const total = ws.addRow([null, 'TOTAL SELURUH SKPD'])
      for (let c = 3; c <= 2 + bulanList.length + 1; c++) {
        const kol = ws.getColumn(c).letter
        total.getCell(c).value = { formula: `SUM(${kol}${barisPertama}:${kol}${barisTerakhir})` }
      }
      total.getCell(2 + bulanList.length + 2).value = data.medianTotal || 0
      total.getCell(KOL).value = data.bulanGajiTerbayarTotal
      styleBarisTotal(total, KOL)
      total.getCell(KOL).alignment = { horizontal: 'center' }
    }

    for (let c = 3; c <= 2 + bulanList.length + 2; c++) ws.getColumn(c).numFmt = FMT_RP
    ws.getColumn(KOL).numFmt = FMT_DESIMAL
  }

  // ---- Sheet REKAP REKENING: lintas dinas, per komponen gaji ----
  {
    const ws = wb.addWorksheet('REKAP REKENING', { views: [{ state: 'frozen', xSplit: 2, ySplit: 5 }] })
    const KOLOM = [
      { header: 'Kode Rek', width: 21 },
      { header: 'Nama Rekening', width: 46 },
      { header: 'Anggaran', width: 18 },
      { header: `Realisasi\n(${labelRealisasi})`, width: 18 },
      { header: 'Sisa Anggaran', width: 18 },
      { header: 'Rata²/Bln\n(dari Realisasi)', width: 17 },
      { header: `Kebutuhan ${bulanSisa} Bln`, width: 18 },
      { header: 'Selisih\n(Sisa − Kebutuhan)', width: 19 },
      { header: 'Status', width: 11 },
      { header: 'Dinas\nKurang', width: 9 },
      { header: 'Total Kekurangan\ndi Dinas Tsb.', width: 19 },
    ]
    const KOL = KOLOM.length

    judul(ws, 'REKAP PER KODE REKENING (SELURUH SKPD)', KOL, { size: 12, height: 20 })
    judul(ws, `TA ${tahun} · Rekening ${prefix}* · Realisasi ${labelRealisasi} · untuk melihat komponen gaji mana yang paling rawan kurang`, KOL,
      { bold: false, size: 10, color: 'FF667085' })
    judul(ws,
      'Kolom Selisih di sini memakai total kabupaten, sehingga dinas yang lebih bisa menutupi dinas yang kurang. ' +
      'Dua kolom terakhir menghitung kekurangan per dinas tanpa saling menutup — itulah yang menandai rekening rawan.',
      KOL, { bold: false, size: 9, color: 'FF98A2B3' })
    const barisTerbayar = barisAngka(ws, 'Bulan-gaji sudah dibayar', data.bulanGajiTerbayarTotal, 'tingkat kabupaten (seluruh SKPD)')
    const barisSisa = barisAngka(ws, 'Bulan-gaji sisa', bulanSisa, rentangSisa)
    const REF_TERBAYAR = `$C$${barisTerbayar.number}`
    const REF_SISA = `$C$${barisSisa.number}`

    const header = ws.addRow(KOLOM.map(k => k.header))
    styleHeader(header, KOL)
    KOLOM.forEach((k, i) => { ws.getColumn(i + 1).width = k.width })

    const barisPertama = header.number + 1
    for (const r of data.rekening || []) {
      const n = ws.rowCount + 1
      const row = ws.addRow([
        r.kodeRekening, r.namaRekening, r.pagu, r.sp2d,
        { formula: `C${n}-D${n}` },
        { formula: `IFERROR(D${n}/${REF_TERBAYAR},0)` },
        { formula: `F${n}*${REF_SISA}` },
        { formula: `E${n}-G${n}` },
        { formula: `IF(H${n}<0,"KURANG","CUKUP")` },
        r.dinasKurang || null,
        r.dinasKurang ? r.kekurangan : null,
      ])
      row.font = { size: 10 }
      for (let c = 1; c <= KOL; c++) row.getCell(c).border = garis()
      row.getCell(1).font = { size: 10, name: 'Consolas' }
      row.getCell(9).alignment = { horizontal: 'center' }
      row.getCell(10).alignment = { horizontal: 'center' }
      // Rekening ditandai kalau ada dinas yang kurang, walau total kabupatennya cukup.
      if (r.selisih < 0 || r.dinasKurang) tandaiKurang(row, KOL, { kolomTeks: [10, 11] })
    }

    const barisTerakhir = ws.rowCount
    if (barisTerakhir >= barisPertama) {
      const n = barisTerakhir + 1
      const jum = (kol) => `SUM(${kol}${barisPertama}:${kol}${barisTerakhir})`
      const total = ws.addRow([
        'TOTAL', null,
        { formula: jum('C') },
        { formula: jum('D') },
        { formula: jum('E') },
        { formula: `IFERROR(D${n}/${REF_TERBAYAR},0)` },
        { formula: `F${n}*${REF_SISA}` },
        { formula: `E${n}-G${n}` },
        { formula: `IF(H${n}<0,"KURANG","CUKUP")` },
        null,
        { formula: jum('K') },
      ])
      styleBarisTotal(total, KOL)
      total.getCell(9).alignment = { horizontal: 'center' }
      aturanSelisihMerah(ws, 'H', barisPertama, total.number)
      aturanSelisihMerah(ws, 'K', barisPertama, total.number)
    }

    for (const kol of ['C', 'D', 'F', 'G']) ws.getColumn(kol).numFmt = FMT_RP
    for (const kol of ['E', 'H', 'K']) ws.getColumn(kol).numFmt = FMT_RP_MERAH
  }

  return wb.xlsx.writeBuffer()
}

export function namaFileProyeksiGaji(tahun, prefix, bulanTerakhir) {
  const bln = bulanTerakhir ? `-sd-${String(bulanTerakhir).padStart(2, '0')}` : ''
  return `proyeksi-gaji-tunjangan-${prefix}-${tahun}${bln}.xlsx`
}
