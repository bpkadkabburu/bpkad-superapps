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
// Pergeseran selalu bertanda: merah = pagunya perlu ditambah, biru = pagunya ditarik.
const FMT_PERGESERAN = '[Red]+#,##0;[Blue]-#,##0;"\u2014"'

const ABU = 'FFF2F4F7'
const KUNING = 'FFFFF6D6' // kolom isian manual (Sim Gaji)
const BIRU = 'FFEAF3FF'   // baris total
const HIJAU = 'FFEAF7EC'  // sel angka turunan dari data
const MERAH = 'FFFDE7E9'  // baris/sel yang anggarannya kurang
const MERAH_TEKS = 'FFB42318'
const AMBER = 'FFFDF3E3'      // baris yang pagunya perlu ditambah (Proyeksi Akhir)
const AMBER_TEKS = 'FFB54708'
const KUNCI = 'FFF4F5F7'      // dinas yang pagunya dikunci apa adanya

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

// Di sheet Proyeksi Akhir yang ditandai bukan "kurang" melainkan arah pergeseran:
// dinas yang pagunya perlu ditambah (kuning) dan dinas yang pagunya dikunci (abu).
function tandaiTambah(row, kolomTerakhir, { lewati = [], kolomTeks = [] } = {}) {
  for (let c = 1; c <= kolomTerakhir; c++) {
    // Kolom isian manual dilewati supaya penanda kuningnya tidak tertimpa.
    if (lewati.includes(c)) continue
    row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } }
  }
  for (const c of kolomTeks) {
    const cell = row.getCell(c)
    cell.font = { ...(cell.font || {}), bold: true, color: { argb: AMBER_TEKS } }
  }
}

function tandaiKunci(row, kolomTerakhir) {
  for (let c = 1; c <= kolomTerakhir; c++) {
    const cell = row.getCell(c)
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KUNCI } }
    cell.font = { ...(cell.font || {}), italic: true, color: { argb: 'FF98A2B3' } }
  }
}

function angkaPersen(v) {
  return Number(v || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
}

const rupiah = (v) => 'Rp' + Math.round(Number(v) || 0).toLocaleString('id-ID')

// Satu kalimat di kepala sheet yang menjelaskan apa yang terjadi pada pagu:
// cukup, dipangkas bersama, atau memang kurang dan perlu tambahan anggaran.
function ceritaAkhir(akhir) {
  if (!akhir.cukup) {
    return `Pagu gaji sekabupaten KURANG ${rupiah(akhir.defisitRiil)} dari kebutuhan riil sampai Desember. ` +
      'Cadangan sudah dinolkan dan seluruh pagu berlebih sudah ditarik, tapi kekurangan ini tetap tidak bisa disebar ' +
      'tanpa membuat ada dinas kehabisan gaji — perlu tambahan anggaran atau pergeseran dari belanja lain.'
  }
  if (akhir.faktorPotong > 0) {
    return `Usulan kebutuhan + ${angkaPersen(akhir.persenCadangan)} berjumlah ${rupiah(akhir.totalIdeal)}, ` +
      `melebihi pagu tersedia ${rupiah(akhir.kantong)} sebesar ${rupiah(akhir.kelebihan)}. Kekurangan itu disebar ke ` +
      `seluruh dinas dengan memangkas cadangan menjadi ${angkaPersen(akhir.persenAkhir)}: ${rupiah(akhir.pergeseranMasuk)} ` +
      `ditambahkan ke ${akhir.jumlahTambah} dinas, diambil dari ${akhir.jumlahKurangi} dinas yang pagunya berlebih. ` +
      'Tidak ada dinas yang alokasinya jatuh di bawah kebutuhan gajinya sampai Desember.'
  }
  return `Pagu mencukupi — seluruh dinas dapat kebutuhan penuh + ${angkaPersen(akhir.persenCadangan)} cadangan, ` +
    `masih tersisa ${rupiah(akhir.sisaKantong)}.`
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
      { header: 'Dibayar\n(kali)', width: 10 },
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
    // Angka ini hanya ringkasan tingkat dinas. Pembagi yang benar-benar dipakai
    // tiap baris ada di kolom "Dibayar (kali)": gaji pokok ikut terbayar di bulan
    // THR dan gaji ke-13 (≈10 kali), sedangkan iuran BPJS hanya sekali sebulan
    // (8 kali). Kalau semuanya dibagi angka yang sama, iuran jadi kurang ±23%.
    const barisTerbayar = barisAngka(ws, 'Bulan-gaji sudah dibayar (rata dinas)', s.bulanGajiTerbayar,
      s.pembagiPerkiraan
        ? 'perkiraan: realisasi bulanan belum bisa dihitung, dipakai jumlah bulan kalender'
        : 'ringkasan; pembagi tiap rekening ada di kolom "Dibayar (kali)"')
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
        r.dibayar,
        null, // Sim Gaji — isian manual
        { formula: `C${n}-D${n}` },
        { formula: `IFERROR(D${n}/E${n},0)` },
        { formula: `H${n}*${REF_SISA}` },
        { formula: `IF(F${n}="","",F${n}*${REF_SISA})` },
        // Selama Sim Gaji belum diisi, selisih memakai kebutuhan versi realisasi.
        { formula: `G${n}-IF(F${n}="",I${n},J${n})` },
        { formula: `IF(K${n}<0,"KURANG","CUKUP")` },
      ])
      row.font = { size: 10 }
      for (let c = 1; c <= KOL; c++) row.getCell(c).border = garis()
      row.getCell(1).font = { size: 10, name: 'Consolas' }
      row.getCell(5).alignment = { horizontal: 'center' }
      if (r.dibayarPerkiraan) {
        row.getCell(5).font = { size: 10, italic: true, color: { argb: 'FF98A2B3' } }
        row.getCell(5).note = 'Rekening ini belum punya realisasi bulanan sendiri — dipakai laju bayar dinas.'
      }
      row.getCell(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KUNING } }
      row.getCell(12).alignment = { horizontal: 'center' }
      // Rekening yang anggarannya tidak cukup sampai akhir tahun.
      if (r.selisih < 0) tandaiKurang(row, KOL, { lewati: [6], kolomTeks: [11, 12] })
    }

    const barisTerakhir = ws.rowCount
    const n = barisTerakhir + 1
    const adaData = barisTerakhir >= barisPertama
    const jum = (kol) => adaData ? `SUM(${kol}${barisPertama}:${kol}${barisTerakhir})` : '0'

    const total = ws.addRow([
      'TOTAL', s.namaSkpd,
      { formula: jum('C') },
      { formula: jum('D') },
      // Kolom "Dibayar" tidak dijumlahkan — tiap rekening punya lajunya sendiri.
      // Yang dijumlahkan Rata²/Bln-nya, sehingga Kebutuhan total = Σ per rekening.
      null,
      { formula: jum('F') },
      { formula: jum('G') },
      { formula: jum('H') },
      { formula: jum('I') },
      { formula: `IF(F${n}=0,"",F${n}*${REF_SISA})` },
      { formula: `G${n}-IF(F${n}=0,I${n},J${n})` },
      { formula: `IF(K${n}<0,"KURANG","CUKUP")` },
    ])
    styleBarisTotal(total, KOL)
    total.getCell(12).alignment = { horizontal: 'center' }
    if (s.selisih < 0) tandaiKurang(total, KOL, { kolomTeks: [11, 12] })

    for (const kol of ['C', 'D', 'F', 'H', 'I', 'J']) ws.getColumn(kol).numFmt = FMT_RP
    for (const kol of ['G', 'K']) ws.getColumn(kol).numFmt = FMT_RP_MERAH
    ws.getColumn('E').numFmt = FMT_DESIMAL
    if (adaData) {
      ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: barisTerakhir, column: KOL } }
      aturanSelisihMerah(ws, 'K', barisPertama, total.number)
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
      { formula: `${ref}G${t}` },
      { formula: `${ref}F${t}` },
      { formula: `${ref}H${t}` },
      { formula: `${ref}I${t}` },
      { formula: `${ref}J${t}` },
      { formula: `${ref}K${t}` },
      { formula: `${ref}L${t}` },
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
      { header: 'Dibayar\n(kali)', width: 10 },
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
    judul(ws,
      'Perhatikan kolom "Dibayar (kali)": gaji pokok dan tunjangan ikut terbayar di bulan THR dan gaji ke-13 sehingga ' +
      `angkanya ±${Math.round(data.bulanGajiTerbayarTotal)}, sedangkan iuran BPJS/JKK/JKM hanya sekali sebulan sehingga persis ${bulanTerakhir || '—'}. ` +
      'Karena itu tiap rekening memakai pembagi sendiri, bukan satu angka untuk semua.',
      KOL, { bold: false, size: 9, color: 'FF98A2B3' })
    const barisTerbayar = barisAngka(ws, 'Bulan-gaji sudah dibayar (rata kabupaten)', data.bulanGajiTerbayarTotal,
      'ringkasan; pembagi tiap rekening ada di kolom "Dibayar (kali)"')
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
        r.kodeRekening, r.namaRekening, r.pagu, r.sp2d, r.dibayar,
        { formula: `C${n}-D${n}` },
        { formula: `IFERROR(D${n}/E${n},0)` },
        { formula: `G${n}*${REF_SISA}` },
        { formula: `F${n}-H${n}` },
        { formula: `IF(I${n}<0,"KURANG","CUKUP")` },
        r.dinasKurang || null,
        r.dinasKurang ? r.kekurangan : null,
      ])
      row.font = { size: 10 }
      for (let c = 1; c <= KOL; c++) row.getCell(c).border = garis()
      row.getCell(1).font = { size: 10, name: 'Consolas' }
      row.getCell(5).alignment = { horizontal: 'center' }
      row.getCell(10).alignment = { horizontal: 'center' }
      row.getCell(11).alignment = { horizontal: 'center' }
      // Rekening ditandai kalau ada dinas yang kurang, walau total kabupatennya cukup.
      if (r.selisih < 0 || r.dinasKurang) tandaiKurang(row, KOL, { kolomTeks: [11, 12] })
    }

    const barisTerakhir = ws.rowCount
    if (barisTerakhir >= barisPertama) {
      const n = barisTerakhir + 1
      const jum = (kol) => `SUM(${kol}${barisPertama}:${kol}${barisTerakhir})`
      const total = ws.addRow([
        'TOTAL', null,
        { formula: jum('C') },
        { formula: jum('D') },
        null, // laju bayar tiap rekening berbeda — tidak ada artinya dijumlahkan
        { formula: jum('F') },
        { formula: jum('G') },
        { formula: jum('H') },
        { formula: `F${n}-H${n}` },
        { formula: `IF(I${n}<0,"KURANG","CUKUP")` },
        null,
        { formula: jum('L') },
      ])
      styleBarisTotal(total, KOL)
      total.getCell(10).alignment = { horizontal: 'center' }
      aturanSelisihMerah(ws, 'I', barisPertama, total.number)
      aturanSelisihMerah(ws, 'L', barisPertama, total.number)
    }

    for (const kol of ['C', 'D', 'G', 'H']) ws.getColumn(kol).numFmt = FMT_RP
    for (const kol of ['F', 'I', 'L']) ws.getColumn(kol).numFmt = FMT_RP_MERAH
    ws.getColumn('E').numFmt = FMT_DESIMAL
  }

  // ---- Sheet PROYEKSI AKHIR: usulan alokasi per dinas ----
  //
  // Susunan kolomnya sengaja mengikuti urutan hitungan supaya bisa ditelusuri
  // dari kiri ke kanan: Pagu → Realisasi → Rata² → Kebutuhan → Acress → Usulan →
  // Pergeseran. Kolom Acress (%) berlatar KUNING = boleh diubah; begitu diubah,
  // Acress (Rp), Usulan, dan Pergeseran ikut terhitung ulang sendiri.
  const akhir = data.akhir
  const labelBasis = data.basis === 'tertinggi' ? 'Tertinggi Sekali Bayar' : 'Rata² Tiap Bayar'
  if (akhir) {
    const ws = wb.addWorksheet('PROYEKSI AKHIR', { views: [{ state: 'frozen', xSplit: 2, ySplit: 9 }] })
    const KOLOM = [
      { header: 'No', width: 5 },
      { header: 'Nama SKPD', width: 38 },
      { header: 'Pagu Sekarang', width: 18 },
      { header: `Realisasi\n(${labelRealisasi})`, width: 18 },
      { header: 'Dibayar\n(kali)', width: 9 },
      { header: `${labelBasis}\n(Σ per rekening)`, width: 18 },
      { header: `Kebutuhan ${bulanSisa} Bln\n(${rentangSisa})`, width: 18 },
      { header: 'Kebutuhan s.d. Des\n(Realisasi + Sisa Bln)', width: 19 },
      { header: 'Acress\n(%, boleh diubah)', width: 13 },
      { header: 'Acress\n(Rp)', width: 17 },
      { header: 'Usulan\n(Kebutuhan + Acress)', width: 19 },
      { header: 'Pergeseran\n(Usulan − Pagu)', width: 19 },
      { header: 'Status', width: 11 },
    ]
    const KOL = KOLOM.length

    judul(ws, 'PROYEKSI AKHIR — USULAN ALOKASI ANGGARAN GAJI SAMPAI TUTUP TAHUN', KOL, { size: 14, height: 22 })
    judul(ws, `TA ${tahun} · Rekening ${prefix}* · Realisasi ${labelRealisasi} · dasar proyeksi: ${labelBasis}`, KOL,
      { bold: false, size: 10, color: 'FF667085' })
    judul(ws,
      'Pagu gaji sekabupaten diperlakukan sebagai satu kantong. Tiap REKENING tiap dinas dijatah kebutuhan riilnya ' +
      `sampai Desember (realisasi + ${labelBasis.toLowerCase()} × ${bulanSisa} bulan), lalu ditambah acress. Kalau ` +
      'jumlahnya melebihi isi kantong, kekurangannya disebar ke SEMUA dinas dengan memangkas acress secara ' +
      'proporsional — kebutuhan gajinya sendiri tidak pernah dipotong, jadi tidak ada dinas yang kehabisan gaji.',
      KOL, { bold: false, size: 9, color: 'FF667085' })
    judul(ws,
      'Kolom "Dibayar (kali)" adalah pembagi milik tiap rekening, dijumlahkan ke tingkat dinas di sini: gaji pokok ' +
      `ikut terbayar di bulan THR dan gaji ke-13 (±${Math.round(data.bulanGajiTerbayarTotal)} kali), sedangkan iuran ` +
      `BPJS/JKK/JKM hanya sekali sebulan (${bulanTerakhir || '—'} kali). Rinciannya ada di sheet AKHIR REKENING.`,
      KOL, { bold: false, size: 9, color: 'FF98A2B3' })
    judul(ws, ceritaAkhir(akhir), KOL, {
      bold: true, size: 10, height: 18,
      color: akhir.cukup ? (akhir.faktorPotong > 0 ? 'FFB54708' : 'FF067647') : MERAH_TEKS,
    })

    const barisKantong = barisAngka(ws, 'Pagu tersedia (kantong bersama)', akhir.kantong,
      akhir.jumlahTerkunci
        ? `${akhir.jumlahTerkunci} dinas tanpa dasar hitung dikunci, pagunya ${rupiah(akhir.paguTerkunci)}`
        : 'seluruh dinas ikut dihitung ulang')
    barisKantong.getCell(3).numFmt = FMT_RP
    barisAngka(ws, 'Acress yang benar-benar terpakai', akhir.persenAkhir,
      akhir.faktorPotong > 0
        ? `persen — dipangkas dari ${angkaPersen(akhir.persenCadangan)} untuk menutup kekurangan ${rupiah(akhir.kelebihan)}`
        : 'persen — tidak perlu dipangkas, pagu mencukupi')

    const header = ws.addRow(KOLOM.map(k => k.header))
    styleHeader(header, KOL)
    KOLOM.forEach((k, i) => { ws.getColumn(i + 1).width = k.width })

    const barisPertama = header.number + 1
    akhir.skpd.forEach((s, i) => {
      const n = ws.rowCount + 1
      const row = ws.addRow([
        i + 1, s.namaSkpd, s.pagu, s.sp2d,
        s.rataRata > 0 ? Math.round((s.sp2d / s.rataRata) * 100) / 100 : null,
        s.perBulanRutin,
        { formula: `F${n}*${bulanSisa}` },
        { formula: `D${n}+G${n}` },
        s.terkunci ? null : akhir.persenAkhir / 100,
        { formula: `IF(I${n}="",0,H${n}*I${n})` },
        s.terkunci ? s.pagu : { formula: `H${n}+J${n}` },
        { formula: `K${n}-C${n}` },
        { formula: s.terkunci ? '"DIKUNCI"' : `IF(L${n}>0,"TAMBAH",IF(L${n}<0,"KURANGI","TETAP"))` },
      ])
      row.font = { size: 10 }
      for (let c = 1; c <= KOL; c++) row.getCell(c).border = garis()
      for (const c of [1, 5, 9, 13]) row.getCell(c).alignment = { horizontal: 'center' }
      // Kolom acress boleh diubah pemakai — ditandai kuning seperti kolom isian
      // lain di berkas ini.
      if (!s.terkunci) row.getCell(9).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KUNING } }
      if (s.tren > 1.01) {
        const sel = row.getCell(6)
        sel.font = { ...(sel.font || {}), italic: true, color: { argb: AMBER_TEKS } }
        sel.note = `Tiga kali bayar terakhir rata-rata ${s.tren}× dari rata-rata tahun berjalan — gajinya sedang naik. ` +
          `Tertinggi sekali bayar ${rupiah(s.tertinggi)} vs rata² ${rupiah(s.rataRata)}.`
      }
      if (s.pergeseran > 0) tandaiTambah(row, KOL, { lewati: [9], kolomTeks: [12] })
      else if (s.terkunci) tandaiKunci(row, KOL)
    })

    const barisTerakhir = ws.rowCount
    if (barisTerakhir >= barisPertama) {
      const n = barisTerakhir + 1
      const jum = (kol) => `SUM(${kol}${barisPertama}:${kol}${barisTerakhir})`
      const total = ws.addRow([
        'TOTAL', null,
        { formula: jum('C') }, { formula: jum('D') },
        null, // laju bayar tiap rekening berbeda — tidak ada artinya dijumlahkan
        { formula: jum('F') }, { formula: jum('G') }, { formula: jum('H') },
        null, // acress tiap baris bisa berbeda kalau diubah manual
        { formula: jum('J') }, { formula: jum('K') }, { formula: jum('L') }, null,
      ])
      styleBarisTotal(total, KOL)
      const catatan = ws.addRow([
        null,
        akhir.cukup
          ? 'Σ Pergeseran harus 0 (yang ditambah = yang ditarik) — usulan ini cukup dengan pergeseran antar dinas, tanpa tambahan anggaran. ' +
            'Kalau kolom Acress (%) diubah naik, angka itu akan jadi positif: sebesar itulah tambahan anggaran yang diperlukan.'
          : `Σ Pergeseran = ${rupiah(akhir.defisitRiil)} di atas pagu tersedia — sebesar itulah tambahan anggaran yang masih dibutuhkan.`,
      ])
      ws.mergeCells(catatan.number, 2, catatan.number, KOL)
      catatan.getCell(2).font = { size: 9, italic: true, color: { argb: akhir.cukup ? 'FF667085' : MERAH_TEKS } }
      catatan.getCell(2).alignment = { vertical: 'middle', wrapText: true }
      aturanSelisihMerah(ws, 'L', barisPertama, total.number)
    }

    for (const kol of ['C', 'D', 'F', 'G', 'H', 'J', 'K']) ws.getColumn(kol).numFmt = FMT_RP
    ws.getColumn('E').numFmt = FMT_DESIMAL
    ws.getColumn('I').numFmt = '0.00%'
    ws.getColumn('L').numFmt = FMT_PERGESERAN
  }

  // ---- Sheet AKHIR REKENING: rincian usulan sampai tingkat rekening ----
  //
  // Bentuk datar (satu baris = satu dinas × satu rekening), urut per golongan
  // pegawai lalu per kode. Kolomnya sama dengan sheet PROYEKSI AKHIR, jadi
  // acress di sini pun boleh diubah per baris.
  if (akhir) {
    const ws = wb.addWorksheet('AKHIR REKENING', { views: [{ state: 'frozen', xSplit: 2, ySplit: 7 }] })
    const labelGolongan = new Map((akhir.golongan || []).map(g => [g.kunci, g.label]))
    const KOLOM = [
      { header: 'Kode SKPD', width: 16 },
      { header: 'Nama SKPD', width: 34 },
      { header: 'Gol.', width: 7 },
      { header: 'Kode Rek', width: 21 },
      { header: 'Nama Rekening', width: 38 },
      { header: 'Pagu Sekarang', width: 17 },
      { header: `Realisasi\n(${labelRealisasi})`, width: 17 },
      { header: 'Dibayar\n(kali)', width: 9 },
      { header: `${labelBasis}`, width: 17 },
      { header: `Kebutuhan ${bulanSisa} Bln`, width: 17 },
      { header: 'Kebutuhan s.d. Des', width: 18 },
      { header: 'Acress\n(%, boleh diubah)', width: 13 },
      { header: 'Acress\n(Rp)', width: 16 },
      { header: 'Usulan\n(Kebutuhan + Acress)', width: 19 },
      { header: 'Pergeseran\n(Usulan − Pagu)', width: 18 },
      { header: 'Catatan', width: 26 },
    ]
    const KOL = KOLOM.length

    judul(ws, 'USULAN ALOKASI PER REKENING (SELURUH SKPD)', KOL, { size: 12, height: 20 })
    judul(ws, `TA ${tahun} · Rekening ${prefix}* · Realisasi ${labelRealisasi} · dasar proyeksi: ${labelBasis}`, KOL,
      { bold: false, size: 10, color: 'FF667085' })
    judul(ws,
      'Satu baris = satu dinas × satu rekening, urut per golongan pegawai lalu per kode — seluruh rekening PNS ' +
      'berkumpul dulu, baru PPPK. Inilah lampiran usulan pergeserannya. Kolom "Dibayar (kali)" adalah pembagi ' +
      'rekening itu sendiri: iuran BPJS hanya sekali sebulan, gaji pokok ikut terbayar di bulan THR dan gaji ke-13.',
      KOL, { bold: false, size: 9, color: 'FF98A2B3' })
    judul(ws,
      `Jumlah baris: ${akhir.skpd.reduce((a, s) => a + s.rekening.length, 0)} · ` +
      `perlu ditambah: ${akhir.skpd.reduce((a, s) => a + s.rekening.filter(r => r.pergeseran > 0).length, 0)} rekening · ` +
      `pagunya ditarik: ${akhir.skpd.reduce((a, s) => a + s.rekening.filter(r => r.pergeseran < 0).length, 0)} rekening` +
      (akhir.golongan || []).map(g =>
        ` │ ${g.label}: kebutuhan ${rupiah(g.kebutuhan)} + acress ${rupiah(g.cadanganAkhir)} = ${rupiah(g.alokasi)}`).join(''),
      KOL, { bold: false, size: 9, color: 'FF98A2B3' })

    const barisSisa = barisAngka(ws, 'Bulan-gaji sisa', bulanSisa, rentangSisa)
    const REF_SISA = `$C$${barisSisa.number}`

    const header = ws.addRow(KOLOM.map(k => k.header))
    styleHeader(header, KOL)
    KOLOM.forEach((k, i) => { ws.getColumn(i + 1).width = k.width })

    const barisPertama = header.number + 1
    for (const s of akhir.skpd) {
      for (const r of s.rekening) {
        const n = ws.rowCount + 1
        const row = ws.addRow([
          s.kodeSkpd, s.namaSkpd, labelGolongan.get(r.golongan) || r.golongan,
          r.kodeRekening, r.namaRekening,
          r.pagu, r.sp2d, r.dibayar || null, r.perBulanRutin,
          { formula: `I${n}*${REF_SISA}` },
          { formula: `G${n}+J${n}` },
          s.terkunci ? null : akhir.persenAkhir / 100,
          { formula: `IF(L${n}="",0,K${n}*L${n})` },
          s.terkunci ? r.pagu : { formula: `K${n}+M${n}` },
          { formula: `N${n}-F${n}` },
          s.terkunci ? 'Dinas dikunci — tanpa dasar hitung'
            : r.tanpaRealisasi ? 'Belum pernah dibayar — pagu ditarik penuh'
            : r.dibayarPerkiraan ? 'Belum ada realisasi bulanan — pembagi dinas dipinjam'
            : null,
        ])
        row.font = { size: 10 }
        for (let c = 1; c <= KOL; c++) row.getCell(c).border = garis()
        row.getCell(1).font = { size: 10, name: 'Consolas' }
        row.getCell(4).font = { size: 10, name: 'Consolas' }
        for (const c of [3, 8, 12]) row.getCell(c).alignment = { horizontal: 'center' }
        row.getCell(16).font = { size: 9, italic: true, color: { argb: 'FF98A2B3' } }
        if (!s.terkunci) row.getCell(12).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KUNING } }
        if (r.pergeseran > 0) tandaiTambah(row, KOL, { lewati: [12], kolomTeks: [15] })
        else if (s.terkunci) tandaiKunci(row, KOL)
      }
    }

    const barisTerakhir = ws.rowCount
    if (barisTerakhir >= barisPertama) {
      const jum = (kol) => `SUM(${kol}${barisPertama}:${kol}${barisTerakhir})`
      const total = ws.addRow([
        'TOTAL', null, null, null, null,
        { formula: jum('F') }, { formula: jum('G') }, null,
        { formula: jum('I') }, { formula: jum('J') }, { formula: jum('K') }, null,
        { formula: jum('M') }, { formula: jum('N') }, { formula: jum('O') }, null,
      ])
      styleBarisTotal(total, KOL)
      ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: barisTerakhir, column: KOL } }
      aturanSelisihMerah(ws, 'O', barisPertama, total.number)
    }

    for (const kol of ['F', 'G', 'I', 'J', 'K', 'M', 'N']) ws.getColumn(kol).numFmt = FMT_RP
    ws.getColumn('H').numFmt = FMT_DESIMAL
    ws.getColumn('L').numFmt = '0.00%'
    ws.getColumn('O').numFmt = FMT_PERGESERAN
  }

  return wb.xlsx.writeBuffer()
}

export function namaFileProyeksiGaji(tahun, prefix, bulanTerakhir) {
  const bln = bulanTerakhir ? `-sd-${String(bulanTerakhir).padStart(2, '0')}` : ''
  return `proyeksi-gaji-tunjangan-${prefix}-${tahun}${bln}.xlsx`
}
