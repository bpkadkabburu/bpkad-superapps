import ExcelJS from 'exceljs'

import {
  NAMA_BULAN, FMT_RP, FMT_RP_MERAH, FMT_PERGESERAN,
  KUNING, MERAH, MERAH_TEKS, AMBER, AMBER_TEKS, HIJAU,
  garis, styleHeader, styleBarisTotal, styleSubtotal, judul, barisAngka, barisBand,
  petaLabelGolongan, kelompokkanGolongan,
  rupiah, labelSisaBulan,
} from './proyeksiGajiExcel.js'

// Pembangun workbook "Lembar Kesiapan Rekening Gaji".
//
// Pertanyaan yang dijawab berkas ini, urut dari yang paling sering ditanyakan:
//
//   1. Bulan depan rekening ini butuh berapa, dan mana yang tidak cukup?
//   2. Kalau tidak cukup, ambilnya dari mana?
//   3. Kalau begitu terus sampai Desember, rekening ini sebenarnya butuh
//      anggaran berapa? — angka yang selama ini harus dicari manual.
//
// Sekaligus menjawab pertanyaan yang mendasari seluruh rancangannya:
//
//   "Apakah total jumlahnya berbeda kalau geser untuk menutup minus bulan depan
//    dilakukan sembarang, dibandingkan kalau minus bulanan diabaikan dan
//    anggarannya langsung disediakan sampai akhir tahun?"
//
// TIDAK BERBEDA. Kolom Proyeksi Akhir = realisasi + Sim Gaji x sisa bulan;
// rumus itu tidak memuat suku anggaran sama sekali, dan geser itu sendiri
// zero-sum. Jadi jumlah Proyeksi Akhir sekabupaten sama saja, jalan mana pun
// yang ditempuh. Bedanya cuma berapa kali harus mengurus pergeseran: jalan
// bulanan mengurusnya berkali-kali, jalan akhir-tahun sekali. Sheet RINGKASAN
// menulis perbandingan itu dengan angkanya sendiri.
//
// Susunan sheet:
//   PER REKENING (inti) -> JAWABAN -> PER DINAS -> RINGKASAN
//
// Rekening dipisah per golongan pegawai di mana-mana: blok PNS dulu, baru PPPK,
// masing-masing ditutup SUBTOTAL — angka PNS dan PPPK tidak pernah tercampur
// dalam satu penjumlahan walau kode rekeningnya berselang-seling. Pemisahan itu
// bukan soal tampilan: pergeseran memang TIDAK BOLEH lintas golongan, jadi
// SUBTOTAL golongan adalah batas kolam yang sesungguhnya.
//
// Pergeseran ditulis DUA SISI, sebaris-sebaris: "Geser Masuk" di rekening yang
// kurang dan "Geser Keluar" di rekening yang memberi. Di tiap baris SUBTOTAL
// golongan kedua kolom itu WAJIB sama besar — uang tidak datang dari mana-mana,
// dia dipindahkan. Kolom "Anggaran Setelah Geser" = anggaran + masuk - keluar,
// dan itulah angka yang akan dipakai waktu daftar gaji disusun.

// Sisa kurang / kekurangan selalu >= 0, jadi yang ditandai merah adalah nilai di
// ATAS nol — kebalikan dari aturanSelisihMerah di berkas export utama, yang
// menandai kolom bertanda (pergeseran/selisih) di bawah nol.
function aturanKurangMerah(ws, kolom, dari, sampai) {
  if (sampai < dari) return
  ws.addConditionalFormatting({
    ref: `${kolom}${dari}:${kolom}${sampai}`,
    rules: [{
      type: 'cellIs',
      operator: 'greaterThan',
      formulae: ['0'],
      priority: 1,
      style: {
        font: { bold: true, color: { argb: MERAH_TEKS } },
        fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: MERAH } },
      },
    }],
  })
}

// Kolom "Selisih" bertanda: minus = anggarannya tidak cukup. Yang ditandai di
// sini justru yang di BAWAH nol.
function aturanSelisihKurang(ws, kolom, dari, sampai) {
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

function namaBulan(b) {
  return b && NAMA_BULAN[b] ? NAMA_BULAN[b] : '—'
}

// Sumber pergeseran ditulis satu baris per rekening di dalam SATU sel, bukan
// satu baris Excel per sumber: satu rekening yang kurang harus tetap terbaca
// sebagai satu baris jawaban walau uangnya ditarik dari beberapa tempat.
//
// Dinas yang kekurangannya melebihi seluruh surplusnya akan menguras semua
// rekening bersurplus — pernah sampai 17 baris, yang tidak terbaca lagi di
// kertas. Yang ditulis utuh cuma sumber terbesar; sisanya diringkas jadi satu
// baris. Totalnya tetap ada di kolom "Total Diambil", jadi tidak ada angka hilang.
const MAKS_SUMBER = 5

function daftarSumber(r) {
  const semua = r.ambilDari || []
  if (semua.length <= MAKS_SUMBER) {
    return {
      teks: semua.map(a => `${a.kodeRekening}  ${a.namaRekening}`).join('\n'),
      nilai: semua.map(a => rupiah(a.nilai)).join('\n'),
      baris: semua.length,
    }
  }
  const utama = semua.slice(0, MAKS_SUMBER)
  const sisa = semua.slice(MAKS_SUMBER)
  const sisaNilai = sisa.reduce((a, x) => a + x.nilai, 0)
  return {
    teks: [...utama.map(a => `${a.kodeRekening}  ${a.namaRekening}`),
      `dan ${sisa.length} rekening lain di dinas ini`].join('\n'),
    nilai: [...utama.map(a => rupiah(a.nilai)), rupiah(sisaNilai)].join('\n'),
    baris: MAKS_SUMBER + 1,
  }
}

// Literal teks & rupiah di dalam rumus Excel. FIXED, bukan TEXT(x,"#,##0"):
// format TEXT ikut locale pembuka berkas, sehingga di Excel berbahasa Indonesia
// koma dibaca sebagai desimal. FIXED memakai pemisah ribuan sistem dengan
// sendirinya — hasilnya sama dengan rupiah() di sisi JS.
const teksF = (s) => `"${String(s).replace(/"/g, '""')}"`
const rpF = (x) => `"Rp"&FIXED(${x},0)`

// Catatan PER REKENING ditulis sebagai RUMUS, bukan teks jadi: begitu Sim Gaji
// atau Acress diubah, kalimatnya ikut berubah bersama angka di barisnya —
// catatan yang tertinggal dari angkanya lebih menyesatkan daripada tanpa
// catatan. Yang tetap statis cuma kode rekening sumber geser, karena
// pemilihannya keputusan aplikasi, bukan hitungan di sheet.
//
// `gol` = rumus kolam golongannya (rumusGolongan); `v` = nilai sel baris ini
// (plus `luarGol`, padanan gol.luar) untuk
// hasil cache, disusun dengan logika yang sama persis dengan rumusnya supaya
// pembaca yang tidak menghitung ulang (pratinjau, Excel mode manual) tetap
// melihat kalimat yang benar.
function catatanRekening(r, n, gol, v, bulanPertama, bulanSisa) {
  const bln = NAMA_BULAN[bulanPertama] || 'Bulan depan'
  const sim = `IF(E${n}="",${r.rataRata},E${n})`
  const asal = r.ambilDari || []
  const dari = asal.length
    ? ` dari ${asal[0].kodeRekening}${asal.length > 1 ? ` + ${asal.length - 1} rekening lain` : ''}`
    : ''
  const adaLanjut = bulanPertama && bulanSisa > 1
  // Bulan habis = aritmetika yang sama dengan bulanMentok di backend: sisa
  // anggaran dibagi Sim Gaji, dibulatkan ke bawah, dihitung dari bulan depan.
  const idxHabis = `${bulanPertama}+INT((C${n}-D${n})/${sim})`

  const fBaru = `"Belum berpagu & belum pernah dibayar — perlu anggaran baru "&${rpF(`M${n}`)}&", bukan geser"`
  const fDepan =
    `IF(G${n}<0,${teksF(`${bln}: kurang `)}&${rpF(`-G${n}`)}` +
      `&IF(I${n}>0,", ditanggung "&${rpF(`I${n}`)}&${teksF(dari)}` +
        `&IF(-G${n}-I${n}>0,", masih kurang "&${rpF(`-G${n}-I${n}`)},""),` +
        `", belum ada rekening segolongan yang menanggung"),` +
      `${teksF(`${bln}: cukup`)}&IF(H${n}>0,", menanggung "&${rpF(`H${n}`)}&" untuk rekening lain",""))`
  const fHabis = adaLanjut
    ? `&IF(G${n}>=0,IF(${sim}>0,IF(${idxHabis}<=12,"; anggaran habis "&` +
      `CHOOSE(${idxHabis},${NAMA_BULAN.slice(1).map(teksF).join(',')}),""),""),"")`
    : ''
  const fAkhir =
    `&IF(N${n}>0,"; s.d. Desember kurang "&${rpF(`N${n}`)}` +
      `&IF(AND(L${n}<>0,O${n}<=0)," (tanpa acress sebenarnya cukup)","")` +
      `&IF(${gol.luar}>0," — golongan ini secara total kurang, sebagian perlu dari luar dinas",` +
        `", bisa ditutup dari rekening segolongan"),` +
      `"; s.d. Desember cukup")`
  const fSim = `&IF(E${n}="","; Sim Gaji kosong — dipakai rata² realisasi","")`
  const formula = `IF(AND(C${n}=0,D${n}=0),${fBaru},${fDepan}${fHabis}${fAkhir}${fSim})`

  let t
  if (r.pagu === 0 && r.sp2d === 0) {
    t = `Belum berpagu & belum pernah dibayar — perlu anggaran baru ${rupiah(v.M)}, bukan geser`
  } else {
    if (v.G < 0) {
      t = `${bln}: kurang ${rupiah(-v.G)}`
      if (v.I > 0) {
        t += `, ditanggung ${rupiah(v.I)}${dari}`
        if (-v.G - v.I > 0) t += `, masih kurang ${rupiah(-v.G - v.I)}`
      } else {
        t += ', belum ada rekening segolongan yang menanggung'
      }
    } else {
      t = `${bln}: cukup`
      if (v.H > 0) t += `, menanggung ${rupiah(v.H)} untuk rekening lain`
    }
    if (adaLanjut && v.G >= 0 && r.sim > 0) {
      const b = bulanPertama + Math.floor((r.pagu - r.sp2d) / r.sim)
      if (b <= 12) t += `; anggaran habis ${NAMA_BULAN[b]}`
    }
    if (v.N > 0) {
      t += `; s.d. Desember kurang ${rupiah(v.N)}`
      if (v.L !== 0 && v.O <= 0) t += ' (tanpa acress sebenarnya cukup)'
      t += v.luarGol > 0
        ? ' — golongan ini secara total kurang, sebagian perlu dari luar dinas'
        : ', bisa ditutup dari rekening segolongan'
    } else {
      t += '; s.d. Desember cukup'
    }
    if (!r.simDariIsian) t += '; Sim Gaji kosong — dipakai rata² realisasi'
  }
  return { formula, result: t }
}

// Kolam pergeseran satu golongan di PER REKENING, sebagai potongan rumus.
// Rekening belum berpagu (C = 0 dan D = 0) dikeluarkan dari kolam — sama
// dengan backend: pertanyaannya "perlu anggaran baru berapa", bukan "geser
// dari mana" — dan dijumlah tersendiri sebagai `baru`.
//   kurang = Σ kekurangan rekening berpagu sampai Desember
//   luar   = yang tetap kurang sesudah seluruh surplus segolongan dipakai
function rumusGolongan(awal, akhir) {
  if (akhir < awal) return { kurang: '0', luar: '0', baru: '0' }
  const rg = (kol) => `${kol}${awal}:${kol}${akhir}`
  const kurang = `(SUMIF(${rg('N')},">0")-SUMIFS(${rg('N')},${rg('C')},0,${rg('D')},0,${rg('N')},">0"))`
  return {
    kurang,
    luar: `MAX(0,${kurang}+SUMIF(${rg('N')},"<0"))`,
    baru: `SUMIFS(${rg('M')},${rg('C')},0,${rg('D')},0)`,
  }
}

// Padanan JS rumusGolongan untuk nilai cache.
function nilaiGolongan(rows, nilaiN, nilaiM) {
  const belumBerpagu = (r) => r.pagu === 0 && r.sp2d === 0
  const kurang = rows.reduce((a, r) => a + (belumBerpagu(r) ? 0 : Math.max(0, nilaiN(r))), 0)
  const surplus = rows.reduce((a, r) => a + Math.max(0, -nilaiN(r)), 0)
  return {
    kurang,
    luar: Math.max(0, kurang - surplus),
    baru: rows.reduce((a, r) => a + (belumBerpagu(r) ? nilaiM(r) : 0), 0),
  }
}

// Catatan baris TOTAL dinas, juga rumus — dijumlah dari kolam tiap golongan,
// karena geser tidak boleh lintas golongan.
function catatanTotalDinas(golF, nilai) {
  const jumlah = (key) => `(${golF.map(g => g[key]).join('+') || '0'})`
  const kurang = jumlah('kurang')
  const luar = jumlah('luar')
  const baru = jumlah('baru')
  const formula =
    `IF(${kurang}<=0,IF(${baru}>0,"Rekening yang berpagu cukup sampai Desember","Seluruh rekening cukup sampai Desember"),` +
    `"Kurang "&${rpF(kurang)}&` +
    `IF(${luar}<=0,", seluruhnya tertutup dari rekening segolongan di dinas ini",` +
    `IF(${luar}>=${kurang},", tidak ada surplus segolongan yang bisa dipakai \u2014 seluruhnya perlu dari luar dinas",` +
    `"; tertutup "&${rpF(`${kurang}-${luar}`)}&" dari rekening segolongan \u2014 sisa "&${rpF(luar)}&" perlu dari luar dinas")))` +
    `&IF(${baru}>0,"; plus anggaran baru "&${rpF(baru)}&" untuk rekening yang belum berpagu","")`

  let result
  if (nilai.kurang <= 0) {
    result = nilai.baru > 0 ? 'Rekening yang berpagu cukup sampai Desember' : 'Seluruh rekening cukup sampai Desember'
  } else {
    result = `Kurang ${rupiah(nilai.kurang)}` + (
      nilai.luar <= 0 ? ', seluruhnya tertutup dari rekening segolongan di dinas ini'
        : nilai.luar >= nilai.kurang ? ', tidak ada surplus segolongan yang bisa dipakai \u2014 seluruhnya perlu dari luar dinas'
          : `; tertutup ${rupiah(nilai.kurang - nilai.luar)} dari rekening segolongan \u2014 sisa ${rupiah(nilai.luar)} perlu dari luar dinas`)
  }
  if (nilai.baru > 0) result += `; plus anggaran baru ${rupiah(nilai.baru)} untuk rekening yang belum berpagu`
  return { formula, result }
}

// Catatan yang menyebut "perlu dari luar dinas" diwarnai lewat conditional
// formatting, bukan font statis — kalimatnya rumus, jadi warnanya juga harus
// ikut berubah begitu Sim Gaji diubah.
function aturanCatatanLuar(ws, kolom, dari, sampai) {
  if (sampai < dari) return
  ws.addConditionalFormatting({
    ref: `${kolom}${dari}:${kolom}${sampai}`,
    rules: [{
      type: 'expression',
      formulae: [`ISNUMBER(SEARCH("perlu dari luar dinas",${kolom}${dari}))`],
      priority: 1,
      style: { font: { bold: true, color: { argb: MERAH_TEKS } } },
    }],
  })
}

function statusRekening(r) {
  if (r.tanpaPagu) return 'belum ada anggaran — perlu anggaran baru'
  if (r.sisaKurang > 0) return r.keluarBulanDepan > 0
    ? 'sebagian perlu dari luar dinas'
    : 'perlu dari luar dinas'
  return 'cukup dari rekening segolongan'
}

/**
 * @param {object} data payload GET /api/proyeksi-gaji (butuh data.kesiapan)
 * @param {object} opsi { tahun }
 * @returns {Promise<ArrayBuffer>}
 */
export async function buatWorkbookKesiapan(data, opsi) {
  const tahun = opsi.tahun
  const prefix = data.prefix
  const k = data.kesiapan
  if (!k) throw new Error('Payload tidak memuat data kesiapan rekening')

  const bulanSisa = k.bulanSisa || 0
  const bulanTerakhir = k.bulanTerakhir
  const bulanPertama = k.bulanPertama
  // Sisa bulan dipecah dua: BULAN DEPAN (satu bulan, yang akan ditanyakan lebih
  // dulu) dan SISANYA. Itu bentuk yang dipakai orang waktu memeriksa: "bulan
  // depan cukup tidak? kalau iya, sampai Desember cukup tidak?"
  const bulanLanjut = Math.max(0, bulanSisa - 1)
  // Nilai cache kolom M (PROYEKSI AKHIR) di PER REKENING: rencana realisasi
  // bulan depan (sudah memperhitungkan geser) + bulan sesudahnya + acress/fix.
  // Satu definisi untuk semua sheet yang menampilkan atau merujuk angka itu.
  const proyeksiAkhirRek = (r) =>
    r.sp2d + r.sim + (r.masukBulanDepan || 0) - (r.keluarBulanDepan || 0) + r.sim * bulanLanjut + r.tambahanFix
  const bulanSisaList = bulanPertama
    ? Array.from({ length: bulanSisa }, (_, i) => bulanPertama + i)
    : []
  const labelBulanDepan = namaBulan(bulanPertama)
  const labelLanjut = bulanLanjut > 0
    ? `${NAMA_BULAN[bulanPertama + 1]}–${NAMA_BULAN[12]}`
    : 'tidak ada sisa bulan'
  const rentangSisa = labelSisaBulan(bulanTerakhir)
  const labelRealisasi = bulanTerakhir
    ? `SP2D s.d. ${NAMA_BULAN[bulanTerakhir]} ${tahun}`
    : 'SP2D (belum ada data bulan)'

  const petaGol = petaLabelGolongan({ skpd: k.skpd })
  const canonicalGol = [...petaGol.keys()].sort((a, b) => String(a).localeCompare(String(b), 'id', { numeric: true }))

  const wb = new ExcelJS.Workbook()
  wb.creator = 'BPKAD Superapps'

  // Urutan addWorksheet menentukan urutan tab; isinya diisi belakangan sesuai
  // ketergantungan rumus (RINGKASAN kepala dulu -> PER REKENING -> PER DINAS ->
  // JAWABAN -> RINGKASAN badan).
  const wsRek = wb.addWorksheet('PER REKENING', { views: [{ state: 'frozen', xSplit: 2, ySplit: 7 }] })
  // Sheet ringkas untuk DIKIRIM KE DINAS: cuma rekening dan angka yang perlu
  // mereka siapkan. Isinya rumus yang menunjuk PER REKENING, jadi begitu Sim
  // Gaji atau Acress diubah, lembar kirimannya ikut berubah sendiri.
  const wsKirim = wb.addWorksheet('PROYEKSI DINAS', { views: [{ state: 'frozen', xSplit: 2, ySplit: 6 }] })
  const wsJawab = wb.addWorksheet('JAWABAN', { views: [{ state: 'frozen', xSplit: 2, ySplit: 7 }] })
  const wsDinas = wb.addWorksheet('PER DINAS', { views: [{ state: 'frozen', xSplit: 2, ySplit: 7 }] })
  const wsRingkas = wb.addWorksheet('RINGKASAN')

  // Tiga sheet ini memang untuk dicetak: melebar satu halaman, judul kolom
  // diulang di tiap halaman supaya halaman ketiga masih terbaca sendiri.
  for (const ws of [wsRek, wsKirim, wsJawab, wsDinas]) {
    ws.pageSetup = {
      orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      paperSize: 9, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    }
  }

  // ---- RINGKASAN (kepala): sel yang dirujuk sheet lain ----
  const RINGKAS_KOL = 4
  wsRingkas.getColumn(1).width = 50
  wsRingkas.getColumn(2).width = 8
  wsRingkas.getColumn(3).width = 22
  wsRingkas.getColumn(4).width = 64

  judul(wsRingkas, 'LEMBAR KESIAPAN REKENING GAJI — RINGKASAN', RINGKAS_KOL, { size: 14, height: 22 })
  judul(wsRingkas, `TA ${tahun} · Rekening ${prefix}* · Realisasi ${labelRealisasi} · sisa ${bulanSisa} bulan (${rentangSisa})`,
    RINGKAS_KOL, { bold: false, size: 10, color: 'FF667085' })
  judul(wsRingkas,
    'Kebutuhan tiap rekening dihitung polos dari isian Sim Gaji: realisasi + nilai sebulan × sisa bulan, TANPA ' +
    'cadangan apa pun. Begitu supaya angkanya bisa langsung diadu dengan proyeksi yang disusun orang dinas sendiri. ' +
    'Rekening yang Sim Gaji-nya belum diisi jatuh balik ke rata² realisasi.',
    RINGKAS_KOL, { bold: false, size: 9, color: 'FF667085' })
  wsRingkas.addRow([])

  const rowSisa = barisAngka(wsRingkas, `Bulan-gaji sisa (${rentangSisa})`, bulanSisa, null, { numFmt: '0' })
  const rowLanjut = barisAngka(wsRingkas, `Bulan sesudah ${labelBulanDepan} (${labelLanjut})`, bulanLanjut,
    `dipakai kolom "${labelLanjut}" di PER REKENING`, { numFmt: '0' })
  const REF_LANJUT = `'RINGKASAN'!$C$${rowLanjut.number}`
  const rowAcress = barisAngka(wsRingkas, 'Acress (%) — biarkan 0 untuk angka polos',
    (k.persenCadangan || 0) / 100,
    'kalau diisi, kolom PROYEKSI AKHIR di PER REKENING & PER DINAS ikut naik — buat menguji "bagaimana kalau ditambah cadangan"',
    { fill: KUNING, numFmt: '0.00%' })
  const REF_ACRESS = `'RINGKASAN'!$C$${rowAcress.number}`
  // Tambahan flat untuk Pembulatan Gaji & Tunjangan PPh/Tunjangan Khusus. Dua
  // rekening itu hampir selalu kurang beberapa ratus ribu walau sudah dapat
  // acress — sifatnya pembulatan/potongan pajak yang tidak bisa ditebak dari
  // tren realisasi. Ditempel FLAT di proyeksi akhir, bukan persentase.
  const rowFix = barisAngka(wsRingkas, 'Tambahan Fix (Rp) \u2014 Pembulatan Gaji & Tunj. PPh/Khusus',
    k.tambahanFix || 0,
    'flat per rekening yang cocok, di luar acress \u2014 ubah di sini, PER REKENING ikut berubah',
    { fill: KUNING, numFmt: FMT_RP })
  const REF_FIX = `'RINGKASAN'!$C$${rowFix.number}`
  void rowSisa

  // ---- PER REKENING ----
  //
  // Sheet inti. Susunan kolomnya mengikuti cara orang memeriksanya, kiri ke
  // kanan, tanpa lompat:
  //
  //   Anggaran -> Realisasi -> Sim Gaji -> Realisasi+Sim (posisi bulan depan)
  //   -> Selisih (minus = tidak cukup) -> Perlu Digeser Masuk (cara nutupnya)
  //   -> Rencana Realisasi setelah ditutup -> biaya bulan-bulan sesudahnya
  //   -> PROYEKSI AKHIR (butuh setahun) -> Selisih Akhir (cukup / kurang setahun)
  //
  // Kolom "Rencana Realisasi" nilainya SAMA dengan Realisasi+Sim, dan itu memang
  // intinya: menutup minus lewat pergeseran tidak mengubah berapa yang akan
  // direalisasikan, cuma mengubah dari kantong mana uangnya datang. Karena itu
  // PROYEKSI AKHIR (= kolom itu + bulan sesudahnya) tidak bergerak sedikit pun
  // oleh geser apa pun — itulah buktinya, terbaca langsung di barisnya.
  const KOLOM_REK = [
    { header: 'Kode Rek', width: 20 },
    { header: 'Nama Rekening', width: 32 },
    { header: 'Anggaran', width: 16 },
    { header: `Realisasi\n(${labelRealisasi})`, width: 16 },
    { header: 'Sim Gaji /Bln\n(boleh diubah)', width: 14 },
    { header: `Realisasi + Sim Gaji\n(posisi ${labelBulanDepan}, normalnya)`, width: 16 },
    { header: `Selisih ${labelBulanDepan}\n(Anggaran \u2212 F)`, width: 15 },
    { header: `Geser MASUK ${labelBulanDepan}\n(menanggung rekening lain)`, width: 15 },
    { header: `Geser KELUAR ${labelBulanDepan}\n(ditanggung rekening lain)`, width: 15 },
    { header: `Rencana Realisasi ${labelBulanDepan}\n(F + H \u2212 I)`, width: 17 },
    { header: `${labelLanjut}\n(Sim Gaji \u00d7 ${bulanLanjut} bln)`, width: 14 },
    { header: 'Acress + Tambahan Fix\n(Rp)', width: 15 },
    { header: 'PROYEKSI AKHIR\n(J + K + Acress)', width: 17 },
    { header: `Perlu Ditambah\n(Proyeksi \u2212 Anggaran)`, width: 16 },
    { header: `Perlu Ditambah\nTANPA Acress\n(J + K \u2212 Anggaran)`, width: 16 },
    { header: 'Cara Menutup / Catatan\n(otomatis, ikut angka)', width: 48 },
  ]
  const REK_KOL = KOLOM_REK.length
  const KOL_CATATAN = REK_KOL

  judul(wsRek, 'KEBUTUHAN PER REKENING — BULAN DEPAN DAN SAMPAI AKHIR TAHUN', REK_KOL, { size: 14, height: 22 })
  judul(wsRek, `TA ${tahun} · Rekening ${prefix}* · Realisasi ${labelRealisasi} · sisa ${bulanSisa} bulan (${rentangSisa})`,
    REK_KOL, { bold: false, size: 10, color: 'FF667085' })
  judul(wsRek,
    `Dibaca kiri ke kanan: anggaran, realisasi, satu kali Sim Gaji, lalu posisi ${labelBulanDepan} (realisasi + sim). ` +
    `Kolom "Selisih ${labelBulanDepan}" yang MINUS berarti anggarannya tidak cukup untuk ${labelBulanDepan}. Yang minus ` +
    'itu tidak ditambal dari langit: satu rekening tidak pernah bisa merealisasikan lebih dari anggarannya, jadi ' +
    'kelebihan kebutuhannya mendarat di rekening lain pada golongan yang sama. Karena itu ditulis dua sisi \u2014 ' +
    '"Ditanggung Rekening Lain" di baris yang kurang, "Menanggung Rekening Lain" di baris yang menampung \u2014 dan ' +
    '"Rencana Realisasi" menunjukkan angka yang benar-benar akan keluar di rekening itu bulan depan.',
    REK_KOL, { bold: false, size: 9, color: 'FF667085' })
  judul(wsRek,
    'Pergeseran TIDAK boleh lintas golongan: kekurangan PNS ditutup dari rekening PNS, PPPK dari PPPK, dan lazimnya ' +
    'dari gaji pokok selama masih bersurplus. Di tiap baris SUBTOTAL golongan, Geser MASUK dan Geser KELUAR pasti ' +
    'sama besar \u2014 itu bukti uangnya cuma berpindah. Sebaliknya, surplus PPPK yang menganggur tidak bisa menolong ' +
    'PNS yang kurang; di situlah muncul baris "perlu dari luar dinas".',
    REK_KOL, { bold: false, size: 9, color: 'FF98A2B3' })
  judul(wsRek,
    'PROYEKSI AKHIR tidak memuat anggaran sama sekali \u2014 isinya realisasi + Sim Gaji \u00d7 sisa bulan. Karena itu ' +
    'menggeser anggaran ke mana pun, sebanyak apa pun, TIDAK mengubah angka di kolom itu maupun jumlahnya; yang ' +
    'berubah cuma kolom "Anggaran Setelah Geser" dan "Selisih Akhir". Menutup minus bulanan satu per satu dan ' +
    'menyediakan sekaligus sampai akhir tahun berakhir di total yang sama persis. Kolom "Perlu Ditambah TANPA ' +
    'Acress" = kebutuhan polos tanpa kolom L; kolom Catatan berupa rumus, jadi ikut berubah begitu Sim Gaji atau ' +
    'Acress diubah.',
    REK_KOL, { bold: false, size: 9, color: 'FF98A2B3' })
  wsRek.addRow([])

  const headerRek = wsRek.addRow(KOLOM_REK.map(c => c.header))
  styleHeader(headerRek, REK_KOL)
  KOLOM_REK.forEach((c, i) => { wsRek.getColumn(i + 1).width = c.width })

  const barisPertamaRek = headerRek.number + 1
  // kodeSkpd -> { gol: { kunci: { sub, awal, akhir } }, subtotalGol: [], total }
  const petaBarisDinas = new Map()
  // `${kodeSkpd}|${kodeRekening}` -> nomor barisnya di sheet ini, dipakai
  // sheet PROYEKSI DINAS supaya angkanya menunjuk ke sini, bukan disalin.
  const barisRekening = new Map()

  for (const s of k.skpd) {
    const isi = s.rekening.filter(r => !r.kosong)
    barisBand(wsRek, s.namaSkpd, `${s.kodeSkpd} · ${isi.length} rekening`, REK_KOL)
    const info = { gol: {}, subtotalGol: [] }
    petaBarisDinas.set(s.kodeSkpd, info)
    // Kolam tiap golongan, dikumpulkan untuk catatan baris TOTAL dinas.
    const golDinas = []

    for (const g of kelompokkanGolongan(isi, petaGol, canonicalGol)) {
      // Baris pembatas blok golongan — PNS dulu, baru PPPK.
      const band = wsRek.addRow([`  ${g.label}`, `${g.rows.length} rekening`])
      for (let c = 1; c <= REK_KOL; c++) {
        band.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F8FD' } }
        band.getCell(c).border = garis()
      }
      band.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF475467' } }
      band.getCell(2).font = { size: 9, italic: true, color: { argb: 'FF98A2B3' } }
      band.height = 15

      const awal = wsRek.rowCount + 1
      // Rentang baris golongan ini sudah pasti sebelum barisnya ditulis, jadi
      // catatan tiap rekening bisa merujuk kolam golongannya lebih dulu.
      const golF = rumusGolongan(awal, awal + g.rows.length - 1)
      const golNilai = nilaiGolongan(g.rows, r => proyeksiAkhirRek(r) - r.pagu, proyeksiAkhirRek)
      for (const r of g.rows) {
        const n = wsRek.rowCount + 1
        barisRekening.set(`${s.kodeSkpd}|${r.kodeRekening}`, n)
        // Geser yang ditulis di baris ini khusus BULAN DEPAN — itu yang
        // dikerjakan waktu daftar gaji bulan depan disusun. Pergeseran bulan
        // sesudahnya ada di sheet JAWABAN, di baris bulannya masing-masing.
        const masukOkt = r.masukBulanDepan || 0
        const keluarOkt = r.keluarBulanDepan || 0
        const rencanaOkt = r.sp2d + r.sim + masukOkt - keluarOkt
        const proyeksi = proyeksiAkhirRek(r)
        const nilai = {
          G: r.pagu - r.sp2d - r.sim, H: masukOkt, I: keluarOkt, L: r.tambahanFix, M: proyeksi,
          N: proyeksi - r.pagu, O: proyeksi - r.tambahanFix - r.pagu, luarGol: golNilai.luar,
        }
        // Fallback ke rata-rata ditulis sebagai ANGKA di dalam rumus, bukan kolom
        // tersendiri: begitu sel Sim Gaji dikosongkan pemakai, barisnya kembali
        // memakai rata-rata dengan sendirinya — sama seperti di backend.
        const row = wsRek.addRow([
          r.kodeRekening, r.namaRekening,
          r.pagu, r.sp2d,
          r.simDariIsian ? r.sim : null,
          { formula: `D${n}+IF(E${n}="",${r.rataRata},E${n})`, result: r.sp2d + r.sim },
          { formula: `C${n}-F${n}`, result: r.pagu - r.sp2d - r.sim },
          // Yang berpindah adalah BEBANNYA, bukan pagunya, dan arahnya menentukan
          // tanda di kolom J (= F + H \u2212 I):
          //   H (masuk)  = beban rekening LAIN yang SPP-nya atas nama rekening
          //                ini, jadi realisasinya BERTAMBAH \u2014 di contoh RSUD,
          //                gaji pokok yang menalangi.
          //   I (keluar) = kebutuhan rekening ini yang SPP-nya atas nama
          //                rekening lain, jadi realisasinya BERKURANG sampai
          //                mentok di anggarannya \u2014 tunjangan jabatan.
          // Tertukar sedikit saja, gaji pokok yang menalangi malah terlihat
          // realisasinya berkurang. Dalam satu golongan-dinas \u03a3H = \u03a3I.
          masukOkt || null,
          keluarOkt || null,
          { formula: `F${n}+H${n}-I${n}`, result: rencanaOkt },
          { formula: `IF(E${n}="",${r.rataRata},E${n})*${REF_LANJUT}`, result: r.sim * bulanLanjut },
          // L — acress dalam RUPIAH, berdiri sendiri supaya kelihatan berapa yang
          //     ditambahkan dan di baris mana. Tambahan fix (flat, khusus
          //     Pembulatan & PPh/Tunsus) dilipat ke sini, bukan kolom baru lagi.
          { formula: `(J${n}+K${n})*${REF_ACRESS}${r.tambahanFix ? `+${REF_FIX}` : ''}`,
            result: r.tambahanFix },
          // M — proyeksi akhir dirantai dari rencana realisasi (J), bukan dari
          //     kebutuhan mentah (F): F belum memperhitungkan bahwa sebagian
          //     kebutuhannya tidak mungkin cair di rekening ini.
          { formula: `J${n}+K${n}+L${n}`, result: proyeksi },
          // N — ditulis PROYEKSI − ANGGARAN, bukan sebaliknya: yang dicari
          //     pembacanya adalah "nambahnya berapa", jadi positif = perlu
          //     ditambah sekian, bukan minus sekian.
          { formula: `M${n}-C${n}`, result: nilai.N },
          // O — sama dengan N tapi tanpa kolom L sama sekali (acress maupun
          //     tambahan fix): kebutuhan polos dari Sim Gaji. Selisih N − O
          //     adalah persis berapa yang disumbang cadangan.
          { formula: `J${n}+K${n}-C${n}`, result: nilai.O },
          catatanRekening(r, n, golF, nilai, bulanPertama, bulanSisa),
        ])
        row.font = { size: 10 }
        for (let c = 1; c <= REK_KOL; c++) row.getCell(c).border = garis()
        row.getCell(1).font = { size: 10, name: 'Consolas' }
        row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: KUNING } }
        if (masukOkt) row.getCell(8).font = { size: 10, bold: true, color: { argb: 'FF067647' } }
        if (keluarOkt) row.getCell(9).font = { size: 10, bold: true, color: { argb: MERAH_TEKS } }
        row.getCell(13).font = { size: 10, bold: true }
        // Warna merah "perlu dari luar dinas" diurus conditional formatting di
        // bawah — kalimatnya rumus, jadi font statis bisa tertinggal.
        row.getCell(KOL_CATATAN).font = { size: 9, italic: true, color: { argb: 'FF667085' } }
        row.getCell(KOL_CATATAN).alignment = { vertical: 'middle', wrapText: true }
        if (r.tanpaPagu) {
          for (let c = 1; c <= REK_KOL; c++) {
            if (c === 5) continue
            row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } }
          }
          row.getCell(KOL_CATATAN).font = { size: 9, bold: true, color: { argb: AMBER_TEKS } }
        }
      }

      const akhir = wsRek.rowCount
      const jum = (kol) => (akhir >= awal ? `SUM(${kol}${awal}:${kol}${akhir})` : '0')
      const ns = akhir + 1
      const sub = wsRek.addRow([
        `SUBTOTAL ${g.label}`, null,
        { formula: jum('C') }, { formula: jum('D') }, { formula: jum('E') },
        { formula: jum('F') },
        { formula: `C${ns}-F${ns}` },
        // Kedua kolom ini WAJIB sama besar: geser dikurung di dalam golongan,
        // jadi yang masuk ke satu rekening pasti keluar dari rekening lain di
        // blok yang sama. Kalau berbeda, ada yang salah — bukan ada uang baru.
        { formula: jum('H') }, { formula: jum('I') },
        { formula: jum('J') },
        { formula: jum('K') }, { formula: jum('L') }, { formula: jum('M') },
        { formula: `M${ns}-C${ns}` },
        { formula: `J${ns}+K${ns}-C${ns}` },
        { formula: `IF(H${ns}=I${ns},"Geser masuk = geser keluar \u2014 zero-sum dalam golongan ini","PERIKSA: masuk \u2260 keluar")` },
      ])
      styleSubtotal(sub, REK_KOL)
      info.gol[g.kunci] = { sub: sub.number, awal, akhir }
      info.subtotalGol.push(sub.number)
      golDinas.push({ f: golF, nilai: golNilai })
    }

    const nt = wsRek.rowCount + 1
    const jumGol = (kol) => info.subtotalGol.map(b => `${kol}${b}`).join('+') || '0'
    const total = wsRek.addRow([
      `TOTAL ${s.namaSkpd}`, null,
      { formula: jumGol('C') }, { formula: jumGol('D') }, { formula: jumGol('E') },
      { formula: jumGol('F') },
      { formula: `C${nt}-F${nt}` },
      { formula: jumGol('H') }, { formula: jumGol('I') },
      { formula: jumGol('J') },
      { formula: jumGol('K') }, { formula: jumGol('L') }, { formula: jumGol('M') },
      { formula: `M${nt}-C${nt}` },
      { formula: `J${nt}+K${nt}-C${nt}` },
      catatanTotalDinas(golDinas.map(g => g.f), {
        kurang: golDinas.reduce((a, g) => a + g.nilai.kurang, 0),
        luar: golDinas.reduce((a, g) => a + g.nilai.luar, 0),
        baru: golDinas.reduce((a, g) => a + g.nilai.baru, 0),
      }),
    ])
    styleBarisTotal(total, REK_KOL)
    total.getCell(KOL_CATATAN).font = { size: 9, bold: true, color: { argb: 'FF475467' } }
    total.getCell(KOL_CATATAN).alignment = { vertical: 'middle', wrapText: true }
    info.total = total.number
    wsRek.addRow([])
  }

  const barisTerakhirRek = wsRek.rowCount
  aturanSelisihKurang(wsRek, 'G', barisPertamaRek, barisTerakhirRek)
  aturanKurangMerah(wsRek, 'N', barisPertamaRek, barisTerakhirRek)
  aturanKurangMerah(wsRek, 'O', barisPertamaRek, barisTerakhirRek)
  aturanCatatanLuar(wsRek, 'P', barisPertamaRek, barisTerakhirRek)
  for (const kol of ['C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'L', 'M']) wsRek.getColumn(kol).numFmt = FMT_RP
  wsRek.getColumn('G').numFmt = FMT_RP_MERAH
  // Bertanda: merah + = perlu ditambah, biru − = anggarannya berlebih.
  for (const kol of ['N', 'O']) wsRek.getColumn(kol).numFmt = FMT_PERGESERAN
  wsRek.pageSetup.printTitlesRow = `${headerRek.number}:${headerRek.number}`

  // ---- PROYEKSI DINAS: lembar ringkas untuk dikirim ke dinas ----
  //
  // Satu dinas = satu blok, tinggal dipotong dan dikirim. Isinya cuma yang perlu
  // mereka tahu: rekening apa, dan berapa yang harus disiapkan sampai Desember.
  // Angkanya RUMUS yang menunjuk kolom PROYEKSI AKHIR di sheet PER REKENING,
  // jadi tidak pernah bisa menyimpang dari lembar kerjanya sendiri.
  const KOLOM_KIRIM = [
    { header: 'Kode Rekening', width: 22 },
    { header: 'Nama Rekening', width: 46 },
    { header: 'PROYEKSI AKHIR\n(kebutuhan s.d. Desember)', width: 22 },
  ]
  const KIRIM_KOL = KOLOM_KIRIM.length

  judul(wsKirim, 'PROYEKSI KEBUTUHAN BELANJA GAJI SAMPAI AKHIR TAHUN', KIRIM_KOL, { size: 14, height: 22 })
  judul(wsKirim, `TA ${tahun} \u00b7 Rekening ${prefix}* \u00b7 Realisasi ${labelRealisasi} \u00b7 sisa ${bulanSisa} bulan (${rentangSisa})`,
    KIRIM_KOL, { bold: false, size: 10, color: 'FF667085' })
  judul(wsKirim,
    `Angka di kolom PROYEKSI AKHIR adalah kebutuhan tiap rekening sampai Desember menurut isian Sim Gaji: ` +
    `realisasi ${labelRealisasi} ditambah nilai sebulan dikali ${bulanSisa} bulan. Mohon dibandingkan dengan ` +
    'perhitungan masing-masing dinas; kalau berbeda, selisihnya ada di nilai Sim Gaji sebulan yang dipakai.',
    KIRIM_KOL, { bold: false, size: 9, color: 'FF667085' })
  judul(wsKirim,
    'Dipisah blok PNS dan PPPK, masing-masing ditutup SUBTOTAL, lalu TOTAL per dinas. Satu dinas satu blok \u2014 ' +
    'tinggal dipotong per blok untuk dikirim. Rincian anggaran, kekurangan bulan depan, dan usulan pergeserannya ' +
    'ada di sheet PER REKENING dan JAWABAN.',
    KIRIM_KOL, { bold: false, size: 9, color: 'FF98A2B3' })
  wsKirim.addRow([])

  const headerKirim = wsKirim.addRow(KOLOM_KIRIM.map(c => c.header))
  styleHeader(headerKirim, KIRIM_KOL)
  KOLOM_KIRIM.forEach((c, i) => { wsKirim.getColumn(i + 1).width = c.width })

  for (const s of k.skpd) {
    const isi = s.rekening.filter(r => !r.kosong)
    barisBand(wsKirim, s.namaSkpd, s.kodeSkpd, KIRIM_KOL)
    const subtotalKirim = []

    for (const g of kelompokkanGolongan(isi, petaGol, canonicalGol)) {
      const band = wsKirim.addRow([`  ${g.label}`, `${g.rows.length} rekening`])
      for (let c = 1; c <= KIRIM_KOL; c++) {
        band.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F8FD' } }
        band.getCell(c).border = garis()
      }
      band.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF475467' } }
      band.getCell(2).font = { size: 9, italic: true, color: { argb: 'FF98A2B3' } }
      band.height = 15

      const awal = wsKirim.rowCount + 1
      for (const r of g.rows) {
        const asal = barisRekening.get(`${s.kodeSkpd}|${r.kodeRekening}`)
        // Nilai cache disusun sama persis dengan kolom M di PER REKENING \u2014
        // rencana realisasi bulan depan (sudah memperhitungkan geser) + bulan
        // sesudahnya + acress/fix. Kalau diisi butuhAkhir mentah, pembaca yang
        // tidak menghitung ulang rumus akan melihat angka yang meleset sebesar
        // pergeseran bulan depan.
        const proyeksi = proyeksiAkhirRek(r)
        const row = wsKirim.addRow([
          r.kodeRekening, r.namaRekening,
          asal ? { formula: `'PER REKENING'!M${asal}`, result: proyeksi } : proyeksi,
        ])
        row.font = { size: 10 }
        for (let c = 1; c <= KIRIM_KOL; c++) row.getCell(c).border = garis()
        row.getCell(1).font = { size: 10, name: 'Consolas' }
        row.getCell(3).font = { size: 10, bold: true }
      }

      const akhir = wsKirim.rowCount
      const sub = wsKirim.addRow([
        `SUBTOTAL ${g.label}`, null,
        { formula: akhir >= awal ? `SUM(C${awal}:C${akhir})` : '0' },
      ])
      styleSubtotal(sub, KIRIM_KOL)
      subtotalKirim.push(sub.number)
    }

    const total = wsKirim.addRow([
      `TOTAL ${s.namaSkpd}`, null,
      { formula: subtotalKirim.map(b => `C${b}`).join('+') || '0' },
    ])
    styleBarisTotal(total, KIRIM_KOL)
    wsKirim.addRow([])
  }
  wsKirim.getColumn('C').numFmt = FMT_RP
  wsKirim.pageSetup.printTitlesRow = `${headerKirim.number}:${headerKirim.number}`

  // ---- PER DINAS ----
  //
  // Dikelompokkan per golongan pegawai lintas dinas — blok PNS berisi SELURUH
  // dinas, baru blok PPPK — seperti sheet REKAP di berkas export utama. Kolom
  // rupiahnya menarik dari baris SUBTOTAL golongan di sheet PER REKENING, jadi
  // ikut berubah begitu Sim Gaji atau Acress diubah.
  //
  // Kolom "Kurang"/"Surplus" memakai SUMIF atas kolom Selisih Akhir di blok
  // golongan itu — bukan selisih agregatnya, karena rekening yang berlebih tidak
  // boleh menutupi rekening yang kurang begitu saja di angka rekapnya. Yang
  // boleh menutup diputuskan di tingkat dinas, dan itu ada di sheet JAWABAN.
  const KOLOM_DINAS = [
    { header: 'No', width: 4 },
    { header: 'Nama SKPD', width: 32 },
    { header: 'Anggaran', width: 16 },
    { header: `Realisasi\n(${labelRealisasi})`, width: 16 },
    { header: `Realisasi + Sim Gaji\n(posisi ${labelBulanDepan})`, width: 16 },
    { header: `Selisih ${labelBulanDepan}`, width: 15 },
    { header: `Geser MASUK ${labelBulanDepan}`, width: 14 },
    { header: `Geser KELUAR ${labelBulanDepan}`, width: 14 },
    { header: `Rencana Realisasi ${labelBulanDepan}`, width: 16 },
    { header: 'Acress + Tambahan Fix\n(Rp)', width: 15 },
    { header: 'PROYEKSI AKHIR\n(butuh s.d. Desember)', width: 17 },
    { header: `Perlu Ditambah\n(Proyeksi \u2212 Anggaran)`, width: 16 },
    { header: 'Sisa Kurang\n(perlu dari luar)', width: 15 },
    { header: 'Surplus Nganggur\n(tidak terpakai)', width: 15 },
    ...bulanSisaList.map(b => ({ header: `Mentok\n${NAMA_BULAN[b]}`, width: 10 })),
    { header: 'Status', width: 24 },
  ]
  const DINAS_KOL = KOLOM_DINAS.length
  const KOL_STATUS = DINAS_KOL
  const kolHuruf = (i) => String.fromCharCode(64 + i) // cukup untuk <= 26 kolom
  const KOL_MENTOK_AWAL = 15

  judul(wsDinas, 'REKAP KESIAPAN PER DINAS — DIPISAH PNS DAN PPPK', DINAS_KOL, { size: 14, height: 22 })
  judul(wsDinas, `TA ${tahun} · Rekening ${prefix}* · Realisasi ${labelRealisasi} · sisa ${bulanSisa} bulan (${rentangSisa})`,
    DINAS_KOL, { bold: false, size: 10, color: 'FF667085' })
  judul(wsDinas,
    'Satu baris = satu dinas \u00d7 satu golongan. Blok PNS berisi seluruh dinas, baru blok PPPK \u2014 masing-masing ' +
    'ditutup SUBTOTAL. Pemisahan ini bukan soal tampilan: pergeseran memang tidak boleh lintas golongan, jadi satu ' +
    'baris di sini adalah satu kolam yang sesungguhnya. Kolom "Geser MASUK" dan "Geser KELUAR" pasti sama besar di ' +
    'tiap baris \u2014 uangnya cuma berpindah di dalam kolam itu.',
    DINAS_KOL, { bold: false, size: 9, color: 'FF667085' })
  judul(wsDinas,
    'Kolom "Sisa Kurang" = yang tetap tidak tertutup walau seluruh rekening segolongan di dinas itu sudah diperas; ' +
    'inilah yang harus naik ke kabupaten. Kolom "Surplus Nganggur" = surplus yang ADA tapi tidak bisa dipakai karena ' +
    'berada di golongan yang lain \u2014 kalau dua kolom itu sama-sama berisi di satu dinas, di situlah aturan ' +
    '"PNS dari PNS, PPPK dari PPPK" benar-benar memakan biaya.',
    DINAS_KOL, { bold: false, size: 9, color: 'FF98A2B3' })
  judul(wsDinas,
    'Kolom "Mentok <Bulan>" = berapa rekening di golongan itu yang sisa anggarannya habis di bulan tersebut. Angka ' +
    'ini TIDAK terpengaruh sel Acress \u2014 acress soal cadangan yang pantas, bukan soal kapan uang di rekening ' +
    'habis. Rincian rekening pemberi dan penerimanya ada di sheet PER REKENING dan JAWABAN.',
    DINAS_KOL, { bold: false, size: 9, color: 'FF98A2B3' })
  wsDinas.addRow([])

  const headerDinas = wsDinas.addRow(KOLOM_DINAS.map(c => c.header))
  styleHeader(headerDinas, DINAS_KOL)
  KOLOM_DINAS.forEach((c, i) => { wsDinas.getColumn(i + 1).width = c.width })

  const barisPertamaDinas = headerDinas.number + 1
  const subtotalGolDinas = []
  for (const kunci of canonicalGol) {
    const golLabel = petaGol.get(kunci) || kunci
    barisBand(wsDinas, golLabel, `${k.skpd.length} dinas`, DINAS_KOL)
    const awal = wsDinas.rowCount + 1

    k.skpd.forEach((s, i) => {
      const info = petaBarisDinas.get(s.kodeSkpd)?.gol?.[kunci]
      if (!info) return
      const n = wsDinas.rowCount + 1
      const ref = (kol) => `'PER REKENING'!${kol}${info.sub}`
      const rentang = (kol) => `'PER REKENING'!${kol}${info.awal}:${kol}${info.akhir}`
      const rek = s.rekening.filter(r => !r.kosong && (r.golongan || '-') === kunci)
      const mentok = bulanSisaList.map(b => rek.filter(r => r.bulanMentok === b).length || null)
      const adaBaris = info.akhir >= info.awal
      const gol = s.golongan.find(x => x.kunci === kunci)
      const row = wsDinas.addRow([
        i + 1, s.namaSkpd,
        { formula: ref('C') }, { formula: ref('D') }, { formula: ref('F') },
        { formula: `C${n}-E${n}` },
        { formula: ref('H') }, { formula: ref('I') }, { formula: ref('J') },
        { formula: ref('L') }, { formula: ref('M') },
        { formula: `K${n}-C${n}` },
        // Nilai jadi dari simulasi bulanan Okt\u2013Des, bukan SUMIF atas kolom
        // "Selisih Akhir": kolom itu cuma memperhitungkan pergeseran Oktober,
        // sedangkan dua angka ini hasil seluruh sisa bulan. Kalau diambil dari
        // sheet, RINGKASAN dan PER DINAS akan berbeda untuk satu pertanyaan.
        gol?.sisaKurang ?? 0,
        Math.max(0, (gol?.surplusTersedia ?? 0) - ((gol?.gapKotor ?? 0) - (gol?.sisaKurang ?? 0))),
        ...mentok,
        { formula: `IF(M${n}>0,"perlu dari luar dinas",IF(H${n}>0,"cukup dari golongan ini","aman"))` },
      ])
      row.font = { size: 10 }
      for (let c = 1; c <= DINAS_KOL; c++) row.getCell(c).border = garis()
      row.getCell(1).alignment = { horizontal: 'center' }
      for (let c = KOL_MENTOK_AWAL; c <= KOL_STATUS; c++) row.getCell(c).alignment = { horizontal: 'center' }
      row.getCell(11).font = { size: 10, bold: true }
      if (gol && gol.sisaKurang > 0) {
        for (let c = 1; c <= DINAS_KOL; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MERAH } }
        }
        row.getCell(KOL_STATUS).font = { size: 9, bold: true, color: { argb: MERAH_TEKS } }
      }
    })

    const akhir = wsDinas.rowCount
    const ns = akhir + 1
    const jum = (kol) => (akhir >= awal ? `SUM(${kol}${awal}:${kol}${akhir})` : '0')
    const sub = wsDinas.addRow([
      null, `SUBTOTAL ${golLabel}`,
      { formula: jum('C') }, { formula: jum('D') }, { formula: jum('E') },
      { formula: `C${ns}-E${ns}` },
      { formula: jum('G') }, { formula: jum('H') },
      { formula: jum('I') }, { formula: jum('J') }, { formula: jum('K') },
      { formula: `K${ns}-C${ns}` },
      { formula: jum('M') }, { formula: jum('N') },
      ...bulanSisaList.map((_, i) => ({ formula: jum(kolHuruf(KOL_MENTOK_AWAL + i)) })),
      null,
    ])
    styleSubtotal(sub, DINAS_KOL)
    subtotalGolDinas.push(sub.number)
  }

  const nTot = wsDinas.rowCount + 1
  const jumTot = (kol) => subtotalGolDinas.map(b => `${kol}${b}`).join('+') || '0'
  const totalDinas = wsDinas.addRow([
    'TOTAL', null,
    { formula: jumTot('C') }, { formula: jumTot('D') }, { formula: jumTot('E') },
    { formula: `C${nTot}-E${nTot}` },
    { formula: jumTot('G') }, { formula: jumTot('H') },
    { formula: jumTot('I') }, { formula: jumTot('J') }, { formula: jumTot('K') },
    { formula: `K${nTot}-C${nTot}` },
    { formula: jumTot('M') }, { formula: jumTot('N') },
    ...bulanSisaList.map((_, i) => ({ formula: jumTot(kolHuruf(KOL_MENTOK_AWAL + i)) })),
    null,
  ])
  styleBarisTotal(totalDinas, DINAS_KOL)
  const BARIS_TOTAL_DINAS = totalDinas.number

  aturanSelisihKurang(wsDinas, 'F', barisPertamaDinas, BARIS_TOTAL_DINAS)
  aturanKurangMerah(wsDinas, 'L', barisPertamaDinas, BARIS_TOTAL_DINAS)
  aturanKurangMerah(wsDinas, 'M', barisPertamaDinas, BARIS_TOTAL_DINAS)
  for (const kol of ['C', 'D', 'E', 'G', 'H', 'I', 'J', 'K', 'M', 'N']) wsDinas.getColumn(kol).numFmt = FMT_RP
  wsDinas.getColumn('F').numFmt = FMT_RP_MERAH
  wsDinas.getColumn('L').numFmt = FMT_PERGESERAN
  wsDinas.pageSetup.printTitlesRow = `${headerDinas.number}:${headerDinas.number}`

  // ---- JAWABAN ----
  //
  // Satu baris per rekening yang akan mentok, urut bulan mentok lalu kekurangan
  // menurun — inilah yang dicetak dan dibawa. Angkanya NILAI JADI, bukan rumus:
  // begitu Sim Gaji diubah, penetapan sumbernya sudah tidak berlaku lagi dan
  // lembar ini harus dibuat ulang dari aplikasi, bukan dibiarkan terhitung
  // setengah-setengah.
  const KOLOM_JAWAB = [
    { header: 'No', width: 4 },
    { header: 'Dinas', width: 28 },
    { header: 'Gol', width: 7 },
    { header: 'Kode Rek', width: 20 },
    { header: 'Nama Rekening', width: 26 },
    { header: 'Mentok\nBulan', width: 10 },
    { header: 'Kurang Saat\nMentok', width: 14 },
    { header: 'Kurang s.d. Des\n(yang perlu digeser)', width: 15 },
    { header: 'Ambil Dari\n(rekening di dinas yang sama)', width: 38 },
    { header: 'Nilai', width: 14 },
    { header: 'Total\nDiambil', width: 14 },
    { header: 'Sisa Kurang\n(perlu dari luar)', width: 14 },
    { header: 'Status', width: 24 },
  ]
  const JAWAB_KOL = KOLOM_JAWAB.length

  judul(wsJawab, 'JAWABAN — REKENING MENTOK & SUMBER PERGESERANNYA', JAWAB_KOL, { size: 14, height: 22 })
  judul(wsJawab, `TA ${tahun} · Rekening ${prefix}* · Realisasi ${labelRealisasi} · sisa ${bulanSisa} bulan (${rentangSisa})`,
    JAWAB_KOL, { bold: false, size: 10, color: 'FF667085' })
  judul(wsJawab,
    'Satu baris = satu rekening yang sisa anggarannya akan habis sebelum Desember, urut bulan mentok lalu kekurangan ' +
    'terbesar. Kolom "Ambil Dari" sudah memilihkan rekening sumbernya: gaji pokok lebih dulu selama masih surplus, ' +
    'lalu surplus terbesar. Sumber selalu dari dinas yang sama DAN golongan yang sama — kekurangan PNS ditutup ' +
    'dari rekening PNS, PPPK dari PPPK, seperti yang memang dikerjakan waktu daftar gaji disusun. Yang tidak cukup ' +
    'ditandai "perlu dari luar dinas", karena keputusan menarik dari dinas lain bukan milik lembar ini.',
    JAWAB_KOL, { bold: false, size: 9, color: 'FF667085' })
  judul(wsJawab,
    'Dua kolom "Kurang" menjawab dua pertanyaan berbeda: "Kurang Saat Mentok" = yang dibutuhkan supaya bulan itu ' +
    'terlewati, "Kurang s.d. Des" = seluruh yang perlu digeser sampai tutup tahun. Rekening bisa aman melewati bulan ' +
    'mentoknya dari surplus dinas sendiri tapi tetap kurang sampai Desember — di situ statusnya "sebagian perlu ' +
    'dari luar dinas". Yang mentok lebih dulu dilayani lebih dulu dari surplus dinasnya.',
    JAWAB_KOL, { bold: false, size: 9, color: 'FF98A2B3' })
  wsJawab.addRow([])

  const headerJawab = wsJawab.addRow(KOLOM_JAWAB.map(c => c.header))
  styleHeader(headerJawab, JAWAB_KOL)
  KOLOM_JAWAB.forEach((c, i) => { wsJawab.getColumn(i + 1).width = c.width })

  // Rekening mentok dulu (urut bulan, lalu kekurangan menurun), baru rekening
  // yang belum berpagu sama sekali — kasusnya beda (perlu anggaran baru, bukan
  // geser) tapi tetap harus terlihat di lembar yang sama.
  const barisJawab = []
  for (const s of k.skpd) {
    for (const r of s.rekening) {
      if (r.bulanMentok != null) barisJawab.push({ s, r, urut: 0 })
      else if (r.tanpaPagu) barisJawab.push({ s, r, urut: 1 })
    }
  }
  barisJawab.sort((a, b) =>
    a.urut - b.urut ||
    (a.r.bulanMentok ?? 99) - (b.r.bulanMentok ?? 99) ||
    b.r.kurangSaatMentok - a.r.kurangSaatMentok ||
    b.r.butuhAkhir - a.r.butuhAkhir)

  const barisPertamaJawab = headerJawab.number + 1
  barisJawab.forEach(({ s, r }, i) => {
    const sumber = daftarSumber(r)
    const row = wsJawab.addRow([
      i + 1, s.namaSkpd, petaGol.get(r.golongan || '-') || '—',
      r.kodeRekening, r.namaRekening,
      namaBulan(r.bulanMentok),
      r.kurangSaatMentok || null,
      r.tanpaPagu ? r.butuhAkhir : r.kurangTunai,
      sumber.teks || (r.tanpaPagu ? '—'
        : s.surplusTersedia > 0 ? 'surplus segolongan sudah habis dipakai rekening lain'
        : 'tidak ada rekening segolongan yang bersurplus'),
      sumber.nilai || '—',
      r.keluarBulanDepan || null,
      r.tanpaPagu ? r.butuhAkhir : r.sisaKurang,
      statusRekening(r),
    ])
    row.font = { size: 10 }
    row.height = Math.max(18, (sumber.baris || 1) * 14)
    for (let c = 1; c <= JAWAB_KOL; c++) {
      row.getCell(c).border = garis()
      row.getCell(c).alignment = { vertical: 'top', wrapText: true }
    }
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'top' }
    row.getCell(3).alignment = { horizontal: 'center', vertical: 'top' }
    row.getCell(4).font = { size: 10, name: 'Consolas' }
    row.getCell(6).alignment = { horizontal: 'center', vertical: 'top' }
    row.getCell(6).font = { size: 10, bold: true }
    row.getCell(9).font = { size: 9, name: 'Consolas' }
    row.getCell(10).alignment = { horizontal: 'right', vertical: 'top', wrapText: true }
    row.getCell(10).font = { size: 9 }
    row.getCell(13).font = { size: 9, bold: true }
    if (r.tanpaPagu) {
      for (let c = 1; c <= JAWAB_KOL; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMBER } }
      }
      row.getCell(13).font = { size: 9, bold: true, color: { argb: AMBER_TEKS } }
    } else if (r.sisaKurang > 0) {
      for (let c = 1; c <= JAWAB_KOL; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MERAH } }
      }
      row.getCell(13).font = { size: 9, bold: true, color: { argb: MERAH_TEKS } }
    } else {
      row.getCell(13).font = { size: 9, color: { argb: 'FF067647' } }
    }
  })

  if (barisJawab.length) {
    const nTotal = wsJawab.rowCount + 1
    const jumJawab = (kol) => `SUM(${kol}${barisPertamaJawab}:${kol}${nTotal - 1})`
    const total = wsJawab.addRow([
      'TOTAL', `${barisJawab.length} rekening`, null, null, null, null,
      { formula: jumJawab('G') }, { formula: jumJawab('H') },
      null, null,
      { formula: jumJawab('K') }, { formula: jumJawab('L') }, null,
    ])
    styleBarisTotal(total, JAWAB_KOL)
    wsJawab.autoFilter = {
      from: { row: headerJawab.number, column: 1 },
      to: { row: nTotal - 1, column: JAWAB_KOL },
    }
  } else {
    const kosong = wsJawab.addRow([null, 'Tidak ada rekening yang mentok sampai Desember.'])
    kosong.getCell(2).font = { size: 10, italic: true, color: { argb: 'FF067647' } }
  }
  wsJawab.pageSetup.printTitlesRow = `${headerJawab.number}:${headerJawab.number}`
  for (const kol of ['G', 'H', 'K', 'L']) wsJawab.getColumn(kol).numFmt = FMT_RP

  // ---- RINGKASAN (badan) ----
  const t = k.total
  const refDinas = (kol) => `'PER DINAS'!${kol}${BARIS_TOTAL_DINAS}`

  wsRingkas.addRow([])
  judul(wsRingkas, 'APAKAH TOTALNYA BERBEDA KALAU GESERNYA SEMBARANG? — TIDAK', RINGKAS_KOL, { size: 12, height: 20 })
  judul(wsRingkas,
    'Dua jalan yang bisa ditempuh: (A) tiap bulan dilihat mana yang minus lalu ditutup dari rekening lain — ' +
    'berulang sampai Desember; (B) minus bulanan diabaikan, anggaran tiap rekening langsung disediakan sampai akhir ' +
    'tahun. Kedua jalan berakhir di angka yang SAMA, karena kebutuhan tiap rekening (realisasi + Sim Gaji × sisa ' +
    'bulan) tidak memuat suku anggaran sama sekali dan pergeseran itu sendiri zero-sum. Yang berbeda cuma berapa kali ' +
    'harus mengurus pergeserannya, bukan berapa rupiah yang dibutuhkan.',
    RINGKAS_KOL, { bold: false, size: 9, color: 'FF667085' })

  barisAngka(wsRingkas, 'Anggaran sekarang (seluruh rekening gaji)',
    { formula: refDinas('C'), result: k.skpd.reduce((a, s) => a + s.pagu, 0) },
    'jalan mana pun yang ditempuh, angka ini tidak bertambah dengan sendirinya', { numFmt: FMT_RP })
  barisAngka(wsRingkas, 'Proyeksi akhir (butuh s.d. Desember)',
    { formula: refDinas('K'), result: k.skpd.reduce((a, s) => a + s.butuhAkhir, 0) },
    'KEKAL terhadap geser — ini jawaban pertanyaan di atas', { numFmt: FMT_RP })
  barisAngka(wsRingkas, 'Perlu ditambah (Proyeksi − Anggaran)',
    { formula: `${refDinas('K')}-${refDinas('C')}`, result: k.skpd.reduce((a, s) => a + s.butuhAkhir - s.pagu, 0) },
    'positif = segitulah tambahan yang dibutuhkan; negatif = anggaran gaji sekabupaten masih berlebih', { numFmt: FMT_RP_MERAH })
  wsRingkas.addRow([])

  judul(wsRingkas, 'ANGKA ACUAN', RINGKAS_KOL, { size: 12, height: 20 })
  barisAngka(wsRingkas, `Kekurangan ${labelBulanDepan} (bulan terdekat)`, t.kurangOkt,
    `${t.rekMentok[bulanPertama] || 0} rekening di ${t.dinasKenaOkt} dinas · ${t.dinasPerluLuarOkt} dinas perlu dari luar dinas`,
    { numFmt: FMT_RP })
  for (const b of bulanSisaList) {
    barisAngka(wsRingkas, `Rekening mentok ${NAMA_BULAN[b]}`, t.rekMentok[b] || 0,
      b === bulanPertama ? 'sisa anggarannya habis di bulan ini' : 'baru habis di bulan ini', { numFmt: '0' })
  }
  wsRingkas.addRow([])

  barisAngka(wsRingkas, 'Kekurangan akhir tahun, TANPA geser',
    { formula: `${refDinas('G')}+${refDinas('M')}`, result: t.kurangKotor },
    'Σ kekurangan tiap rekening kalau tidak ada pergeseran sama sekali', { numFmt: FMT_RP })
  barisAngka(wsRingkas, 'Tertutup dari rekening segolongan di dinas yang sama',
    { formula: refDinas('G'), result: t.ditutupDalamDinas },
    'diselesaikan di meja dinas masing-masing — PNS dari PNS, PPPK dari PPPK', { numFmt: FMT_RP })
  barisAngka(wsRingkas, 'Kekurangan akhir tahun, SETELAH geser dalam dinas',
    { formula: refDinas('M'), result: t.kurangSetelahTutup },
    `di ${t.dinasPerluLuar} dinas — inilah yang harus naik ke kabupaten`, { numFmt: FMT_RP })
  barisAngka(wsRingkas, 'Surplus yang NGANGGUR (terkunci di golongan lain)',
    { formula: refDinas('N'), result: t.surplusNganggur },
    'surplus yang ADA tapi tidak bisa dipakai — inilah ongkos aturan "PNS dari PNS, PPPK dari PPPK"',
    { numFmt: FMT_RP })
  barisAngka(wsRingkas, 'Surplus seluruhnya',
    { formula: `${refDinas('G')}+${refDinas('N')}`, result: t.surplusTotal },
    'terpakai + nganggur', { numFmt: FMT_RP })
  wsRingkas.addRow([])

  barisAngka(wsRingkas, 'Jumlah unit SKPD', t.jumlahDinas, null, { numFmt: '0' })
  barisAngka(wsRingkas, 'Dinas yang seluruhnya aman', t.dinasAman,
    'tidak ada rekening yang kurang sampai Desember', { numFmt: '0' })
  barisAngka(wsRingkas, 'Dinas yang cukup dari rekening sendiri', t.dinasCukupSendiri,
    'perlu pergeseran, tapi seluruhnya di dalam dinasnya', { numFmt: '0' })
  barisAngka(wsRingkas, 'Dinas yang perlu dari luar dinas', t.dinasPerluLuar,
    'surplus rekening sendiri tidak cukup — ini yang perlu keputusan kabupaten', { numFmt: '0' })
  if (t.tanpaPaguJumlah) {
    barisAngka(wsRingkas, 'Rekening belum berpagu tapi Sim Gaji terisi', t.tanpaPaguJumlah,
      `butuh anggaran baru ${rupiah(t.tanpaPaguNilai)} — bukan pergeseran; lihat baris kuning di sheet JAWABAN`,
      { numFmt: '0', fill: AMBER })
  }

  wsRingkas.addRow([])
  judul(wsRingkas, 'YANG PERLU DIBACA SEBELUM ANGKA DI ATAS DIPAKAI', RINGKAS_KOL, { size: 12, height: 20 })
  const catatan = [
    ['Angka ini polos, tanpa cadangan — supaya bisa diadu dengan proyeksi versi dinas.',
      'Proyeksi akhir tiap rekening = realisasi + Sim Gaji × sisa bulan, titik. Tidak ada acress, tidak ada ' +
      'tambahan flat. Kalau meleset dari hitungan orang dinas, selisihnya langsung kelihatan berasal dari isian Sim ' +
      'Gaji-nya, bukan dari asumsi yang ditambahkan diam-diam di sini. Sel Acress di atas dibiarkan 0; naikkan kalau ' +
      'memang mau menguji "bagaimana kalau ditambah cadangan".'],
    ['Geser tidak boleh lintas golongan — dan itu ada ongkosnya.',
      'Waktu daftar gaji disusun, rekening yang kurang ditutup dari rekening lain di golongan yang sama: PNS dari ' +
      'PNS, PPPK dari PPPK, lazimnya dari gaji pokok. Akibatnya surplus PPPK yang menganggur tidak bisa menolong PNS ' +
      'yang kurang di dinas yang sama. Angka "Surplus yang NGANGGUR" di atas adalah besarnya uang yang ada tapi ' +
      'terkunci di golongan yang salah.'],
    ['Pergeseran selalu dua sisi — tidak ada uang yang datang dari mana-mana.',
      'Kolom "Geser MASUK" di rekening yang kurang selalu diimbangi "Geser KELUAR" di rekening lain pada golongan ' +
      'yang sama; di baris SUBTOTAL golongan keduanya pasti sama besar. Yang berpindah adalah anggarannya, bukan ' +
      'kebutuhannya — karena itu kolom PROYEKSI AKHIR tidak ikut bergerak sedikit pun.'],
    ['Digeser SEKALI untuk sampai Desember, bukan tiap bulan.',
      'Kalau pergeserannya sudah cukup menutup kebutuhan sampai Desember, kekurangan bulan-bulan di antaranya ikut ' +
      'tertutup dengan sendirinya — perbendaharaan tidak perlu mengurus pergeseran berulang tiap bulan. Kolom ' +
      '"Selisih Oktober" tetap ditampilkan supaya kelihatan mana yang paling mendesak diurus lebih dulu.'],
    ['Total anggaran yang dibutuhkan KEKAL terhadap geser.',
      'Kebutuhan tiap rekening tidak memuat suku anggaran, dan pergeseran itu sendiri zero-sum. Jadi Σ kebutuhan ' +
      `tetap sama apa pun gesernya — selama gesernya di dalam himpunan rekening ${prefix}*. Kalau sumbernya dari ` +
      'luar belanja gaji, total anggaran gaji jelas bertambah.'],
    ['Selisih "tanpa geser" vs "setelah geser" adalah PEMISAHAN TANGGUNG JAWAB, bukan penurunan kekurangan.',
      `Angka ${rupiah(t.kurangKotor)} turun jadi ${rupiah(t.kurangSetelahTutup)} bukan karena ada uang yang bertambah, ` +
      'melainkan karena bagian yang bisa diselesaikan dinas sendiri sudah dipisahkan dari bagian yang harus naik ke ' +
      'kabupaten. Jangan dibaca sebagai penghematan.'],
    ['Sumber dipilih dari surplus AKHIR TAHUN, bukan sisa anggaran hari ini.',
      'Rekening yang sisa anggarannya masih besar hari ini belum tentu menganggur — bisa jadi memang dibutuhkan ' +
      'bulan depan. Menariknya hanya memindahkan masalah ke rekening itu. Yang dipakai di sini cuma anggaran − ' +
      'proyeksi akhir.'],
    ['Lembar ini tidak memindahkan anggaran antar dinas.',
      'Pooling antar dinas sudah dikerjakan sheet PROYEKSI AKHIR di file export utama. Kalau dikerjakan di sini juga, ' +
      'akan ada dua angka berbeda untuk satu pertanyaan. Dinas yang surplusnya sendiri tidak cukup cuma ditandai.'],
  ]
  for (const [inti, isi] of catatan) {
    const row = wsRingkas.addRow([inti])
    wsRingkas.mergeCells(row.number, 1, row.number, RINGKAS_KOL)
    row.getCell(1).font = { bold: true, size: 10, color: { argb: 'FF1D2939' } }
    const row2 = wsRingkas.addRow([isi])
    wsRingkas.mergeCells(row2.number, 1, row2.number, RINGKAS_KOL)
    row2.getCell(1).font = { size: 9, color: { argb: 'FF667085' } }
    row2.getCell(1).alignment = { vertical: 'top', wrapText: true }
    row2.height = 46
    row2.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HIJAU } }
    row2.getCell(1).border = garis()
  }

  return wb.xlsx.writeBuffer()
}

export function namaFileKesiapan(tahun, prefix, bulanTerakhir) {
  const bln = bulanTerakhir ? `-sd-${String(bulanTerakhir).padStart(2, '0')}` : ''
  return `kesiapan-rekening-gaji-${prefix}-${tahun}${bln}.xlsx`
}
