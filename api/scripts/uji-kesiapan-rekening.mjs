// Pengujian "Lembar Kesiapan Rekening Gaji" (api/src/utils/kesiapanRekening.js).
//
//   cd api && npm run uji:kesiapan-rekening [tahun]
//
// Dua lapis:
//   1. Invarian, memakai data buatan — tidak menyentuh database.
//   2. Angka acuan, memakai database sungguhan (read-only). Dilewati kalau
//      databasenya tidak bisa dihubungi, jadi lapis pertama tetap bisa jalan
//      di mana saja.
//
// Invarian yang dijaga — semuanya turun dari satu temuan: TOTAL PAGU KEKAL
// TERHADAP GESER, jadi yang boleh berubah karena alokasi sumber hanyalah SIAPA
// yang menanggung, bukan BERAPA totalnya.

import 'dotenv/config'

import { hitungKesiapanRekening } from '../src/utils/kesiapanRekening.js'

const TAHUN = Number(process.argv[2]) || 2026

let gagal = 0
function cek(nama, lulus, catatan) {
  if (lulus) console.log(`  ok    ${nama}${catatan ? `  (${catatan})` : ''}`)
  else { gagal++; console.log(`  GAGAL ${nama}${catatan ? `  (${catatan})` : ''}`) }
}
const rp = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID')
const jt = (n) => (Number(n) / 1e6).toFixed(2)

// Satu dinas buatan. Tiap rekening ditulis [kode, nama, pagu, sp2d, sim].
function dinas(kode, nama, rekening) {
  return {
    kodeSkpd: kode, namaSkpd: nama,
    rekening: rekening.map(([kodeRek, namaRek, pagu, sp2d, sim]) => ({
      kodeRekening: kodeRek, namaRekening: namaRek,
      pagu, sp2d, sim, rataRata: sim,
    })),
  }
}

const jtRp = 1e6

// Dinas A : gaji pokok berlebih, tunjangan jabatan kurang → tertutup sendiri.
// Dinas B : semua rekening kurang → perlu dari luar dinas.
// Dinas C : seluruh rekening aman.
const contoh = {
  bulanTerakhir: 9,
  bulanSisa: 3,
  skpd: [
    dinas('1.01', 'Dinas A', [
      ['5.1.01.01.001.00001', 'Belanja Gaji Pokok PNS', 500 * jtRp, 360 * jtRp, 40 * jtRp],
      ['5.1.01.01.003.00001', 'Belanja Tunjangan Jabatan PNS', 40 * jtRp, 40 * jtRp, 5 * jtRp],
      ['5.1.01.01.006.00001', 'Belanja Tunjangan Beras PNS', 30 * jtRp, 21 * jtRp, 3 * jtRp],
    ]),
    dinas('1.02', 'Dinas B', [
      ['5.1.01.01.001.00001', 'Belanja Gaji Pokok PNS', 200 * jtRp, 180 * jtRp, 20 * jtRp],
      ['5.1.01.01.003.00001', 'Belanja Tunjangan Jabatan PNS', 20 * jtRp, 20 * jtRp, 3 * jtRp],
    ]),
    dinas('1.03', 'Dinas C', [
      ['5.1.01.01.001.00001', 'Belanja Gaji Pokok PNS', 300 * jtRp, 150 * jtRp, 15 * jtRp],
      // Rekening hasil penyeragaman daftar: tanpa pagu, tanpa realisasi, tanpa isian.
      ['5.1.01.01.003.00002', 'Belanja Tunjangan Jabatan PPPK', 0, 0, null],
    ]),
  ],
}

console.log(`\n1. Invarian (data buatan, acress 0)`)
{
  const h = hitungKesiapanRekening(contoh, { persen: 0 })
  const semua = h.skpd.flatMap(s => s.rekening)

  // Inti temuan: alokasi sumber tidak boleh menyentuh kebutuhan satu rupiah pun.
  // Dihitung ulang dari bahan mentahnya, lalu diadu dengan angka yang keluar
  // SESUDAH alokasi dijalankan.
  const butuhUlang = contoh.skpd.flatMap(s => s.rekening)
    .reduce((a, r) => a + (r.sp2d + (r.sim ?? r.rataRata ?? 0) * contoh.bulanSisa), 0)
  const butuhHasil = semua.reduce((a, r) => a + r.butuhAkhir, 0)
  cek('Σ butuhAkhir identik sebelum & sesudah alokasi sumber', butuhUlang === butuhHasil,
    `Rp${rp(butuhHasil)}`)

  cek('Σ geser masuk = Σ geser keluar, per dinas',
    h.skpd.every(s => {
      const masuk = s.rekening.reduce((a, r) => a + r.masukBulanDepan, 0)
      const keluar = s.rekening.reduce((a, r) => a + r.keluarBulanDepan, 0)
      return masuk === keluar
    }))

  cek('sumber tidak pernah melepas melebihi sisa anggarannya bulan depan',
    semua.every(r => r.masukBulanDepan <= Math.max(0, r.sisaPagu - r.sim)))

  cek('sisaKurang golongan = max(0, gap − surplus) — kolamnya per golongan, bukan per dinas',
    h.skpd.every(s => s.golongan.every(g => g.sisaKurang === Math.max(0, g.gapKotor - g.surplusTersedia))))

  cek('geser zero-sum di tiap golongan-dinas (Σ masuk = Σ keluar)',
    h.skpd.every(s => s.golongan.every(g => g.masukBulanDepan === g.keluarBulanDepan)))

  // Kalau kekurangannya tertutup, rencana realisasi wajib mentok di anggaran
  // atau di bawahnya. Yang TIDAK tertutup memang melebihi — di situlah angka
  // "perlu dari luar dinas" muncul, dan itu harus kelihatan apa adanya.
  cek('rencana realisasi bulan depan ≤ anggaran, kecuali yang tidak tertutup',
    semua.filter(r => !r.kosong && !r.tanpaPagu && r.kurangBulanDepan === 0)
      .every(r => r.sp2d + r.sim + r.masukBulanDepan - r.keluarBulanDepan <= r.pagu))

  cek('pergeseran HANYA untuk bulan depan',
    semua.every(r => (r.ambilDari || []).every(a => a.bulan === h.bulanPertama)))

  cek('Σ geser masuk = Σ geser keluar di tiap dinas',
    h.skpd.every(s =>
      s.rekening.reduce((a, r) => a + r.masukBulanDepan, 0) ===
      s.rekening.reduce((a, r) => a + r.keluarBulanDepan, 0)))

  cek('tidak ada sumber lintas golongan',
    h.skpd.every(s => s.rekening.every(r => (r.ambilDari || []).every(x => {
      const src = s.rekening.find(y => y.kodeRekening === x.kodeRekening)
      return src && (src.golongan || '-') === (r.golongan || '-')
    }))))

  cek('Σ golongan = angka dinas',
    h.skpd.every(s =>
      s.golongan.reduce((a, g) => a + g.gapKotor, 0) === s.gapKotor &&
      s.golongan.reduce((a, g) => a + g.sisaKurang, 0) === s.sisaKurang))

  cek('bulanMentok null bila sisa pagu masih menutup seluruh sisa bulan',
    semua.filter(r => !r.kosong && !r.tanpaPagu)
      .every(r => (r.sisaPagu >= r.sim * h.bulanSisa) === (r.bulanMentok == null)))

  cek('gap > 0 untuk setiap rekening yang mentok',
    semua.filter(r => r.bulanMentok != null).every(r => r.gap > 0))

  cek('Σ gap = Σ tertutup + Σ sisaKurang',
    h.total.kurangKotor === h.total.ditutupDalamDinas + h.total.kurangSetelahTutup,
    `Rp${rp(h.total.kurangKotor)}`)

  // Dinas A: tunjangan jabatan kurang 15 jt (pagu habis, butuh 3 × 5 jt),
  // ditutup dari gaji pokok yang surplus 500 − (360 + 3 × 40) = 20 jt.
  const a = h.skpd.find(s => s.kodeSkpd === '1.01')
  const jabatanA = a.rekening.find(r => r.kodeRekening === '5.1.01.01.003.00001')
  cek('Dinas A: tunjangan jabatan mentok Oktober', jabatanA.bulanMentok === 10)
  cek('Dinas A: kekurangan bulan depan tertutup dari rekening segolongan',
    jabatanA.kurangBulanDepan === 0 && jabatanA.keluarBulanDepan === 5 * jtRp,
    `Rp${rp(jabatanA.keluarBulanDepan)}`)
  cek('Dinas A: sumbernya gaji pokok (didahulukan)',
    jabatanA.ambilDari[0]?.kodeRekening === '5.1.01.01.001.00001',
    jabatanA.ambilDari.map(x => `${x.kodeRekening}=${rp(x.nilai)}`).join(' '))
  cek('Dinas A: tidak perlu dari luar dinas', a.perluLuar === false)

  const b = h.skpd.find(s => s.kodeSkpd === '1.02')
  cek('Dinas B: seluruhnya perlu dari luar dinas',
    b.perluLuar === true && b.surplusTersedia === 0 && b.sisaKurang === b.gapKotor,
    `Rp${rp(b.sisaKurang)}`)

  const c = h.skpd.find(s => s.kodeSkpd === '1.03')
  cek('Dinas C: aman, tidak ada rekening mentok', c.gapKotor === 0 && c.rekMentok === 0)
  cek('rekening hasil penyeragaman ditandai kosong, bukan mentok',
    c.rekening.find(r => r.kodeRekening === '5.1.01.01.003.00002').kosong === true)

  cek('total: dinas perlu luar dihitung benar', h.total.dinasPerluLuar === 1, `${h.total.dinasPerluLuar} dinas`)
  cek('total: dinas cukup sendiri dihitung benar', h.total.dinasCukupSendiri === 1)
}

console.log('\n2. Acress hanya menggeser gap, tidak menggeser bulan mentok')
{
  const h0 = hitungKesiapanRekening(contoh, { persen: 0 })
  const h5 = hitungKesiapanRekening(contoh, { persen: 5 })
  const bulan = (h) => h.skpd.flatMap(s => s.rekening.map(r => r.bulanMentok)).join(',')
  cek('bulan mentok tidak berubah karena acress', bulan(h0) === bulan(h5))
  // kurangKotor sekarang sisi TUNAI (tanpa acress), jadi yang naik adalah
  // butuhAkhir tiap rekening — bukan angka cerita pergeserannya.
  const butuhTotal = (h) => h.skpd.flatMap(s => s.rekening).reduce((a, r) => a + r.butuhAkhir, 0)
  cek('kebutuhan akhir naik karena acress', butuhTotal(h5) > butuhTotal(h0),
    `Rp${rp(butuhTotal(h0))} → Rp${rp(butuhTotal(h5))}`)
  cek('kekurangan tunai TIDAK bergerak karena acress',
    h5.total.kurangKotor === h0.total.kurangKotor, `Rp${rp(h0.total.kurangKotor)}`)
  const salah = hitungKesiapanRekening(contoh, { persen: 'abc' })
  cek('persen tidak valid → kembali ke 0 (polos)', salah.persenCadangan === 0)
  const tanpaOpsi = hitungKesiapanRekening(contoh)
  cek('tanpa opsi → acress 0, proyeksi akhir = realisasi + sim × sisa bulan',
    tanpaOpsi.persenCadangan === 0 &&
    tanpaOpsi.skpd[0].rekening[0].butuhAkhir === 360 * jtRp + 40 * jtRp * 3)
}

console.log('\n3. Geser itu zero-sum: total pagu kekal')
{
  // Pagu dipindahkan 10 jt dari gaji pokok ke tunjangan jabatan di Dinas A.
  // Kebutuhan tiap rekening tidak memuat suku pagu, jadi Σ butuhAkhir wajib
  // sama persis; yang berubah cuma siapa yang kurang dan berapa yang digeser.
  const digeser = structuredClone(contoh)
  const rekA = digeser.skpd[0].rekening
  rekA[0].pagu -= 10 * jtRp
  rekA[1].pagu += 10 * jtRp

  const asli = hitungKesiapanRekening(contoh, { persen: 0 })
  const baru = hitungKesiapanRekening(digeser, { persen: 0 })
  const butuh = (h) => h.skpd.flatMap(s => s.rekening).reduce((a, r) => a + r.butuhAkhir, 0)
  cek('Σ butuhAkhir kekal terhadap geser', butuh(asli) === butuh(baru), `Rp${rp(butuh(asli))}`)

  const paguTotal = (h) => h.skpd.reduce((a, s) => a + s.pagu, 0)
  cek('Σ pagu kekal terhadap geser', paguTotal(asli) === paguTotal(baru))

  const a = baru.skpd[0]
  cek('setelah digeser, Dinas A tetap tertutup sendiri', a.perluLuar === false)
  cek('setelah digeser, yang perlu digeser berkurang',
    a.gapKotor === asli.skpd[0].gapKotor - 10 * jtRp,
    `Rp${rp(asli.skpd[0].gapKotor)} → Rp${rp(a.gapKotor)}`)
}

// ---- 4. Angka acuan terhadap database sungguhan ----
console.log(`\n4. Angka acuan TA ${TAHUN} (database, acress 0)`)
{
  let data = null
  let db = null
  try {
    db = (await import('../src/db.js')).default
    const { hitungProyeksiGaji } = await import('../src/routes/proyeksiGaji.js')
    data = await hitungProyeksiGaji({ tahun: TAHUN })
  } catch (e) {
    console.log(`  (dilewati — database tidak bisa dihubungi: ${e.message})`)
  }

  if (data && data.skpd.length) {
    const h = hitungKesiapanRekening(data, { persen: 0 })
    const t = h.total
    const b1 = h.bulanPertama
    console.log(`  realisasi s.d. bulan ${h.bulanTerakhir} · sisa ${h.bulanSisa} bulan · ${t.jumlahDinas} unit SKPD`)

    cek(`rekening mentok bulan ${b1} = 16`, t.rekMentok[b1] === 16, `${t.rekMentok[b1]}`)
    cek(`dinas kena bulan ${b1} = 12`, t.dinasKenaOkt === 12, `${t.dinasKenaOkt}`)
    cek(`kurang bulan ${b1} ≈ Rp 63 jt`, Math.round(t.kurangOkt / 1e6) === 63, `Rp${jt(t.kurangOkt)} jt`)
    cek(`dinas perlu dari luar di bulan ${b1} = 0`, t.dinasPerluLuarOkt === 0, `${t.dinasPerluLuarOkt}`)
    cek(`rekening mentok bulan ${b1 + 1} = 22`, t.rekMentok[b1 + 1] === 22, `${t.rekMentok[b1 + 1]}`)
    // Aritmetika murni: pergeseran cuma dihitung untuk bulan depan, jadi bulan
    // mentok tidak pernah bergeser karena geser maupun karena acress.
    cek(`rekening mentok bulan ${b1 + 2} = 51`, t.rekMentok[b1 + 2] === 51, `${t.rekMentok[b1 + 2]}`)
    cek('kekurangan akhir tahun tanpa geser ≈ Rp 6,26 M',
      (t.kurangKotor / 1e9).toFixed(2) === '6.26', `Rp${jt(t.kurangKotor)} jt`)
    // Angka di bawah lebih besar daripada catatan rancangan awal (2,95 M / 15
    // dinas) karena geser dikurung per golongan: surplus PPPK tidak lagi boleh
    // menolong PNS. Selisihnya itulah ongkos aturan tersebut.
    cek('kekurangan setelah geser segolongan ≈ Rp 3,49 M',
      (t.kurangSetelahTutup / 1e9).toFixed(2) === '3.49', `Rp${jt(t.kurangSetelahTutup)} jt`)
    cek('proyeksi akhir memuat tambahan fix', t.tambahanFixTotal > 0, `Rp${rp(t.tambahanFixTotal)}`)
    cek('dinas perlu dari luar = 17', t.dinasPerluLuar === 17, `${t.dinasPerluLuar}`)
    cek('surplus nganggur (terkunci di golongan lain) ≈ Rp 5,58 M',
      (t.surplusNganggur / 1e9).toFixed(2) === '5.58', `Rp${jt(t.surplusNganggur)} jt`)
    // Angka sisi TUNAI (tanpa acress & tambahan fix): cerita pergeseran memang
    // soal uang yang harus dibayarkan, bukan soal cadangan yang disiapkan.
    cek('net sekabupaten surplus ≈ Rp 2,09 M',
      t.net < 0 && (-t.net / 1e9).toFixed(2) === '2.09', `Rp${jt(t.net)} jt`)

    // Silang dengan sheet lama: butuhAkhir per rekening pada acress 0 harus sama
    // dengan kolom "Kebutuhan s.d. Des (Sim Gaji)" di sheet AKHIR REKENING —
    // dua modul, satu angka.
    const { hitungProyeksiAkhir } = await import('../src/utils/proyeksiAkhir.js')
    const akhir = hitungProyeksiAkhir(data, { persen: 0, tambahanFix: 0 })
    const kTanpaFix = hitungKesiapanRekening(data, { persen: 0, tambahanFix: 0 })
    const petaAkhir = new Map()
    for (const s of akhir.skpd) {
      for (const r of s.rekening) petaAkhir.set(`${s.kodeSkpd}|${r.kodeRekening}`, r.kebutuhanSim)
    }
    const meleset = []
    for (const s of kTanpaFix.skpd) {
      for (const r of s.rekening) {
        const lama = petaAkhir.get(`${s.kodeSkpd}|${r.kodeRekening}`)
        if (lama == null) continue
        if (Math.abs(lama - r.butuhAkhir) > 1) meleset.push(`${s.kodeSkpd}/${r.kodeRekening}: ${rp(r.butuhAkhir)} vs ${rp(lama)}`)
      }
    }
    cek('butuhAkhir = "Kebutuhan s.d. Des (Sim Gaji)" di AKHIR REKENING',
      meleset.length === 0, meleset[0] || `${petaAkhir.size} rekening diperiksa`)

    // Invarian yang sama seperti lapis 1, sekarang di atas data sungguhan.
    cek('data nyata: geser zero-sum di tiap golongan-dinas',
      h.skpd.every(s => s.golongan.every(g => g.masukBulanDepan === g.keluarBulanDepan)))
    cek('data nyata: tambahan fix 200rb menempel di Pembulatan & PPh/Tunsus',
      t.tambahanFixTotal > 0 &&
      h.skpd.every(s => s.rekening.every(r =>
        (r.tambahanFix > 0) === (!r.kosong && !r.tanpaPagu && /pembulatan|tunjangan\s+(khusus|pph)/i.test(r.namaRekening)))),
      `Rp${rp(t.tambahanFixTotal)}`)
    cek('data nyata: rencana realisasi bulan depan ≤ anggaran (yang tertutup)',
      h.skpd.every(s => s.rekening
        .filter(r => !r.kosong && !r.tanpaPagu && r.kurangBulanDepan === 0)
        .every(r => r.sp2d + r.sim + r.masukBulanDepan - r.keluarBulanDepan <= r.pagu)))
    cek('data nyata: pergeseran hanya untuk bulan depan',
      h.skpd.every(s => s.rekening.every(r => (r.ambilDari || []).every(a => a.bulan === h.bulanPertama))))
    // Urutan sumber: pokok > keluarga > jabatan > fungsional > fungsional umum >
    // beras > kesehatan > kecelakaan > kematian > pph > pembulatan.
    const PERINGKAT = ['001', '002', '003', '004', '005', '006', '009', '010', '011', '007', '008']
    cek('data nyata: sumber diambil menurut urutan prioritas, tidak melompat',
      h.skpd.every(s => s.rekening.every(r => {
        const urut = (r.ambilDari || []).map(a => PERINGKAT.indexOf(a.kodeRekening.split('.')[4]))
        return urut.every((v, i) => i === 0 || v >= urut[i - 1])
      })))
    cek('data nyata: PPh/Tunsus & Pembulatan tidak dipakai selama masih ada yang lain',
      (() => {
        let buncit = 0
        for (const s of h.skpd) for (const r of s.rekening) for (const a of r.ambilDari || []) {
          if (['007', '008'].includes(a.kodeRekening.split('.')[4])) buncit += a.nilai
        }
        return buncit === 0
      })())
    cek('data nyata: pergeseran didominasi gaji pokok',
      (() => {
        let pokok = 0, semua = 0
        for (const s of h.skpd) for (const r of s.rekening) for (const a of r.ambilDari || []) {
          semua += a.nilai
          if (/\.001\.|\.01\./.test(a.kodeRekening)) pokok += a.nilai
        }
        return semua > 0 && pokok / semua > 0.9
      })())
    cek('data nyata: tidak ada sumber lintas golongan',
      h.skpd.every(s => s.rekening.every(r => (r.ambilDari || []).every(x => {
        const src = s.rekening.find(y => y.kodeRekening === x.kodeRekening)
        return src && (src.golongan || '-') === (r.golongan || '-')
      }))))
    // Sumber TIDAK lagi dibatasi surplus akhir tahunnya — gaji pokok sengaja
    // boleh meminjamkan dari sisa anggarannya, lalu menarik balik kalau ikut
    // kurang. Yang wajib dijaga: tidak ada rekening yang realisasinya melebihi
    // anggarannya sendiri (sudah diuji di atas) dan gesernya tetap zero-sum.
    cek('data nyata: sumber tidak melepas melebihi sisa anggarannya bulan depan',
      h.skpd.every(s => s.rekening.every(r => r.masukBulanDepan <= Math.max(0, r.sisaPagu - r.sim))))
    cek('data nyata: Σ gap = Σ tertutup + Σ sisaKurang',
      t.kurangKotor === t.ditutupDalamDinas + t.kurangSetelahTutup)

    if (t.tanpaPaguJumlah) {
      console.log(`  catatan: ${t.tanpaPaguJumlah} rekening belum berpagu tapi Sim Gaji-nya terisi ` +
        `(Rp${rp(t.tanpaPaguNilai)}) — perlu pagu baru, bukan geser; tidak ikut dihitung sebagai mentok.`)
    }
  } else if (data) {
    console.log(`  (dilewati — tidak ada data belanja gaji untuk TA ${TAHUN})`)
  }
  if (db) await db.end()
}

console.log(`\n${gagal === 0 ? 'SEMUA PENGUJIAN LULUS' : `${gagal} PENGUJIAN GAGAL`}\n`)
process.exit(gagal === 0 ? 0 : 1)
