import ExcelJS from 'exceljs'

import {
  FMT_RP, KUNING, HIJAU, MERAH, MERAH_TEKS, AMBER, AMBER_TEKS, GOL_BAND,
  garis, styleHeader, styleBarisTotal, judul,
} from './proyeksiGajiExcel.js'

// Pembangun workbook "Cek Inputan — Matriks".
//
// Meniru lembar kerja manual yang dipakai sebelum ada aplikasi ini: satu sheet
// per golongan (PNS, PPPK), isinya blok-blok bertumpuk dengan baris dan kolom
// yang sama persis —
//
//   HITUNGAN      perangkat daerah × komponen gaji, angka usulan
//   INPUTAN       susunan sama, angka yang benar-benar diinput
//   PERBANDINGAN  =ABS(inputan - hitungan) <= toleransi  → TRUE / FALSE
//   SELISIH       =inputan - hitungan
//
// Blok HITUNGAN & INPUTAN berisi NILAI, bukan rumus — angka hitungan dibekukan
// sesuai keadaan waktu diekspor. Blok PERBANDINGAN dan SELISIH berisi RUMUS yang
// menunjuk ke dua blok itu, jadi kalau satu angka inputan dibetulkan langsung di
// file, TRUE/FALSE-nya ikut berubah. Toleransi juga satu sel yang bisa diubah.

const HIJAU_TEKS = 'FF067647'

function kolomHuruf(ws, no) {
  return ws.getColumn(no).letter
}

function bandBlok(ws, teks, kolomTerakhir) {
  const row = ws.addRow([teks])
  ws.mergeCells(row.number, 1, row.number, kolomTerakhir)
  const c = row.getCell(1)
  c.font = { bold: true, size: 11, color: { argb: 'FF1D2939' } }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GOL_BAND } }
  c.alignment = { vertical: 'middle' }
  row.height = 20
  return row
}

function headerBlok(ws, m, kolomTerakhir, labelJumlah) {
  const row = ws.addRow(['No', 'Perangkat Daerah', ...m.kolom.map(k => k.label), labelJumlah])
  styleHeader(row, kolomTerakhir)
  return row
}

function sheetGolongan(wb, m, opsi) {
  const nKomp = m.kolom.length
  const K_AWAL = 3
  const K_AKHIR = K_AWAL + nKomp - 1
  const K_JUMLAH = K_AKHIR + 1
  const ws = wb.addWorksheet(m.label.slice(0, 31), {
    views: [{ state: 'frozen', xSplit: 2 }],
  })
  ws.getColumn(1).width = 5
  ws.getColumn(2).width = 42
  for (let c = K_AWAL; c <= K_AKHIR; c++) ws.getColumn(c).width = 17
  ws.getColumn(K_JUMLAH).width = 19

  judul(ws, `CEK INPUTAN GAJI ${m.label} — TA ${opsi.tahun}`, K_JUMLAH, { size: 14, height: 22 })
  judul(ws,
    `Hitungan = usulan versi ${opsi.sisi === 'sim' ? 'Sim Gaji' : 'Rumus'}, acress ${opsi.persenAcress}` +
    ` • Inputan = ${opsi.namaBerkas} • diekspor ${opsi.waktu}`,
    K_JUMLAH, { bold: false, size: 10, color: 'FF667085' })

  // Sel toleransi — dirujuk mutlak oleh seluruh rumus PERBANDINGAN.
  const rTol = ws.addRow(['', 'Toleransi (Rp) — selisih ≤ ini dianggap TRUE', opsi.toleransi])
  rTol.getCell(2).font = { size: 10, bold: true }
  const selTol = rTol.getCell(3)
  selTol.numFmt = FMT_RP
  selTol.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KUNING } }
  selTol.border = garis()
  const refTol = `$${kolomHuruf(ws, 3)}$${rTol.number}`
  const rTolTot = ws.addRow(['', 'Batas selisih total per dinas (Rp) — di bawah ini = SALING TUTUP', opsi.toleransiTotal || 0])
  rTolTot.getCell(2).font = { size: 10, bold: true }
  const selTolTot = rTolTot.getCell(3)
  selTolTot.numFmt = FMT_RP
  selTolTot.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KUNING } }
  selTolTot.border = garis()
  const refTolTot = `$${kolomHuruf(ws, 3)}$${rTolTot.number}`
  ws.addRow([])

  // ---- Blok nilai (HITUNGAN / INPUTAN) ----
  function blokNilai(teks, ambil, ada) {
    bandBlok(ws, teks, K_JUMLAH)
    headerBlok(ws, m, K_JUMLAH, 'Jumlah')
    const baris = []
    m.baris.forEach((d, i) => {
      const nilai = m.kolom.map(k => {
        const c = d.sel[k.kode]
        return c && (c.adaHitungan || c.adaInputan) ? ambil(c) : null
      })
      const row = ws.addRow([i + 1, d.namaSkpd, ...nilai])
      const dari = `${kolomHuruf(ws, K_AWAL)}${row.number}`
      const ke = `${kolomHuruf(ws, K_AKHIR)}${row.number}`
      row.getCell(K_JUMLAH).value = {
        formula: `SUM(${dari}:${ke})`,
        result: nilai.reduce((a, v) => a + (v || 0), 0),
      }
      for (let c = 1; c <= K_JUMLAH; c++) {
        const cell = row.getCell(c)
        cell.border = garis()
        if (c >= K_AWAL) cell.numFmt = FMT_RP
        // Rekening yang ada di satu sisi saja ditandai, supaya sel "0" hasil
        // rekening tak diinput tidak terbaca sebagai angka nol yang disengaja.
        const kol = m.kolom[c - K_AWAL]
        const sel = kol && d.sel[kol.kode]
        if (sel && !ada(sel)) {
          cell.value = 0
          cell.font = { italic: true, color: { argb: 'FF98A2B3' } }
        }
      }
      row.getCell(2).alignment = { wrapText: true, vertical: 'middle' }
      baris.push(row.number)
    })
    const rTot = ws.addRow(['', 'JUMLAH'])
    for (let c = K_AWAL; c <= K_JUMLAH; c++) {
      const h = kolomHuruf(ws, c)
      const hasil = baris.reduce((a, r) => a + (Number(ws.getCell(`${h}${r}`).value?.result ??
        ws.getCell(`${h}${r}`).value) || 0), 0)
      rTot.getCell(c).value = baris.length
        ? { formula: `SUM(${h}${baris[0]}:${h}${baris[baris.length - 1]})`, result: hasil }
        : 0
      rTot.getCell(c).numFmt = FMT_RP
    }
    styleBarisTotal(rTot, K_JUMLAH)
    ws.addRow([])
    return { baris, total: rTot.number }
  }

  const blokHit = blokNilai('HITUNGAN', c => c.hitungan, c => c.adaHitungan)
  const blokInp = blokNilai('INPUTAN', c => c.inputan, c => c.adaInputan)
  const barisHit = blokHit.baris
  const barisInp = blokInp.baris
  const hJumlah = kolomHuruf(ws, K_JUMLAH)

  // ---- Blok PERBANDINGAN: TRUE / FALSE ----
  bandBlok(ws, `PERBANDINGAN — TRUE kalau |inputan − hitungan| ≤ toleransi`, K_JUMLAH)
  headerBlok(ws, m, K_JUMLAH, 'Total dinas')
  const barisBdg = []
  m.baris.forEach((d, i) => {
    const row = ws.addRow([i + 1, d.namaSkpd])
    m.kolom.forEach((k, j) => {
      const c = d.sel[k.kode]
      if (!c) return
      const h = kolomHuruf(ws, K_AWAL + j)
      row.getCell(K_AWAL + j).value = {
        formula: `ABS(${h}${barisInp[i]}-${h}${barisHit[i]})<=${refTol}`,
        result: c.cocok,
      }
    })
    const dari = `${kolomHuruf(ws, K_AWAL)}${row.number}`
    const ke = `${kolomHuruf(ws, K_AKHIR)}${row.number}`
    // Keputusan di tingkat jumlah dinas: rekening yang meleset tapi jumlahnya
    // tetap pas = SALING TUTUP, dibiarkan.
    row.getCell(K_JUMLAH).value = {
      formula: `IF(COUNTIF(${dari}:${ke},FALSE)=0,"COCOK",` +
        `IF(ABS(${hJumlah}${barisInp[i]}-${hJumlah}${barisHit[i]})<=${refTolTot},"SALING TUTUP","SIGNIFIKAN"))`,
      result: { cocok: 'COCOK', salingTutup: 'SALING TUTUP', signifikan: 'SIGNIFIKAN' }[d.status],
    }
    for (let c = 1; c <= K_JUMLAH; c++) {
      const cell = row.getCell(c)
      cell.border = garis()
      if (c >= K_AWAL) cell.alignment = { horizontal: 'center' }
    }
    row.getCell(2).alignment = { wrapText: true, vertical: 'middle' }
    barisBdg.push(row.number)
  })
  const rSalah = ws.addRow(['', 'Jumlah FALSE / dinas SIGNIFIKAN'])
  for (let c = K_AWAL; c <= K_JUMLAH; c++) {
    const h = kolomHuruf(ws, c)
    const kol = m.kolom[c - K_AWAL]
    const rentang = `${h}${barisBdg[0]}:${h}${barisBdg[barisBdg.length - 1]}`
    rSalah.getCell(c).value = !barisBdg.length ? 0
      : kol ? { formula: `COUNTIF(${rentang},FALSE)`, result: m.total.salah[kol.kode] }
      : { formula: `COUNTIF(${rentang},"SIGNIFIKAN")`, result: m.dinasSignifikan }
    rSalah.getCell(c).alignment = { horizontal: 'center' }
  }
  styleBarisTotal(rSalah, K_JUMLAH)
  // Kesimpulan golongan sekabupaten.
  const rVonis = ws.addRow(['', 'KESIMPULAN TOTAL'])
  ws.mergeCells(rVonis.number, K_AWAL, rVonis.number, K_JUMLAH)
  rVonis.getCell(K_AWAL).value = barisBdg.length ? {
    formula: `IF(COUNTIF(${hJumlah}${barisBdg[0]}:${hJumlah}${barisBdg[barisBdg.length - 1]},"SIGNIFIKAN")>0,` +
      `"ADA SELISIH SIGNIFIKAN — "&COUNTIF(${hJumlah}${barisBdg[0]}:${hJumlah}${barisBdg[barisBdg.length - 1]},"SIGNIFIKAN")&" dinas",` +
      `IF(COUNTIF(${hJumlah}${barisBdg[0]}:${hJumlah}${barisBdg[barisBdg.length - 1]},"SALING TUTUP")>0,` +
      `"TIDAK SIGNIFIKAN — hanya saling tutup","SEMUA COCOK"))`,
    result: m.dinasSignifikan ? `ADA SELISIH SIGNIFIKAN — ${m.dinasSignifikan} dinas`
      : m.dinasSalingTutup ? 'TIDAK SIGNIFIKAN — hanya saling tutup' : 'SEMUA COCOK',
  } : 'SEMUA COCOK'
  styleBarisTotal(rVonis, K_JUMLAH)
  rVonis.getCell(K_AWAL).font = {
    bold: true,
    color: { argb: m.dinasSignifikan ? MERAH_TEKS : m.dinasSalingTutup ? AMBER_TEKS : HIJAU_TEKS },
  }
  if (barisBdg.length) {
    const kiri = `${kolomHuruf(ws, K_AWAL)}${barisBdg[0]}`
    const ref = `${kiri}:${kolomHuruf(ws, K_JUMLAH)}${barisBdg[barisBdg.length - 1]}`
    ws.addConditionalFormatting({
      ref,
      rules: [
        {
          type: 'expression', priority: 1,
          formulae: [`AND(ISLOGICAL(${kiri}),NOT(${kiri}),$${hJumlah}${barisBdg[0]}="SALING TUTUP")`],
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: AMBER } },
            font: { bold: true, color: { argb: AMBER_TEKS } },
          },
        },
        {
          type: 'expression', priority: 2,
          formulae: [`AND(ISLOGICAL(${kiri}),NOT(${kiri}))`],
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: MERAH } },
            font: { bold: true, color: { argb: MERAH_TEKS } },
          },
        },
        {
          type: 'expression', priority: 3,
          formulae: [`AND(ISLOGICAL(${kiri}),${kiri})`],
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: HIJAU } },
            font: { color: { argb: HIJAU_TEKS } },
          },
        },
        ...[['COCOK', HIJAU, HIJAU_TEKS], ['SALING TUTUP', AMBER, AMBER_TEKS], ['SIGNIFIKAN', MERAH, MERAH_TEKS]]
          .map(([teks, isi, warna], i) => ({
            type: 'expression', priority: 4 + i,
            formulae: [`${kiri}="${teks}"`],
            style: {
              fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: isi } },
              font: { bold: true, color: { argb: warna } },
            },
          })),
      ],
    })
  }
  ws.addRow([])

  // ---- Blok SELISIH: berapa melesetnya ----
  bandBlok(ws, 'SELISIH — inputan − hitungan (minus = kurang diinput)', K_JUMLAH)
  headerBlok(ws, m, K_JUMLAH, 'Jumlah')
  const barisSel = []
  m.baris.forEach((d, i) => {
    const row = ws.addRow([i + 1, d.namaSkpd])
    m.kolom.forEach((k, j) => {
      const c = d.sel[k.kode]
      if (!c) return
      const h = kolomHuruf(ws, K_AWAL + j)
      row.getCell(K_AWAL + j).value = { formula: `${h}${barisInp[i]}-${h}${barisHit[i]}`, result: c.selisih }
    })
    const dari = `${kolomHuruf(ws, K_AWAL)}${row.number}`
    const ke = `${kolomHuruf(ws, K_AKHIR)}${row.number}`
    row.getCell(K_JUMLAH).value = { formula: `SUM(${dari}:${ke})`, result: d.selisih }
    for (let c = 1; c <= K_JUMLAH; c++) {
      const cell = row.getCell(c)
      cell.border = garis()
      if (c >= K_AWAL) cell.numFmt = '#,##0;[Red]-#,##0;"-"'
    }
    row.getCell(2).alignment = { wrapText: true, vertical: 'middle' }
    barisSel.push(row.number)
  })
  const rTotSel = ws.addRow(['', 'JUMLAH'])
  for (let c = K_AWAL; c <= K_JUMLAH; c++) {
    const h = kolomHuruf(ws, c)
    const kol = m.kolom[c - K_AWAL]
    const hasil = kol ? m.total.inputan[kol.kode] - m.total.hitungan[kol.kode] : m.jumlahInputan - m.jumlahHitungan
    rTotSel.getCell(c).value = barisSel.length
      ? { formula: `SUM(${h}${barisSel[0]}:${h}${barisSel[barisSel.length - 1]})`, result: hasil }
      : 0
    rTotSel.getCell(c).numFmt = '#,##0;[Red]-#,##0;"-"'
  }
  styleBarisTotal(rTotSel, K_JUMLAH)

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 }
}

/**
 * @param matriks  hasil matriksBanding()
 * @param opsi     { tahun, sisi, persenAcress (teks), toleransi, toleransiTotal, namaBerkas }
 */
export async function buatWorkbookMatriksInputan(matriks, opsi) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'BPKAD Superapps'
  wb.created = new Date()
  // ExcelJS tidak menulis hasil tersimpan yang bernilai FALSE / 0, jadi sel
  // itu akan tampil kosong sampai dihitung ulang — paksa hitung ulang saat dibuka.
  wb.calcProperties.fullCalcOnLoad = true
  const waktu = new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
  for (const m of matriks) sheetGolongan(wb, m, { ...opsi, waktu })
  return wb.xlsx.writeBuffer()
}

export function namaFileMatriksInputan(tahun) {
  const t = new Date()
  const tgl = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}`
  return `Cek_Inputan_Gaji_TA${tahun}_${tgl}.xlsx`
}
