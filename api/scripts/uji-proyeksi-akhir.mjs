// Pengujian aturan alokasi "Proyeksi Akhir" memakai data buatan — tidak menyentuh
// database, jadi bisa dijalankan di mana saja:
//
//   cd api && npm run uji:proyeksi-akhir
//
// Yang dijaga: (1) tidak ada dinas yang alokasinya jatuh di bawah kebutuhan
// gajinya sampai Desember, (2) kalau kekurangan masih bisa disebar, Σ alokasi
// harus persis sama dengan pagu yang tersedia, (3) rincian rekening menjumlah
// tepat ke alokasi dinasnya.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { hitungProyeksiAkhir } from '../src/utils/proyeksiAkhir.js'

let gagal = 0
function cek(nama, lulus, catatan) {
  if (lulus) console.log(`  ok    ${nama}${catatan ? `  (${catatan})` : ''}`)
  else { gagal++; console.log(`  GAGAL ${nama}${catatan ? `  (${catatan})` : ''}`) }
}
const rp = (n) => Math.round(Number(n) || 0).toLocaleString('id-ID')

// Satu dinas: pagu, dan rincian rekeningnya. Tiap rekening ditulis
// [kode, nama, realisasi, proyeksi, porsi pagu] — porsi pagu dikali pagu dinas.
// Urutan kode sengaja berselang-seling PNS/PPPK supaya pengelompokannya teruji.
function dinas(kode, nama, pagu, rekening) {
  const sp2d = rekening.reduce((a, r) => a + r[2], 0)
  const proyeksi = rekening.reduce((a, r) => a + r[3], 0)
  return {
    kodeSkpd: kode, namaSkpd: nama, pagu, sp2d, proyeksi,
    // Anggap sebulan gaji = seperlima realisasi; nilainya hanya numpang lewat.
    realisasiTerakhir: sp2d / 5, sp2dTerakhir: 1, bulanTerakhirSkpd: 8,
    perBulanRutin: sp2d / 5, bulanGajiTerbayar: 5,
    rekening: rekening.map(([kodeRek, namaRek, s, p, porsi]) => ({
      kodeRekening: kodeRek, namaRekening: namaRek,
      pagu: pagu * porsi, sp2d: s, proyeksi: p, realisasiTerakhir: s / 5,
    })),
  }
}

const jt = 1e6

// Tiga dinas dengan kebutuhan (realisasi + proyeksi) 1.000 / 2.000 / 500 juta.
function contoh(paguA, paguB, paguC) {
  return {
    skpd: [
      dinas('1.01', 'Dinas A', paguA, [
        ['5.1.01.01.01.0001', 'Belanja Gaji Pokok PNS', 600 * jt, 300 * jt, 0.62],
        ['5.1.01.01.01.0002', 'Belanja Gaji Pokok PPPK', 25 * jt, 10 * jt, 0.04],
        ['5.1.01.01.02.0001', 'Belanja Tunjangan Keluarga PNS', 40 * jt, 20 * jt, 0.33],
        ['5.1.01.01.02.0002', 'Belanja Tunjangan Keluarga PPPK', 3 * jt, 2 * jt, 0.01],
      ]),
      dinas('1.02', 'Dinas B', paguB, [
        ['5.1.01.01.01.0001', 'Belanja Gaji Pokok PNS', 1200 * jt, 500 * jt, 0.55],
        ['5.1.01.01.01.0002', 'Belanja Gaji Pokok PPPK', 90 * jt, 40 * jt, 0.3],
        ['5.1.01.01.02.0001', 'Belanja Tunjangan Keluarga PNS', 100 * jt, 50 * jt, 0.09],
        ['5.1.01.01.02.0002', 'Belanja Tunjangan Keluarga PPPK', 12 * jt, 8 * jt, 0.01],
        // Rekening berpagu yang belum pernah dibayar sama sekali.
        ['5.1.01.01.03.0002', 'Belanja Tunjangan Jabatan PPPK', 0, 0, 0.05],
      ]),
      dinas('1.03', 'Dinas C', paguC, [
        ['5.1.01.01.01.0001', 'Belanja Gaji Pokok PNS', 300 * jt, 200 * jt, 1],
      ]),
    ],
  }
}

const KEBUTUHAN = 1000e6 + 2000e6 + 500e6 // 3,5 M

function periksaInvarian(label, hasil) {
  cek(`${label}: tidak ada dinas di bawah kebutuhannya`,
    hasil.skpd.every(s => s.terkunci || s.alokasi >= s.kebutuhan),
    hasil.skpd.filter(s => !s.terkunci && s.alokasi < s.kebutuhan).map(s => s.namaSkpd).join(', ') || 'semua aman')
  cek(`${label}: Σ rekening = alokasi dinas`,
    hasil.skpd.every(s => s.rekening.reduce((a, r) => a + r.alokasi, 0) === s.alokasi))
  cek(`${label}: tiap rekening ≥ kebutuhannya`,
    hasil.skpd.every(s => s.terkunci || s.rekening.every(r => r.alokasi >= r.kebutuhan)))
  cek(`${label}: rekap rekening = Σ seluruh dinas`,
    hasil.rekening.reduce((a, r) => a + r.alokasi, 0) === hasil.totalAlokasi)
}

// ---- 1. Kantong lebih dari cukup: cadangan penuh 2,5% ----
console.log('\n1. Pagu berlebih — cadangan penuh')
{
  const h = hitungProyeksiAkhir(contoh(1400e6, 2600e6, 700e6)) // total 4,7 M
  periksaInvarian('cukup', h)
  cek('cukup: faktor potong 0', h.faktorPotong === 0)
  cek('cukup: persen akhir tetap 2,5', h.persenAkhir === 2.5)
  cek('cukup: alokasi = kebutuhan × 1,025',
    h.skpd.every(s => s.alokasi === Math.round(s.kebutuhan * 1.025)))
  cek('cukup: masih ada sisa kantong', h.sisaKantong > 0, `Rp${rp(h.sisaKantong)}`)
  cek('cukup: tidak ada defisit riil', h.cukup && h.defisitRiil === 0)
}

// ---- 2. Kantong kurang sedikit: cadangan dipangkas, tidak ada yang kurang ----
console.log('\n2. Pagu kurang sedikit — cadangan dipangkas & disebar')
{
  // Kantong 3,53 M vs usulan ideal 3,5875 M → kurang 57,5 jt, cadangan 87,5 jt.
  const kantong = 1000e6 + 2100e6 + 430e6
  const h = hitungProyeksiAkhir(contoh(1000e6, 2100e6, 430e6))
  periksaInvarian('sebar', h)
  cek('sebar: faktor potong antara 0 dan 1', h.faktorPotong > 0 && h.faktorPotong < 1,
    h.faktorPotong.toFixed(4))
  cek('sebar: persen akhir < 2,5 dan > 0', h.persenAkhir > 0 && h.persenAkhir < 2.5,
    `${h.persenAkhir.toFixed(3)}%`)
  cek('sebar: Σ alokasi = pagu tersedia', h.totalAlokasi === kantong,
    `Rp${rp(h.totalAlokasi)} vs Rp${rp(kantong)}`)
  cek('sebar: sisa kantong nol', h.sisaKantong === 0)
  cek('sebar: semua dinas ikut terpangkas (cadangan < ideal)',
    h.skpd.every(s => s.alokasi < s.ideal))
  cek('sebar: tetap dinyatakan cukup', h.cukup && h.defisitRiil === 0)
  cek('sebar: pergeseran keluar = pergeseran masuk',
    h.pergeseranMasuk + h.pergeseranKeluar === 0,
    `masuk Rp${rp(h.pergeseranMasuk)} / keluar Rp${rp(h.pergeseranKeluar)}`)
}

// ---- 3. Kantong kurang dari kebutuhan riil: defisit dilaporkan apa adanya ----
console.log('\n3. Pagu di bawah kebutuhan riil — defisit riil dilaporkan')
{
  const kantong = 900e6 + 1800e6 + 400e6 // 3,1 M vs kebutuhan 3,5 M
  const h = hitungProyeksiAkhir(contoh(900e6, 1800e6, 400e6))
  periksaInvarian('defisit', h)
  cek('defisit: ditandai tidak cukup', !h.cukup && h.defisitRiil > 0, `Rp${rp(h.defisitRiil)}`)
  cek('defisit: besarnya = kebutuhan − kantong', h.defisitRiil === KEBUTUHAN - kantong,
    `Rp${rp(h.defisitRiil)}`)
  cek('defisit: cadangan habis (faktor potong 1)', h.faktorPotong === 1 && h.persenAkhir === 0)
  cek('defisit: alokasi = kebutuhan persis, tidak dipotong lagi',
    h.skpd.every(s => s.alokasi === s.kebutuhan))
}

// ---- 4. Rekening tanpa realisasi & dinas tanpa dasar hitung ----
console.log('\n4. Penandaan kasus khusus')
{
  const data = contoh(1000e6, 2100e6, 430e6)
  // Dinas keempat: punya pagu tapi belum ada realisasi maupun proyeksi.
  data.skpd.push({
    kodeSkpd: '1.04', namaSkpd: 'Dinas Baru', pagu: 300e6, sp2d: 0, proyeksi: 0,
    rekening: [{
      kodeRekening: '5.1.01.01.01.0001', namaRekening: 'Belanja Gaji Pokok PNS',
      pagu: 300e6, sp2d: 0, proyeksi: 0,
    }],
  })
  const h = hitungProyeksiAkhir(data)
  const baru = h.skpd.find(s => s.kodeSkpd === '1.04')
  cek('dinas tanpa dasar hitung dikunci', baru.terkunci && baru.alokasi === baru.pagu)
  cek('dinas terkunci tidak menghasilkan pergeseran', baru.pergeseran === 0)
  cek('pagu terkunci dipisah dari kantong',
    h.paguTerkunci === 300e6 && h.kantong === 1000e6 + 2100e6 + 430e6)
  cek('jumlah dinas terkunci dilaporkan', h.jumlahTerkunci === 1)

  const b = h.skpd.find(s => s.kodeSkpd === '1.02')
  const tanpa = b.rekening.find(r => r.kodeRekening === '5.1.01.01.03.0002')
  cek('rekening berpagu tanpa realisasi ditandai', tanpa.tanpaRealisasi === true)
  cek('pagunya diusulkan ditarik penuh', tanpa.alokasi === 0 && tanpa.pergeseran === -tanpa.pagu,
    `Rp${rp(tanpa.pagu)}`)
}

// ---- 5. Persentase cadangan bisa diubah ----
console.log('\n5. Persentase cadangan')
{
  const h0 = hitungProyeksiAkhir(contoh(1400e6, 2600e6, 700e6), { persen: 0 })
  cek('persen 0 → alokasi = kebutuhan', h0.skpd.every(s => s.alokasi === s.kebutuhan))
  const h5 = hitungProyeksiAkhir(contoh(1400e6, 2600e6, 700e6), { persen: 5 })
  cek('persen 5 → alokasi = kebutuhan × 1,05',
    h5.skpd.every(s => s.alokasi === Math.round(s.kebutuhan * 1.05)))
  const hSalah = hitungProyeksiAkhir(contoh(1400e6, 2600e6, 700e6), { persen: 'abc' })
  cek('persen tidak valid → kembali ke 2,5', hSalah.persenCadangan === 2.5)
}

// ---- 6. Pengelompokan PNS / PPPK ----
console.log('\n6. Pengelompokan golongan (PNS / PPPK)')
{
  const h = hitungProyeksiAkhir(contoh(1000e6, 2100e6, 430e6))
  cek('golongan terbaca dari nama rekening', h.golongan.map(g => g.label).join(',') === 'PNS,PPPK',
    h.golongan.map(g => `${g.kunci}=${g.label}`).join(' '))
  cek('PNS lebih dulu, baru PPPK (rekap lintas dinas)',
    h.rekening.every((r, i) => i === 0 || r.golongan >= h.rekening[i - 1].golongan),
    h.rekening.map(r => r.kodeRekening.slice(-6)).join(' '))
  cek('PNS lebih dulu, baru PPPK (tiap dinas)',
    h.skpd.every(s => s.rekening.every((r, i) => i === 0 || r.golongan >= s.rekening[i - 1].golongan)))
  cek('dalam satu golongan tetap urut kode',
    h.skpd.every(s => s.rekening.every((r, i) =>
      i === 0 || r.golongan !== s.rekening[i - 1].golongan || r.kodeRekening > s.rekening[i - 1].kodeRekening)))
  cek('Σ golongan = total alokasi',
    h.golongan.reduce((a, g) => a + g.alokasi, 0) === h.totalAlokasi)
  cek('Σ golongan = total kebutuhan',
    h.golongan.reduce((a, g) => a + g.kebutuhan, 0) === h.totalKebutuhan)
  cek('subtotal golongan tiap dinas = Σ rekeningnya',
    h.skpd.every(s => s.golongan.every(g => {
      const isi = s.rekening.filter(r => r.golongan === g.kunci)
      return isi.reduce((a, r) => a + r.alokasi, 0) === g.alokasi &&
        isi.reduce((a, r) => a + r.pagu, 0) === g.pagu
    })))
  const pns = h.golongan.find(g => g.label === 'PNS')
  console.log(`  PNS  : kebutuhan Rp${rp(pns.kebutuhan)} · alokasi Rp${rp(pns.alokasi)} · ${pns.jumlahRekening} rekening`)
  const pppk = h.golongan.find(g => g.label === 'PPPK')
  console.log(`  PPPK : kebutuhan Rp${rp(pppk.kebutuhan)} · alokasi Rp${rp(pppk.alokasi)} · ${pppk.jumlahRekening} rekening`)

  cek('realisasi bulan terakhir dibawa ke tiap dinas',
    h.skpd.filter(s => !s.terkunci).every(s => s.realisasiTerakhir > 0))
  cek('Σ realisasi bulan terakhir rekening = milik dinasnya',
    h.skpd.filter(s => !s.terkunci).every(s =>
      Math.abs(s.rekening.reduce((a, r) => a + r.realisasiTerakhir, 0) - s.realisasiTerakhir) <= s.rekening.length))
}

// ---- 7. Cadangan (akres) menempel di tiap rekening, bukan di totalnya ----
//
// Alokasi tiap rekening harus = kebutuhan rekening itu × (1 + cadangan efektif).
// Kalau cadangan hanya ditempel di angka dinas lalu dibagi rata menurut pagu,
// rekening yang pagunya berlebih akan kebagian cadangan lebih besar daripada
// rekening yang justru kurang — persis yang tidak boleh terjadi.
console.log('\n7. Cadangan dihitung per rekening')
{
  for (const [label, pagu] of [['pagu berlebih', [1400e6, 2600e6, 700e6]], ['cadangan dipangkas', [1000e6, 2100e6, 430e6]]]) {
    const h = hitungProyeksiAkhir(contoh(...pagu))
    const faktor = 1 + h.persenAkhir / 100
    const meleset = []
    for (const s of h.skpd) {
      if (s.terkunci) continue
      for (const r of s.rekening) {
        if (r.kebutuhan <= 0) continue
        // Toleransi = sisa pembulatan rupiah, bukan selisih perhitungan.
        if (Math.abs(r.alokasi - r.kebutuhan * faktor) > s.rekening.length + 1) {
          meleset.push(`${s.kodeSkpd}/${r.kodeRekening}: ${rp(r.alokasi)} vs ${rp(r.kebutuhan * faktor)}`)
        }
      }
    }
    cek(`${label}: tiap rekening = kebutuhannya × ${faktor.toFixed(6)}`, meleset.length === 0,
      meleset[0] || `cadangan ${h.persenAkhir.toFixed(3)}% merata di semua rekening`)
  }
}

// ---- 8. Tampilan tidak boleh menyentuh field yang tidak ada ----
//
// Vue merender template-nya sekali sebelum API menjawab, memakai bentuk kosong
// KOSONG_AKHIR. Satu field yang lupa didaftarkan di sana bikin render pertama
// melempar TypeError, dan yang mati bukan cuma halaman ini — seluruh aplikasi
// ikut blank. Karena itu dicocokkan ke DUA arah: field yang dipakai template
// harus ada di payload sungguhan, dan harus ada juga di bentuk kosongnya.
console.log('\n8. Kecocokan payload dengan tampilan')
{
  const berkas = fileURLToPath(new URL('../../src/views/ProyeksiGajiView.vue', import.meta.url))
  const sumber = readFileSync(berkas, 'utf8')
  const template = sumber.slice(sumber.indexOf('<template>'), sumber.lastIndexOf('</template>'))
  const dipakai = [...new Set([...template.matchAll(/\bakhir\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))].sort()

  const payload = hitungProyeksiAkhir({ skpd: [] })
  const hilangDiPayload = dipakai.filter(k => !(k in payload))
  cek('semua field akhir.* di template ada di payload', hilangDiPayload.length === 0,
    hilangDiPayload.length ? hilangDiPayload.join(', ') : `${dipakai.length} field diperiksa`)

  const blokKosong = sumber.slice(sumber.indexOf('const KOSONG_AKHIR = {'))
  const isiKosong = blokKosong.slice(0, blokKosong.indexOf('\n}'))
  const kunciKosong = new Set([...isiKosong.matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map(m => m[1]))
  const hilangDiKosong = dipakai.filter(k => !kunciKosong.has(k))
  cek('semua field akhir.* di template ada di KOSONG_AKHIR', hilangDiKosong.length === 0,
    hilangDiKosong.length ? hilangDiKosong.join(', ') : `${kunciKosong.size} field terdaftar`)

  const asing = [...kunciKosong].filter(k => !(k in payload))
  cek('KOSONG_AKHIR tidak memuat field yang sudah tidak ada di payload', asing.length === 0,
    asing.join(', ') || 'bersih')
}

console.log(`\n${gagal === 0 ? 'SEMUA PENGUJIAN LULUS' : `${gagal} PENGUJIAN GAGAL`}\n`)
process.exit(gagal === 0 ? 0 : 1)
