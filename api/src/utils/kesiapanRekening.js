import { rincianObjekRekening, subRincianRekening } from './kodeRekening.js'
import { cocokTambahanFix, DEFAULT_TAMBAHAN_FIX } from './proyeksiAkhir.js'

// ---- Kesiapan rekening gaji: jawaban siap pakai untuk "ambilnya dari mana?" ----
//
// Modul ini TIDAK menghitung ulang besaran kekurangan — proyeksiAkhir.js sudah
// melakukannya. Yang disiapkan di sini adalah jawaban per dinas untuk pertanyaan
// yang datang tiap kali daftar gaji bulan berikutnya disusun:
//
//     "Rekening X di dinas ini kurang. Ambilnya dari mana?"
//
// TIGA hal yang membentuk rancangannya:
//
// 1. PERGESERAN ITU PERISTIWA BULANAN, bukan alokasi sekali setahun. Waktu
//    daftar gaji Oktober disusun, rekening yang sisa anggarannya tidak cukup
//    ditutup dari rekening lain BULAN ITU JUGA. Karena itu di bawah dijalankan
//    simulasi bulan demi bulan: tiap bulan dibayar satu kali sim, yang jatuh
//    minus ditutup, lalu lanjut ke bulan berikutnya. Yang dicatat adalah siapa
//    memberi ke siapa DI BULAN MANA.
//
// 2. GESER TIDAK BOLEH LINTAS GOLONGAN. Kekurangan PNS ditutup dari rekening
//    PNS, PPPK dari PPPK, dan lazimnya dari gaji pokok. Jadi tiap bulan
//    penutupan dijalankan terpisah per golongan, bukan satu kolam per dinas.
//    Akibatnya surplus PPPK yang menganggur tidak bisa menolong PNS yang
//    kurang; itu membuat angka "perlu dari luar dinas" lebih besar daripada
//    kalau gesernya dibebaskan, tapi itulah yang benar-benar bisa dijalankan.
//
// 3. PROYEKSI AKHIR TIDAK TERPENGARUH GESER SAMA SEKALI. Kebutuhan tiap
//    rekening = realisasi + sim × sisa bulan (+ acress, + tambahan fix). Rumus
//    itu tidak memuat suku anggaran, dan geser itu sendiri zero-sum. Jadi Σ
//    proyeksi akhir tetap sama apa pun gesernya — geser cuma memindahkan
//    anggaran, tidak menambah kebutuhan maupun menguranginya. Bulan-bulan
//    sesudah bulan depan murni penjumlahan: sim × sisa bulannya.
//
// Sengaja TIDAK dikerjakan di sini: pooling otomatis antar dinas. Itu sudah
// dikerjakan hitungProyeksiAkhir; menambahkannya di sini akan memberi dua angka
// berbeda untuk satu pertanyaan. Dinas yang surplusnya sendiri tidak cukup
// cukup DITANDAI perlu dari luar — keputusan itu bukan milik modul ini.

// Acress default NOL di sini — sengaja beda dari proyeksiAkhir.js (2,5%).
// Lembar ini menjawab "berapa yang benar-benar dibutuhkan menurut Sim Gaji",
// bukan "berapa cadangan yang pantas disiapkan". Dengan acress 0, proyeksi
// akhir tiap rekening persis = realisasi + sim × sisa bulan + tambahan fix,
// jadi bisa diadu langsung dengan proyeksi yang disusun orang dinas sendiri.
const DEFAULT_PERSEN_CADANGAN = 0

// Urutan pengambilan sumber pergeseran, dari yang paling didahulukan. Dinyatakan
// sebagai rincian objek dalam bentuk baku 3 digit (rincianObjekRekening sudah
// menormalkan format lama maupun 2026+), BUKAN dari nama rekening: nama bisa
// berubah ejaannya antar tahun, kodenya tidak.
//
//   001 Gaji Pokok            006 Tunjangan Beras
//   002 Tunjangan Keluarga    009 Iuran Jaminan Kesehatan
//   003 Tunjangan Jabatan     010 Iuran Jaminan Kecelakaan Kerja
//   004 Tunjangan Fungsional  011 Iuran Jaminan Kematian
//   005 Tunj. Fungsional Umum 007 Tunjangan PPh/Tunjangan Khusus
//                             008 Pembulatan Gaji
//
// PPh/Tunjangan Khusus dan Pembulatan Gaji sengaja paling buncit: dua rekening
// itulah yang paling sering kurang sendiri (makanya dapat tambahan flat 200rb),
// jadi menjadikannya sumber hanya memindahkan masalah ke situ.
const URUTAN_SUMBER = ['001', '002', '003', '004', '005', '006', '009', '010', '011', '007', '008']

function peringkatSumber(kodeRekening) {
  const i = URUTAN_SUMBER.indexOf(rincianObjekRekening(kodeRekening))
  // Rincian objek di luar daftar (kalau suatu saat ada yang baru) ditaruh
  // paling belakang, bukan paling depan — lebih aman salah-lambat daripada
  // salah-cepat menguras rekening yang belum dikenal.
  return i === -1 ? URUTAN_SUMBER.length : i
}

const num = (v) => Number(v) || 0
const bulat = (n) => Math.round(Number(n) || 0)

/**
 * @param {object} data payload hitungProyeksiGaji (butuh data.skpd[].rekening[])
 * @param {object} opsi { persen, tambahanFix, bulanSisa, bulanTerakhir }
 */
export function hitungKesiapanRekening(data, opsi = {}) {
  const p = Number(opsi.persen)
  const persenCadangan = Number.isFinite(p) && p >= 0 ? p : DEFAULT_PERSEN_CADANGAN
  const rate = persenCadangan / 100
  const t = Number(opsi.tambahanFix)
  const tambahanFixRp = Number.isFinite(t) && t >= 0 ? t : DEFAULT_TAMBAHAN_FIX
  const bulanSisa = num(opsi.bulanSisa ?? data.bulanSisa)
  // Bulan kalender yang mendahului sisa bulan — dipakai menerjemahkan k (1..n)
  // jadi bulan yang bisa disebut orang ("mentok Oktober"), bukan "mentok k=1".
  const bulanTerakhir = opsi.bulanTerakhir ?? data.bulanTerakhir ?? (bulanSisa ? 12 - bulanSisa : null)
  const bulanPertama = bulanTerakhir != null && bulanSisa > 0 ? bulanTerakhir + 1 : null

  const skpd = (data.skpd || []).map(s =>
    hitungSatuDinas(s, { rate, tambahanFixRp, bulanSisa, bulanTerakhir, bulanPertama }))

  return {
    persenCadangan,
    tambahanFix: tambahanFixRp,
    bulanSisa,
    bulanTerakhir,
    bulanPertama,
    skpd,
    total: rekapTotal(skpd, bulanPertama),
  }
}

// Urutan sumber pergeseran di dalam satu golongan: gaji pokok dulu selama masih
// punya sisa, lalu sisa terbesar. Tie-break kode rekening supaya hasilnya
// deterministik — lembar ini dicetak dan dibandingkan antar bulan, jadi dua
// rekening bersisa sama tidak boleh bertukar tempat tanpa sebab.
// Urutan sumber: ikut URUTAN_SUMBER, turun satu per satu. Sisa anggaran TIDAK
// ikut menentukan urutan — gaji pokok tetap didahulukan walau sisanya lebih
// kecil daripada rekening di bawahnya. Tie-break kode rekening supaya hasilnya
// deterministik; lembar ini dicetak dan dibandingkan antar bulan, jadi dua
// rekening setara tidak boleh bertukar tempat tanpa sebab.
function urutSumber() {
  return (a, b) =>
    peringkatSumber(a.kodeRekening) - peringkatSumber(b.kodeRekening) ||
    String(a.kodeRekening).localeCompare(String(b.kodeRekening), 'id', { numeric: true })
}

function hitungSatuDinas(s, { rate, tambahanFixRp, bulanSisa, bulanTerakhir, bulanPertama }) {
  // Golongan yang benar-benar punya pegawai di dinas ini (pernah dibayar atau
  // punya angka sebulan) — syarat tambahan fix yang sama dengan proyeksiAkhir.js:
  // dinas tanpa PPPK sama sekali tidak dapat tambahan di rekening PPPK-nya.
  const golonganAda = new Set()
  for (const r of s.rekening || []) {
    const sebulan = r.sim != null ? r.sim : r.rataRata
    if ((Number(r.sp2d) || 0) + (Number(sebulan) || 0) > 0) {
      golonganAda.add(subRincianRekening(r.kodeRekening) || '-')
    }
  }
  const rekening = (s.rekening || []).map(r => {
    const pagu = bulat(r.pagu)
    const sp2d = bulat(r.sp2d)
    const sisaPagu = pagu - sp2d
    // Isian Sim Gaji sebulan; rekening yang belum diisi jatuh balik ke rata²
    // (BUKAN 0) — aturan yang sama dengan hitungSatuBasis di proyeksiAkhir.js,
    // supaya kedua modul tidak pernah memberi kebutuhan yang berbeda.
    const sim = bulat(r.sim != null ? r.sim : r.rataRata)
    const simDariIsian = r.sim != null

    // Rekening yang tidak berpagu DAN belum pernah dibayar tidak punya baris
    // anggaran untuk digeser — pertanyaannya bukan "ambil dari mana" melainkan
    // "perlu anggaran baru berapa". Dikeluarkan dari simulasi geser, tapi TIDAK
    // dibuang: yang isian Sim Gaji-nya terisi ditandai `tanpaPagu` dan
    // dilaporkan tersendiri, karena itu justru temuan yang paling perlu diurus.
    const belumBerpagu = pagu === 0 && sp2d === 0
    const kosong = belumBerpagu && sim === 0
    const tanpaPagu = belumBerpagu && sim > 0

    // Tambahan flat untuk Pembulatan Gaji dan Tunjangan PPh/Tunjangan Khusus —
    // pola & besarannya diambil dari proyeksiAkhir.js supaya satu definisi.
    // Dua rekening itu paling sering kurang beberapa ratus ribu walau sudah
    // dapat acress, sifatnya pembulatan/potongan pajak yang susah ditebak.
    const tambahanFix = !belumBerpagu && cocokTambahanFix(r.namaRekening) &&
      golonganAda.has(subRincianRekening(r.kodeRekening) || '-') ? tambahanFixRp : 0

    // Bulan pertama sisa anggaran tidak lagi menutup satu kali gaji lagi.
    // ARITMETIKA MURNI, tanpa simulasi dan tanpa memperhitungkan pergeseran:
    // pergeseran cuma dihitung untuk bulan depan, bulan-bulan sesudahnya belum
    // ada keputusannya. Acress juga tidak ikut — ini soal kapan uang di
    // rekening habis, bukan soal berapa cadangan yang pantas.
    let bulanMentok = null
    let kurangSaatMentok = 0
    if (!belumBerpagu) {
      for (let k = 1; k <= bulanSisa; k++) {
        if (sisaPagu - k * sim < 0) {
          bulanMentok = bulanTerakhir != null ? bulanTerakhir + k : k
          kurangSaatMentok = k * sim - sisaPagu
          break
        }
      }
    }

    // Proyeksi akhir: MURNI penjumlahan, tidak menyentuh anggaran maupun geser.
    const kebutuhanTunai = sim * bulanSisa
    const kurangTunai = belumBerpagu ? 0 : Math.max(0, kebutuhanTunai - sisaPagu)
    const ruangTunai = belumBerpagu ? 0 : Math.max(0, sisaPagu - kebutuhanTunai)
    const butuhAkhir = bulat((sp2d + sim * bulanSisa) * (1 + rate)) + tambahanFix
    const gap = belumBerpagu ? 0 : Math.max(0, butuhAkhir - pagu)
    const surplusAkhir = belumBerpagu ? 0 : Math.max(0, pagu - butuhAkhir)

    return {
      kodeRekening: r.kodeRekening,
      namaRekening: r.namaRekening,
      golongan: r.golongan,
      pagu, sp2d, sisaPagu,
      rataRata: bulat(r.rataRata),
      sim, simDariIsian,
      tambahanFix,
      butuhAkhir, gap, surplusAkhir,
      kebutuhanTunai, kurangTunai, ruangTunai,
      // Kebutuhan & sisa anggaran posisi BULAN DEPAN saja.
      butuhBulanDepan: sp2d + sim,
      selisihBulanDepan: sisaPagu - sim,
      // Pergeseran bulan depan saja — lihat alokasiBulanDepan di bawah.
      masukBulanDepan: 0,     // beban rekening lain yang ditanggung di sini
      keluarBulanDepan: 0,    // beban rekening ini yang ditanggung rekening lain
      kurangBulanDepan: 0,    // bagian bulan depan yang tidak menemukan sumber
      ambilDari: [],
      bulanMentok,
      kurangSaatMentok: bulat(kurangSaatMentok),
      // Diisi hitungSatuDinas setelah alokasi: bagian kekurangan setahun yang
      // tidak tertutup rekening segolongan mana pun di dinas ini.
      sisaKurang: 0,
      kosong, tanpaPagu,
    }
  })

  alokasiBulanDepan(rekening, { bulanPertama })

  const rekMentokPerBulan = {}
  for (const r of rekening) {
    if (r.bulanMentok == null) continue
    rekMentokPerBulan[r.bulanMentok] = (rekMentokPerBulan[r.bulanMentok] || 0) + 1
  }

  const perGolongan = new Map()
  for (const r of rekening) {
    const g = r.golongan || '-'
    if (!perGolongan.has(g)) perGolongan.set(g, [])
    perGolongan.get(g).push(r)
  }
  for (const isi of perGolongan.values()) {
    const kurang = isi.reduce((a, r) => a + r.kurangTunai, 0)
    const ruang = isi.reduce((a, r) => a + r.ruangTunai, 0)
    const takTertutup = Math.max(0, kurang - ruang)
    for (const r of isi) {
      r.sisaKurang = kurang > 0 ? bulat(takTertutup * (r.kurangTunai / kurang)) : 0
    }
  }

  // Sisi tunai dipakai untuk cerita pergeseran (kurang / tertutup / sisa);
  // sisi anggaran (`gap`/`surplusAkhir`, memuat acress & tambahan fix) dipakai
  // kolom "Perlu Ditambah" yang jadi dasar usulan pergeseran anggaran.
  // Kekurangan setahun dihitung ARITMETIKA per golongan, bukan disimulasikan:
  // kolam satu golongan-dinas itu fungible, jadi yang tak tertutup persis
  // max(0, Σ kurang − Σ ruang). Tiap rekening kebagian porsinya proporsional
  // supaya baris per baris tetap menjumlah ke angka golongannya.
  const gapKotor = rekening.reduce((a, r) => a + r.kurangTunai, 0)
  const surplusTersedia = rekening.reduce((a, r) => a + r.ruangTunai, 0)
  const sisaKurang = rekening.reduce((a, r) => a + r.sisaKurang, 0)
  const tertutup = gapKotor - sisaKurang

  return {
    kodeSkpd: s.kodeSkpd,
    namaSkpd: s.namaSkpd,
    pagu: rekening.reduce((a, r) => a + r.pagu, 0),
    sp2d: rekening.reduce((a, r) => a + r.sp2d, 0),
    butuhAkhir: rekening.reduce((a, r) => a + r.butuhAkhir, 0),
    tambahanFix: rekening.reduce((a, r) => a + r.tambahanFix, 0),
    gapKotor, surplusTersedia, tertutup, sisaKurang,
    perluLuar: sisaKurang > 0,
    rekMentok: rekening.filter(r => r.bulanMentok != null).length,
    rekMentokPerBulan,
    // Rekap per golongan — di sinilah kolam pergeseran yang sesungguhnya, sebab
    // geser tidak boleh lintas golongan. Di tingkat dinas hubungan
    // `sisaKurang = max(0, gap - surplus)` TIDAK berlaku.
    golongan: [...perGolongan.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'id', { numeric: true }))
      .map(([kunci, isi]) => ({
        kunci,
        gapKotor: isi.reduce((a, r) => a + r.kurangTunai, 0),
        surplusTersedia: isi.reduce((a, r) => a + r.ruangTunai, 0),
        masukBulanDepan: isi.reduce((a, r) => a + r.masukBulanDepan, 0),
        keluarBulanDepan: isi.reduce((a, r) => a + r.keluarBulanDepan, 0),
        sisaKurang: Math.max(0,
          isi.reduce((a, r) => a + r.kurangTunai, 0) - isi.reduce((a, r) => a + r.ruangTunai, 0)),
      })),
    tanpaPaguJumlah: rekening.filter(r => r.tanpaPagu).length,
    tanpaPaguNilai: rekening.reduce((a, r) => a + (r.tanpaPagu ? r.butuhAkhir : 0), 0),
    rekening,
  }
}

// Pergeseran hanya dihitung untuk BULAN DEPAN. Itu satu-satunya bulan yang
// daftar gajinya sedang disusun; bulan-bulan sesudahnya belum ada keputusannya
// dan tidak perlu ditebak. Nov–Des cukup `sim × sisa bulan`, penjumlahan biasa.
//
// Dulu di sini ada simulasi tiga bulan. Hasilnya menyesatkan: gaji pokok yang
// meminjamkan di Oktober ikut terhitung "mentok" di Desember lalu menarik balik,
// sehingga jumlah rekening mentok menggelembung dari 51 jadi 78 tanpa ada
// keadaan baru yang benar-benar terjadi. Dibuang.
//
// Sumber: GAJI POKOK LEBIH DULU di golongan yang sama, selama masih bersisa
// setelah membayar gajinya sendiri bulan itu — itu yang dikerjakan bidang
// perbendaharaan. Baru kalau gaji pokok tidak cukup, diambil dari rekening lain
// segolongan. Tidak pernah lintas golongan, tidak pernah lintas dinas.
function alokasiBulanDepan(rekening, { bulanPertama }) {
  const aktif = rekening.filter(r => !r.kosong && !r.tanpaPagu)
  if (!aktif.length || bulanPertama == null) return

  // Sisa anggaran setelah tiap rekening membayar gajinya sendiri bulan depan.
  // Negatif = segitu yang harus ditanggung rekening lain.
  const sisa = new Map(aktif.map(r => [r.kodeRekening, r.sisaPagu - r.sim]))
  const perGolongan = new Map()
  for (const r of aktif) {
    const g = r.golongan || '-'
    if (!perGolongan.has(g)) perGolongan.set(g, [])
    perGolongan.get(g).push(r)
  }

  for (const isi of perGolongan.values()) {
    const penerima = isi.filter(r => sisa.get(r.kodeRekening) < 0)
      .sort((a, b) => sisa.get(a.kodeRekening) - sisa.get(b.kodeRekening))
    if (!penerima.length) continue
    const sumber = isi.filter(r => sisa.get(r.kodeRekening) > 0).sort(urutSumber())

    for (const p of penerima) {
      let belum = -sisa.get(p.kodeRekening)
      for (const src of sumber) {
        if (belum <= 0) break
        const ada = sisa.get(src.kodeRekening)
        if (ada <= 0) continue
        const ambil = Math.min(belum, ada)
        sisa.set(src.kodeRekening, ada - ambil)
        belum -= ambil

        // Yang berpindah adalah BEBANNYA: p menyerahkan sebagian kebutuhannya
        // ke src, jadi `keluar` di p dan `masuk` di src.
        p.keluarBulanDepan += ambil
        src.masukBulanDepan += ambil
        p.ambilDari.push({
          kodeRekening: src.kodeRekening,
          namaRekening: src.namaRekening,
          nilai: ambil,
          bulan: bulanPertama,
          dalamDinas: true,
          dalamGolongan: true,
        })
      }
      // Tidak ada lagi rekening segolongan yang bersisa bulan itu.
      p.kurangBulanDepan = belum
    }
  }
}

function rekapTotal(skpd, bulanPertama) {
  const rekMentok = {}
  for (const s of skpd) {
    for (const [bulan, n] of Object.entries(s.rekMentokPerBulan)) {
      rekMentok[bulan] = (rekMentok[bulan] || 0) + n
    }
  }

  // Bulan terdekat menentukan urgensi: berapa rekening mentok, di berapa dinas,
  // kurang berapa — dan apakah ada dinas yang kekurangan bulan itu tidak bisa
  // ditutup dari rekening segolongan miliknya sendiri.
  let dinasKenaOkt = 0
  let kurangOkt = 0
  let dinasPerluLuarOkt = 0
  for (const s of skpd) {
    const kena = s.rekening.filter(r => r.bulanMentok === bulanPertama)
    if (!kena.length) continue
    dinasKenaOkt += 1
    kurangOkt += kena.reduce((a, r) => a + r.kurangSaatMentok, 0)
    if (kena.some(r => r.kurangBulanDepan > 0)) dinasPerluLuarOkt += 1
  }

  const kurangKotor = skpd.reduce((a, s) => a + s.gapKotor, 0)
  const surplusTotal = skpd.reduce((a, s) => a + s.surplusTersedia, 0)
  const kurangSetelahTutup = skpd.reduce((a, s) => a + s.sisaKurang, 0)

  return {
    rekMentok,
    rekMentokTotal: Object.values(rekMentok).reduce((a, n) => a + n, 0),
    bulanPertama,
    dinasKenaOkt, kurangOkt, dinasPerluLuarOkt,
    kurangKotor, surplusTotal, kurangSetelahTutup,
    // Selisih "tanpa geser" vs "dengan geser" adalah PEMISAHAN TANGGUNG JAWAB
    // (mana yang selesai di meja dinas, mana yang naik ke kabupaten), bukan
    // penurunan kekurangan — total anggaran yang dibutuhkan tidak berubah.
    ditutupDalamDinas: kurangKotor - kurangSetelahTutup,
    // Surplus yang ada tapi tidak terpakai karena terkunci di golongan lain.
    surplusNganggur: surplusTotal - (kurangKotor - kurangSetelahTutup),
    // Negatif = sekabupaten justru surplus.
    net: kurangKotor - surplusTotal,
    dinasPerluLuar: skpd.filter(s => s.perluLuar).length,
    dinasCukupSendiri: skpd.filter(s => s.gapKotor > 0 && !s.perluLuar).length,
    dinasAman: skpd.filter(s => s.gapKotor === 0).length,
    jumlahDinas: skpd.length,
    tambahanFixTotal: skpd.reduce((a, s) => a + s.tambahanFix, 0),
    tanpaPaguJumlah: skpd.reduce((a, s) => a + s.tanpaPaguJumlah, 0),
    tanpaPaguNilai: skpd.reduce((a, s) => a + s.tanpaPaguNilai, 0),
  }
}
