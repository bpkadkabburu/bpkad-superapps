import { subRincianRekening } from './kodeRekening.js'

// ---- Proyeksi akhir: usulan alokasi anggaran gaji sampai tutup tahun ----
//
// Kebutuhan riil satu dinas sampai Desember = realisasi yang sudah dibayar +
// proyeksi sisa bulan. Di atas angka itu ditambah cadangan (default 2,5%) untuk
// kenaikan gaji berkala, kenaikan pangkat, dan mutasi masuk yang belum terlihat
// di realisasi berjalan.
//
// Pagu gaji sekabupaten diperlakukan sebagai satu kantong: dinas yang pagunya
// berlebih menutup dinas yang kurang. Kalau usulan (kebutuhan + cadangan)
// melebihi isi kantong, kekurangannya disebar ke SEMUA dinas dengan memangkas
// cadangan secara proporsional — cadangan tiap dinas mengecil bersama-sama,
// tetapi tidak ada satu pun dinas yang alokasinya jatuh di bawah kebutuhan
// riilnya sampai Desember. Kalau cadangan sudah habis dipangkas dan kantongnya
// masih kurang juga, selisihnya dilaporkan apa adanya sebagai kekurangan riil
// (butuh tambahan anggaran / pergeseran dari belanja lain) — bukan disebar
// diam-diam sampai ada dinas yang kehabisan gaji.
const DEFAULT_PERSEN_CADANGAN = 2.5

// Rekening Pembulatan Gaji dan Tunjangan PPh/Tunjangan Khusus paling sering
// kurang beberapa ribu-ratus ribu rupiah walau sudah dapat acress — sifatnya
// pembulatan/potongan pajak yang susah ditebak dari tren realisasi. Ditambah
// sekali lagi FLAT (bukan proporsional, bukan ikut dipotong kalau kantong
// kurang) supaya dua rekening ini praktis tidak pernah kurang.
const DEFAULT_TAMBAHAN_FIX = 200000
const POLA_TAMBAHAN_FIX = /pembulatan|tunjangan\s+(khusus|pph)/i
function cocokTambahanFix(namaRekening) {
  return POLA_TAMBAHAN_FIX.test(String(namaRekening || ''))
}

const num = (v) => Number(v) || 0

// Segmen terakhir kode rekening memisahkan golongan pegawai: …00001 = PNS,
// …00002 = PPPK (berlaku di format lama maupun 2026+). Labelnya sengaja TIDAK
// dipaku ke kode, melainkan diambil dari kata terakhir nama rekening
// ("Belanja Gaji Pokok PNS" → PNS). Jadi kalau awalan rekening lain yang dipakai
// atau muncul golongan baru, pengelompokannya tetap benar dan namanya ikut data.
function petaLabelGolongan(daftarSkpd) {
  const kata = new Map()
  for (const s of daftarSkpd) {
    for (const r of s.rekening || []) {
      const kunci = subRincianRekening(r.kodeRekening) || '-'
      if (!kata.has(kunci)) kata.set(kunci, new Set())
      const terakhir = String(r.namaRekening || '').trim().split(/\s+/).pop()
      if (terakhir) kata.get(kunci).add(terakhir.toUpperCase())
    }
  }
  const peta = new Map()
  for (const [kunci, set] of kata) {
    peta.set(kunci, set.size === 1 ? [...set][0] : `Sub rincian ${kunci}`)
  }
  return peta
}

function urutGolonganLaluKode(a, b) {
  return String(a.golongan).localeCompare(String(b.golongan)) ||
    String(a.kodeRekening).localeCompare(String(b.kodeRekening), 'id', { numeric: true })
}

function golonganKosong(kunci, labelPeta) {
  return {
    kunci, label: labelPeta.get(kunci) || kunci,
    jumlahRekening: 0, pagu: 0, sp2d: 0, realisasiTerakhir: 0, perBulanRutin: 0,
    rataRata: 0, kebutuhan: 0, alokasi: 0, tambah: 0, kurangi: 0,
    tambahanFix: 0, tambahanFixJumlah: 0,
    // Basis-independen (sama nilainya baik dihitung dari sisi rumus maupun
    // sisi sim) — jumlah & total isian Sim Gaji di golongan-dinas ini.
    simTotal: 0, simJumlahTerisi: 0,
  }
}

// Subtotal per golongan. Daftar rekeningnya sendiri tidak ikut disalin ke sini —
// pemakainya menyaring dari array rekening yang sudah urut per golongan, supaya
// payload tidak memuat data yang sama dua kali.
//
// `canonicalGol` (opsional) = daftar seluruh golongan yang ada di data secara
// keseluruhan. Kalau diisi, entri golongan yang tidak dimiliki dinas ini (mis.
// dinas tanpa PPPK) tetap dikembalikan dengan angka nol — bukan hilang — supaya
// sheet Excel bisa selalu menampilkan blok PNS dan PPPK secara seragam.
function kelompokGolongan(rekening, labelPeta, canonicalGol) {
  const map = new Map()
  for (const kunci of canonicalGol || []) map.set(kunci, golonganKosong(kunci, labelPeta))
  for (const r of rekening) {
    let g = map.get(r.golongan)
    if (!g) { g = golonganKosong(r.golongan, labelPeta); map.set(r.golongan, g) }
    g.jumlahRekening += 1
    g.pagu += r.pagu
    g.sp2d += r.sp2d
    g.realisasiTerakhir += r.realisasiTerakhir
    g.perBulanRutin += r.perBulanRutin
    g.rataRata += r.rataRata
    g.kebutuhan += r.kebutuhan
    g.alokasi += r.alokasi
    g.tambahanFix += r.tambahanFix || 0
    if (r.tambahanFix) g.tambahanFixJumlah += 1
    if (r.sim != null) { g.simTotal += r.sim; g.simJumlahTerisi += 1 }
    if (r.pergeseran > 0) g.tambah += r.pergeseran
    else if (r.pergeseran < 0) g.kurangi += r.pergeseran
  }
  for (const g of map.values()) {
    g.pergeseran = g.alokasi - g.pagu
    g.cadanganAkhir = g.alokasi - g.kebutuhan
    // Laju bayar golongan ini di dinas terkait — dasar kolom "Dibayar (kali)".
    g.dibayar = g.rataRata > 0 ? Math.round((g.sp2d / g.rataRata) * 100) / 100 : 0
  }
  return [...map.values()].sort((a, b) => String(a.kunci).localeCompare(String(b.kunci)))
}

const bulat = (n) => Math.round(Number(n) || 0)

// Pembulatan ke rupiah membuat Σ alokasi meleset beberapa rupiah dari kantong
// yang tersedia. Selisih receh itu ditempelkan ke baris terbesar yang masih
// punya cadangan, supaya Σ alokasi = kantong persis — syarat mutlak kalau
// angkanya dipakai sebagai usulan pergeseran.
function rapikanPembulatan(items, target) {
  let sisa = bulat(target) - items.reduce((a, i) => a + i.alokasi, 0)
  if (!sisa) return
  for (const it of [...items].sort((a, b) => b.alokasi - a.alokasi)) {
    if (!sisa) break
    // Ke bawah hanya boleh sebatas cadangan baris itu; kebutuhan riil tidak
    // boleh tergerus walau cuma satu rupiah.
    const langkah = sisa > 0 ? sisa : -Math.min(-sisa, Math.max(0, it.alokasi - it.kebutuhan))
    it.alokasi += langkah
    sisa -= langkah
  }
}

// Alokasi tiap rekening di dalam satu dinas memakai faktor yang sama dengan
// dinasnya, jadi porsi cadangannya merata dan Σ rekening = alokasi dinas.
//
// Tambahan fix (Pembulatan/Tunjangan Khusus) sengaja DIKELUARKAN dari `faktor`
// — bukan bagian dari kebutuhan yang didistribusikan proporsional, tapi
// tempelan flat di atasnya. Makanya dihitung sebagai kolam terpisah
// (`bonusPool`) yang ditambahkan balik ke `b.alokasi` oleh pemanggil, supaya
// dinas ini tetap dijatah kebutuhan+acress seperti biasa DITAMBAH bonus ini —
// bukan bonus ini menggerus acress rekening lain lewat rapikanPembulatan.
// `kebutuhanRekeningFn(r)` = kebutuhan satu rekening sampai Desember, BELUM
// dibulatkan — basis rumus atau basis sim tergantung siapa yang memanggil
// (lihat hitungSatuBasis). Dilewatkan sebagai fungsi, bukan field statis,
// supaya bagiKeRekening tidak perlu tahu basis mana yang sedang dihitung.
function bagiKeRekening(b, tambahanFix, kebutuhanRekeningFn) {
  const bonusPool = b.terkunci
    ? 0
    : (b._rekening || []).reduce((a, r) => a + (cocokTambahanFix(r.namaRekening) ? tambahanFix : 0), 0)
  const faktor = b.kebutuhan > 0 ? b.alokasi / b.kebutuhan : 0
  const rows = (b._rekening || []).map(r => {
    const pagu = bulat(r.pagu)
    const kebutuhan = bulat(kebutuhanRekeningFn(r))
    const bonus = !b.terkunci && cocokTambahanFix(r.namaRekening) ? tambahanFix : 0
    return {
      kodeRekening: r.kodeRekening,
      namaRekening: r.namaRekening,
      pagu,
      sp2d: bulat(r.sp2d),
      proyeksi: bulat(r.proyeksi),
      kebutuhan,
      // Realisasi bulan terakhir dinas ini — dasar kroscek manual: nilai sebulan
      // dikali sisa bulan harusnya mendekati angka kebutuhannya.
      realisasiTerakhir: bulat(r.realisasiTerakhir),
      // Berapa kali rekening ini dibayar dan berapa nilainya sebulan — pembagi
      // milik rekening itu sendiri, bukan pembagi dinas. Dibawa ke sini supaya
      // kebutuhannya bisa diadu manual: realisasi ÷ dibayar × sisa bulan.
      dibayar: Number(r.dibayar) || 0,
      dibayarPerkiraan: !!r.dibayarPerkiraan,
      perBulanRutin: bulat(r.perBulanRutin),
      rataRata: bulat(r.rataRata),
      tertinggi: bulat(r.tertinggi),
      // >1 = tiga kali bayar terakhir di atas rata-rata tahun berjalan.
      tren: Number(r.tren) || 0,
      // Isian Sim Gaji — basis-independen, dibawa apa adanya (bukan hasil
      // fallback ke rataRata) supaya Excel/web bisa membedakan "beneran diisi"
      // dari "jatuh balik ke rumus karena belum diisi".
      sim: r.sim ?? null,
      deviasiSim: r.deviasiSim ?? null,
      selisihSim: r.selisihSim ?? null,
      golongan: subRincianRekening(r.kodeRekening) || '-',
      alokasi: (b.terkunci ? pagu : bulat(kebutuhan * faktor)) + bonus,
      // Tambahan fix yang menempel di baris ini (0 kalau tidak cocok pola) —
      // dibawa apa adanya supaya kelihatan di Excel/rekap, bukan tersembunyi
      // di dalam angka alokasi gelondongan.
      tambahanFix: bonus,
      // Rekening berpagu yang belum sekali pun dibayar: proyeksinya 0 sehingga
      // alokasinya ikut 0. Sering memang benar (rekening tidak terpakai), tapi
      // bisa juga komponen yang baru dibayar sekali di akhir tahun — ditandai
      // supaya dicek dulu sebelum pagunya ditarik.
      tanpaRealisasi: pagu > 0 && kebutuhan <= 0,
    }
  })
  // Target rapikanPembulatan ikut menghitung bonusPool — kalau tidak, sisa
  // pembulatan akan "menarik balik" persis sebesar bonus yang baru ditambahkan.
  if (!b.terkunci) rapikanPembulatan(rows, b.alokasi + bonusPool)
  for (const r of rows) {
    r.pergeseran = r.alokasi - r.pagu
    r.cadanganAkhir = r.alokasi - r.kebutuhan
  }
  // Urut per golongan dulu, baru per kode: seluruh rekening PNS berkumpul, lalu
  // seluruh rekening PPPK — bukan berselang-seling seperti urutan kode aslinya.
  return { rows: rows.sort(urutGolonganLaluKode), bonusPool }
}

// Kebutuhan riil satu dinas/rekening sampai Desember, dihitung dua basis:
//   'rumus' = realisasi + proyeksi dari tren SP2D (r.proyeksi, sudah basis
//             rata/tertinggi-aware dari hitungProyeksiGaji) — INI DEFAULT,
//             perilakunya persis sama dengan sebelum basis sim ditambahkan.
//   'sim'   = realisasi + isian Sim Gaji × sisa bulan. Rekening yang belum
//             diisi jatuh balik ke rataRata (BUKAN 0) — supaya kantong-pooling
//             tetap punya kebutuhan utuh sekabupaten walau isian baru sebagian.
// Dipisah jadi fungsi privat `hitungSatuBasis` supaya algoritma kantong-
// pooling-nya (yang sudah teruji) dipakai ulang APA ADANYA oleh kedua basis —
// yang beda cuma kebutuhan mana yang dimasukkan. `hitungProyeksiAkhir` di
// bawah memanggilnya dua kali lalu menggabungkan hasilnya jadi satu tree.
function hitungSatuBasis(data, { persen, tambahanFix } = {}, sumberKebutuhan = 'rumus') {
  const p = Number(persen)
  const persenCadangan = Number.isFinite(p) && p >= 0 ? p : DEFAULT_PERSEN_CADANGAN
  const rate = persenCadangan / 100
  const t = Number(tambahanFix)
  const tambahanFixRp = Number.isFinite(t) && t >= 0 ? t : DEFAULT_TAMBAHAN_FIX
  const bulanSisa = num(data.bulanSisa)
  const pakaiSim = sumberKebutuhan === 'sim'
  const kebutuhanRekening = (r) => pakaiSim
    ? num(r.sp2d) + (r.sim != null ? r.sim : num(r.rataRata)) * bulanSisa
    : num(r.sp2d) + num(r.proyeksi)
  const labelPeta = petaLabelGolongan(data.skpd || [])
  // Seluruh golongan yang muncul di data manapun — dipakai supaya tiap dinas
  // selalu punya entri PNS *dan* PPPK (nol kalau memang tidak ada), bukan cuma
  // golongan yang kebetulan dipunyai dinas itu. Dihitung dari kode rekening
  // (sama seperti bagiKeRekening di bawah), bukan dari field `golongan` di
  // payload masuk — field itu opsional/tidak dipakai di sini.
  const canonicalGol = [...new Set((data.skpd || []).flatMap(s => (s.rekening || []).map(r => subRincianRekening(r.kodeRekening) || '-')))]
    .sort((a, b) => String(a).localeCompare(String(b)))

  const baris = (data.skpd || []).map(s => {
    const kebutuhan = bulat(
      pakaiSim
        ? (s.rekening || []).reduce((a, r) => a + kebutuhanRekening(r), 0)
        : num(s.sp2d) + num(s.proyeksi)
    )
    return {
      kodeSkpd: s.kodeSkpd,
      namaSkpd: s.namaSkpd,
      pagu: bulat(s.pagu),
      sp2d: bulat(s.sp2d),
      proyeksi: bulat(s.proyeksi),
      kebutuhan,
      // Angka dasar hitungan, dibawa apa adanya supaya proyeksinya bisa diadu
      // manual: realisasi bulan terakhir × sisa bulan ≈ kebutuhan sisa bulan.
      bulanTerakhirSkpd: s.bulanTerakhirSkpd ?? null,
      realisasiTerakhir: bulat(s.realisasiTerakhir),
      sp2dTerakhir: num(s.sp2dTerakhir),
      perBulanRutin: bulat(s.perBulanRutin),
      // Dua kandidat "nilai sekali bayar" dibawa apa adanya: layar memakainya
      // untuk memperlihatkan selisih antara basis rata-rata dan basis tertinggi,
      // dan tren >1 dipakai memperingatkan dinas yang gajinya sedang naik.
      rataRata: bulat(s.rataRata),
      tertinggi: bulat(s.tertinggi),
      tren: num(s.tren),
      bulanGajiTerbayar: num(s.bulanGajiTerbayar),
      medianBulan: bulat(s.medianBulan),
      // Nilai bulan terakhir dibanding satu bulan rutin (median). Di atas ~1,4
      // berarti bulan itu memuat lebih dari satu kali gaji — lazimnya THR atau
      // gaji ke-13, kadang rapel kenaikan — jadi angkanya tidak boleh dipakai
      // mentah-mentah sebagai "gaji sebulan". Jumlah SP2D saja bukan penanda:
      // PNS dan PPPK memang lazim terbit SP2D sendiri-sendiri tiap bulan.
      rasioTerakhir: num(s.medianBulan) > 0
        ? Math.round((num(s.realisasiTerakhir) / num(s.medianBulan)) * 100) / 100
        : 0,
      // Dinas tanpa realisasi sekaligus tanpa proyeksi tidak punya dasar hitung.
      // Pagunya dikunci apa adanya, bukan dinolkan lalu ditarik ke kantong
      // bersama — belum tentu benar-benar tidak dipakai.
      terkunci: kebutuhan <= 0,
      pembagiPerkiraan: !!s.pembagiPerkiraan,
      _rekening: s.rekening || [],
    }
  })

  const aktif = baris.filter(b => !b.terkunci)
  const kantong = aktif.reduce((a, b) => a + b.pagu, 0)
  const paguTerkunci = baris.reduce((a, b) => a + (b.terkunci ? b.pagu : 0), 0)
  const totalKebutuhan = aktif.reduce((a, b) => a + b.kebutuhan, 0)
  const totalCadangan = totalKebutuhan * rate
  const totalIdeal = totalKebutuhan + totalCadangan

  // Berapa usulan ideal melebihi kantong, dan berapa bagiannya yang masih bisa
  // ditutup dengan memangkas cadangan.
  const kelebihan = totalIdeal - kantong
  let faktorPotong = 0  // porsi cadangan yang dipangkas, 0..1
  let defisitRiil = 0   // sisa kekurangan yang tak bisa disebar tanpa bikin dinas kurang gaji
  if (kelebihan > 0) {
    if (totalCadangan > 0 && kelebihan < totalCadangan) {
      faktorPotong = kelebihan / totalCadangan
    } else {
      faktorPotong = 1
      defisitRiil = bulat(kelebihan - totalCadangan)
    }
  }

  for (const b of baris) {
    b.ideal = b.terkunci ? b.pagu : bulat(b.kebutuhan * (1 + rate))
    b.alokasi = b.terkunci ? b.pagu : bulat(b.kebutuhan * (1 + rate * (1 - faktorPotong)))
  }
  // Perapian receh hanya berlaku waktu kantongnya memang mengikat, yaitu saat
  // cadangan dipangkas. Kalau pagu masih berlebih, kelebihannya dibiarkan jadi
  // sisa anggaran — bukan ditempelkan ke dinas terbesar. Kalau masih ada defisit
  // riil, Σ alokasi sengaja dibiarkan melebihi kantong supaya kekurangannya
  // tetap kelihatan, bukan disamarkan jadi pas.
  if (faktorPotong > 0 && !defisitRiil) rapikanPembulatan(aktif, kantong)

  let totalTambahanFix = 0
  for (const b of baris) {
    // bagiKeRekening dipanggil DULU supaya bonusPool-nya diketahui sebelum
    // b.alokasi dan turunannya (pergeseran/cadanganAkhir/persenAkhir) dihitung —
    // kalau kebalik, ringkasan tingkat dinas akan tertinggal (belum termasuk
    // bonus) sementara rekeningnya sendiri sudah termasuk, dua-duanya jadi
    // tidak sinkron.
    const { rows, bonusPool } = bagiKeRekening(b, tambahanFixRp, kebutuhanRekening)
    b.rekening = rows
    b.alokasi += bonusPool
    totalTambahanFix += bonusPool
    b.pergeseran = b.alokasi - b.pagu
    b.cadanganAkhir = b.alokasi - b.kebutuhan
    b.persenAkhir = b.kebutuhan > 0 ? (b.cadanganAkhir / b.kebutuhan) * 100 : 0
    b.golongan = kelompokGolongan(b.rekening, labelPeta, canonicalGol)
    b.rekeningTambah = b.rekening.filter(r => r.pergeseran > 0).length
    b.rekeningTanpaRealisasi = b.rekening.filter(r => r.tanpaRealisasi).length
    delete b._rekening
  }

  // Rekap lintas dinas per komponen gaji: rekening mana yang pagunya paling
  // banyak kurang, dan rekening mana yang justru jadi sumber pergeseran.
  const rekMap = new Map()
  for (const b of baris) {
    for (const r of b.rekening) {
      let g = rekMap.get(r.kodeRekening)
      if (!g) {
        g = {
          kodeRekening: r.kodeRekening, namaRekening: r.namaRekening,
          golongan: r.golongan,
          pagu: 0, sp2d: 0, realisasiTerakhir: 0, kebutuhan: 0, alokasi: 0,
          perBulanRutin: 0, rataRata: 0, tertinggi: 0,
          tambah: 0, kurangi: 0, dinasTambah: 0, dinasKurangi: 0, dinasTanpaRealisasi: 0,
        }
        rekMap.set(r.kodeRekening, g)
      }
      g.pagu += r.pagu; g.sp2d += r.sp2d; g.realisasiTerakhir += r.realisasiTerakhir
      g.perBulanRutin += r.perBulanRutin
      g.rataRata += r.rataRata
      g.tertinggi += r.tertinggi
      g.kebutuhan += r.kebutuhan; g.alokasi += r.alokasi
      if (r.pergeseran > 0) { g.dinasTambah += 1; g.tambah += r.pergeseran }
      else if (r.pergeseran < 0) { g.dinasKurangi += 1; g.kurangi += r.pergeseran }
      if (r.tanpaRealisasi) g.dinasTanpaRealisasi += 1
    }
  }
  const rekening = Array.from(rekMap.values())
    .map(g => ({
      ...g,
      pergeseran: g.alokasi - g.pagu,
      // Acress dalam rupiah — kolomnya sendiri supaya usulan bisa dibaca sebagai
      // kebutuhan + acress, bukan satu angka gelondongan.
      cadanganAkhir: g.alokasi - g.kebutuhan,
      tren: g.rataRata > 0 ? Math.round((g.tertinggi / g.rataRata) * 1000) / 1000 : 0,
      // Laju bayar efektif sekabupaten untuk rekening ini. Tidak bisa dirata-rata
      // begitu saja dari tiap dinas — diturunkan dari nilai sebulan yang memang
      // boleh dijumlahkan.
      dibayar: g.perBulanRutin > 0 ? Math.round((g.sp2d / g.perBulanRutin) * 100) / 100 : 0,
    }))
    .sort(urutGolonganLaluKode)

  const totalAlokasi = baris.reduce((a, b) => a + b.alokasi, 0)
  // Dinas terkunci ikut di totalAlokasi (pagunya dibiarkan utuh) tapi tidak
  // punya angka kebutuhan, jadi hitungan cadangan hanya memakai dinas aktif.
  const alokasiAktif = aktif.reduce((a, b) => a + b.alokasi, 0)
  const tambah = baris.filter(b => b.pergeseran > 0)
  const kurangi = baris.filter(b => b.pergeseran < 0)

  return {
    basis: data.basis === 'tertinggi' ? 'tertinggi' : 'rata',
    persenCadangan,
    // Persentase cadangan yang benar-benar kebagian setelah dipangkas.
    persenAkhir: persenCadangan * (1 - faktorPotong),
    faktorPotong,
    // Tambahan fix Pembulatan/Tunjangan Khusus — FLAT, tidak ikut dipangkas
    // proporsional seperti acress, dan tidak masuk hitungan kelebihan/faktorPotong
    // di atas (yang murni soal kebutuhan+acress). Efeknya baru kelihatan di
    // totalAlokasi/sisaKantong di bawah, setelah ditambahkan per dinas.
    tambahanFix: tambahanFixRp,
    totalTambahanFix,
    kantong,
    paguTerkunci,
    totalPagu: kantong + paguTerkunci,
    totalKebutuhan,
    totalCadangan: bulat(totalCadangan),
    totalIdeal: bulat(totalIdeal),
    // Selisih usulan ideal terhadap kantong (>0 = kantong tidak cukup).
    kelebihan: bulat(Math.max(0, kelebihan)),
    // Bagian kekurangan yang berhasil ditutup dengan memangkas cadangan.
    disebar: bulat(Math.max(0, Math.min(kelebihan, totalCadangan))),
    defisitRiil,
    cukup: defisitRiil <= 0,
    totalAlokasi,
    totalAlokasiAktif: alokasiAktif,
    totalCadanganAkhir: alokasiAktif - totalKebutuhan,
    sisaKantong: kantong - alokasiAktif,
    pergeseranMasuk: tambah.reduce((a, b) => a + b.pergeseran, 0),
    pergeseranKeluar: kurangi.reduce((a, b) => a + b.pergeseran, 0),
    jumlahTambah: tambah.length,
    jumlahKurangi: kurangi.length,
    jumlahTerkunci: baris.length - aktif.length,
    skpd: baris,
    rekening,
    // Rekap PNS vs PPPK (atau golongan apa pun yang ada di awalan yang dipakai).
    golongan: kelompokGolongan(rekening, labelPeta, canonicalGol),
  }
}

// Menempelkan angka satu golongan/rekening sisi Sim ke objek sisi Rumus yang
// sepadan (dicari lewat `kunci`/`kodeRekening`) — dipakai gabungkanBasis di
// tiga level (top, per-dinas, top lintas-dinas) lewat bentuk peta yang sama.
function tempelGolongan(gRumus, petaSim) {
  const gSim = petaSim.get(gRumus.kunci)
  return {
    ...gRumus,
    kebutuhanSim: gSim?.kebutuhan ?? 0,
    alokasiSim: gSim?.alokasi ?? 0,
    pergeseranSim: gSim?.pergeseran ?? 0,
    cadanganAkhirSim: gSim?.cadanganAkhir ?? 0,
    tambahanFixSim: gSim?.tambahanFix ?? 0,
  }
}
function tempelRekening(rRumus, petaSim) {
  const rSim = petaSim.get(rRumus.kodeRekening)
  return {
    ...rRumus,
    kebutuhanSim: rSim?.kebutuhan ?? 0,
    alokasiSim: rSim?.alokasi ?? 0,
    pergeseranSim: rSim?.pergeseran ?? 0,
    cadanganAkhirSim: rSim?.cadanganAkhir ?? 0,
    tambahanFixSim: rSim?.tambahanFix ?? 0,
  }
}

// Menggabungkan hasil hitungSatuBasis('rumus') dan hitungSatuBasis('sim')
// jadi SATU tree: field sisi rumus dipertahankan nama & maknanya PERSIS
// seperti hitungProyeksiAkhir versi lama (`alokasi`, `pergeseran`,
// `cadanganAkhir`, `persenAkhir`, dst — konsumen yang sudah ada, mis. tab
// Usulan Alokasi, tidak perlu ganti nama field), field sisi sim ditempel
// sebagai sibling berakhiran "Sim" di level yang sama (top-level, per-dinas,
// per-golongan, per-rekening) — bukan pohon terpisah, supaya web/Excel bisa
// baca satu baris/satu sel untuk dua sisi sekaligus, bukan mencocokkan dua
// array sendiri-sendiri.
//
// `rumus` dan `sim` berasal dari `data.skpd` yang SAMA, jadi urutan skpd/
// rekening di keduanya identik — dicocokkan lewat kode, bukan indeks, supaya
// tetap benar walau salah satu basis menyaring/mengurutkan beda suatu saat.
function gabungkanBasis(rumus, sim) {
  const golLookup = (arr) => new Map((arr || []).map(g => [g.kunci, g]))
  const rekLookup = (arr) => new Map((arr || []).map(r => [r.kodeRekening, r]))

  const skpdSimByKode = new Map((sim.skpd || []).map(s => [s.kodeSkpd, s]))
  const skpd = (rumus.skpd || []).map(bRumus => {
    const bSim = skpdSimByKode.get(bRumus.kodeSkpd)
    const petaRekSim = rekLookup(bSim?.rekening)
    const petaGolSim = golLookup(bSim?.golongan)
    return {
      ...bRumus,
      kebutuhanSim: bSim?.kebutuhan ?? 0,
      alokasiSim: bSim?.alokasi ?? 0,
      pergeseranSim: bSim?.pergeseran ?? 0,
      cadanganAkhirSim: bSim?.cadanganAkhir ?? 0,
      persenAkhirSim: bSim?.persenAkhir ?? 0,
      rekening: (bRumus.rekening || []).map(r => tempelRekening(r, petaRekSim)),
      golongan: (bRumus.golongan || []).map(g => tempelGolongan(g, petaGolSim)),
    }
  })

  const rekening = (rumus.rekening || []).map(r => tempelRekening(r, rekLookup(sim.rekening)))
  const golongan = (rumus.golongan || []).map(g => tempelGolongan(g, golLookup(sim.golongan)))

  return {
    ...rumus,
    skpd,
    rekening,
    golongan,
    // Ringkasan sisi Sim Gaji — nama field selalu diakhiri "Sim" supaya jelas
    // bedanya dari field rumus di atas, walau makna & satuannya sama persis.
    // Bisa beda dari sisi rumus kalau kantongnya sempat ketat (faktorPotongSim
    // ≠ faktorPotong) — itu bukan bug, basis kebutuhannya memang beda.
    persenAkhirSim: sim.persenAkhir,
    faktorPotongSim: sim.faktorPotong,
    tambahanFixSim: sim.tambahanFix,
    totalTambahanFixSim: sim.totalTambahanFix,
    kantongSim: sim.kantong,
    paguTerkunciSim: sim.paguTerkunci,
    totalKebutuhanSim: sim.totalKebutuhan,
    totalCadanganSim: sim.totalCadangan,
    totalIdealSim: sim.totalIdeal,
    kelebihanSim: sim.kelebihan,
    disebarSim: sim.disebar,
    defisitRiilSim: sim.defisitRiil,
    cukupSim: sim.cukup,
    totalAlokasiSim: sim.totalAlokasi,
    totalAlokasiAktifSim: sim.totalAlokasiAktif,
    totalCadanganAkhirSim: sim.totalCadanganAkhir,
    sisaKantongSim: sim.sisaKantong,
    pergeseranMasukSim: sim.pergeseranMasuk,
    pergeseranKeluarSim: sim.pergeseranKeluar,
    jumlahTambahSim: sim.jumlahTambah,
    jumlahKurangiSim: sim.jumlahKurangi,
    jumlahTerkunciSim: sim.jumlahTerkunci,
  }
}

export function hitungProyeksiAkhir(data, opts = {}) {
  const rumus = hitungSatuBasis(data, opts, 'rumus')
  const sim = hitungSatuBasis(data, opts, 'sim')
  return gabungkanBasis(rumus, sim)
}
