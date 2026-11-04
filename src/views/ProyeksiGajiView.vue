<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Download, Refresh, Upload, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../utils/api.js'
import { buatWorkbookProyeksiGaji, namaFileProyeksiGaji } from '../utils/proyeksiGajiExcel.js'
import { buatWorkbookKesiapan, namaFileKesiapan } from '../utils/proyeksiGajiKesiapanExcel.js'
import { bacaSimGajiDariWorkbook, BerkasTidakDikenal } from '../utils/proyeksiGajiImport.js'
import {
  bacaRekapAnggaran, bandingkanInputan, matriksBanding,
  BerkasTidakDikenal as BerkasRekapTidakDikenal,
} from '../utils/bandingInputan.js'
import { buatWorkbookMatriksInputan, namaFileMatriksInputan } from '../utils/matriksInputanExcel.js'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const NAMA_BULAN = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

const KOSONG_AKHIR = {
  skpd: [], rekening: [], golongan: [], basis: 'rata',
  persenCadangan: 0, persenAkhir: 0, faktorPotong: 0,
  kantong: 0, paguTerkunci: 0, totalKebutuhan: 0, totalIdeal: 0, kelebihan: 0,
  defisitRiil: 0, cukup: true, totalAlokasi: 0, totalAlokasiAktif: 0,
  totalCadanganAkhir: 0, sisaKantong: 0, pergeseranMasuk: 0, pergeseranKeluar: 0,
  jumlahTambah: 0, jumlahKurangi: 0, jumlahTerkunci: 0,
  // Sisi Sim Gaji — dihitung server lewat algoritma kantong-pooling yang sama
  // dengan sisi rumus di atas (lihat gabungkanBasis di proyeksiAkhir.js),
  // bukan aproksimasi terpisah. Dipakai buat kartu "Rumus vs Sim Gaji".
  persenAkhirSim: 0, faktorPotongSim: 0, totalKebutuhanSim: 0,
  totalAlokasiAktifSim: 0, totalCadanganAkhirSim: 0, sisaKantongSim: 0,
  cukupSim: true, defisitRiilSim: 0,
}

const KOSONG = {
  skpd: [], rekening: [], bulanList: [], bulanSisa: 0, bulanGajiTerbayarTotal: 0,
  totals: { pagu: 0, spp: 0, sp2d: 0, proyeksi: 0, sisa: 0, selisih: 0 },
  akhir: KOSONG_AKHIR,
}

const loading = ref(false)
const exporting = ref(false)
const exportingKesiapan = ref(false)
const prefix = ref('5.1.01.01')
const data = ref(KOSONG)
const tampilkanRekeningKurang = ref(true)
const tampilkanRekeningAkhir = ref(true)
const tab = ref('kebutuhan')
// Cadangan di atas kebutuhan riil. Dikirim ke API supaya angka di layar dan di
// file Excel berasal dari satu perhitungan yang sama.
const persenCadangan = ref(2.5)
// Rekening Pembulatan Gaji & Tunjangan PPh/Tunjangan Khusus paling sering kurang
// beberapa ratus ribu walau sudah dapat acress (sifatnya pembulatan/potongan
// pajak, susah ditebak dari tren realisasi) — ditambah FLAT di atas acress,
// bukan ikut dipotong proporsional kalau kantong kurang.
const tambahanFix = ref(200000)
// Dasar proyeksi tiap rekening: 'rata' = rata-rata tiap kali bayar, 'tertinggi' =
// nilai sekali bayar yang paling besar (jaga-jaga kalau gaji naik di sisa tahun).
const basis = ref('rata')

async function load() {
  loading.value = true
  try {
    const res = await api.get('/proyeksi-gaji', {
      params: {
        tahun: tahun.value, prefix: prefix.value,
        persen: persenCadangan.value, tambahanFix: tambahanFix.value, basis: basis.value,
      },
    })
    data.value = res.data
  } catch {
    data.value = KOSONG
    ElMessage.error('Gagal memuat data')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const rows = computed(() => data.value.skpd || [])
const totals = computed(() => data.value.totals || KOSONG.totals)

const labelBulanTerakhir = computed(() => {
  const b = data.value.bulanTerakhir
  return b ? `${NAMA_BULAN[b]} ${tahun.value}` : '—'
})
const rentangSisa = computed(() => {
  const b = data.value.bulanTerakhir
  if (!b || b >= 12) return 'sisa tahun'
  return `${NAMA_BULAN[b + 1]}–Desember`
})

const skpdKurang = computed(() =>
  rows.value.filter(r => r.selisih < 0).sort((a, b) => a.selisih - b.selisih))

const totalKekurangan = computed(() =>
  skpdKurang.value.reduce((a, r) => a + r.selisih, 0))

// Rekening yang kurang, dikumpulkan lintas dinas. Kekurangan tiap dinas TIDAK
// disaling-hapuskan dengan dinas yang lebih — kalau dijumlahkan begitu, rekening
// yang kurang di beberapa dinas bisa terlihat aman.
const rekeningKurang = computed(() =>
  (data.value.rekening || [])
    .filter(r => r.dinasKurang > 0)
    .sort((a, b) => a.kekurangan - b.kekurangan))

const totalRekeningKurang = computed(() =>
  rows.value.reduce((a, r) => a + r.rekening.filter(x => x.selisih < 0).length, 0))

function rekeningKurangDi(row) {
  return row.rekening.filter(r => r.selisih < 0).sort((a, b) => a.selisih - b.selisih)
}

function ringkasRekeningKurang(row) {
  const daftar = rekeningKurangDi(row)
  if (!daftar.length) return ''
  return daftar.map(r => `${r.kodeRekening} ${r.namaRekening}: ${formatRp(r.selisih)}`).join('\n')
}

function kelasBaris({ row }) {
  return row.selisih < 0 ? 'baris-kurang' : ''
}

// Dinas yang laju bayarnya menyimpang jauh dari kabupaten — angka proyeksinya
// perlu dicek dulu di sheet PER BULAN (mis. pembayaran tertinggal atau ada rapel).
const skpdMenyimpang = computed(() => rows.value.filter(r =>
  r.pembagiPerkiraan ||
  Math.abs(r.bulanGajiTerbayar - data.value.bulanGajiTerbayarTotal) >= 1
))

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
}
function formatMio(val) {
  const n = Number(val || 0)
  if (Math.abs(n) >= 1e9) return 'Rp' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' M'
  if (Math.abs(n) >= 1e6) return 'Rp' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt'
  return formatRp(n)
}
function formatBulan(v) {
  return Number(v || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function menyimpang(row) {
  return row.pembagiPerkiraan ||
    Math.abs(row.bulanGajiTerbayar - data.value.bulanGajiTerbayarTotal) >= 1
}

const akhir = computed(() => ({ ...KOSONG_AKHIR, ...(data.value.akhir || {}) }))

// Dinas yang punya rekening berpagu tapi belum pernah dibayar — pagunya
// diusulkan ditarik penuh, jadi perlu dicek manual dulu.
const akhirTanpaRealisasi = computed(() =>
  (akhir.value.skpd || []).filter(s => s.rekeningTanpaRealisasi > 0))

function formatPersen(val) {
  return Number(val || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'
}
// Pergeseran selalu ditulis bertanda supaya arahnya (tambah / tarik) langsung terbaca.
function formatSelisih(val) {
  const n = Number(val || 0)
  if (!n) return '\u2014'
  return (n > 0 ? '+' : '\u2212') + formatRp(Math.abs(n))
}
function warnaPergeseran(val) {
  if (val > 0) return '#e6a23c'
  if (val < 0) return '#409eff'
  return '#909399'
}
function kelasBarisAkhir({ row }) {
  if (row.terkunci) return 'baris-kunci'
  return row.pergeseran > 0 ? 'baris-tambah' : ''
}

// Empat segmen pertama sama untuk semua baris (itu awalan yang dipilih di atas),
// jadi yang ditampilkan cukup dua segmen terakhir — kode penuhnya ada di tooltip
// dan di file Excel. Ini yang membuat tabel rincian muat tanpa scroll.
function kodeSingkat(kode) {
  const bagian = String(kode || '').split('.')
  return bagian.length > 4 ? bagian.slice(4).join('.') : kode
}

function namaBulan(b) {
  return NAMA_BULAN[Number(b) || 0] || '—'
}

// Bulan terakhir yang nilainya jauh di atas satu bulan rutin berarti memuat
// lebih dari satu kali gaji — lazimnya THR atau gaji ke-13. Jumlah SP2D saja
// bukan penanda: PNS dan PPPK memang lazim terbit SP2D sendiri-sendiri, jadi
// 2 SP2D sebulan itu normal.
function rapel(row) {
  return row.rasioTerakhir >= 1.4
}

// Daftar rekening per golongan. Disaring dari array yang sudah urut per golongan
// (bukan disalin ulang di payload), lalu ditahan di computed supaya identitas
// array-nya tetap sama antar render — kalau tidak, el-table melihat datanya
// "berganti" tiap render dan halaman jadi berat.
const rekapPerGolongan = computed(() => {
  const peta = new Map()
  for (const r of akhir.value.rekening || []) {
    if (!peta.has(r.golongan)) peta.set(r.golongan, [])
    peta.get(r.golongan).push(r)
  }
  return peta
})
const rekeningDinasPerGolongan = computed(() => {
  const peta = new Map()
  for (const s of akhir.value.skpd || []) {
    for (const r of s.rekening || []) {
      const kunci = `${s.kodeSkpd}|${r.golongan}`
      if (!peta.has(kunci)) peta.set(kunci, [])
      peta.get(kunci).push(r)
    }
  }
  return peta
})
function rekeningGolongan(row, kunci) {
  return rekeningDinasPerGolongan.value.get(`${row.kodeSkpd}|${kunci}`) || []
}
function rekeningRekapGolongan(kunci) {
  return rekapPerGolongan.value.get(kunci) || []
}

// Bulan terakhir tingkat kabupaten — dipakai sebagai label kolom di rekap, di
// mana angka tiap dinas memakai bulan terakhirnya masing-masing.
const labelBasis = computed(() => akhir.value.basis === 'tertinggi' ? 'Tertinggi' : 'Rata²')

// Dinas yang tiga kali bayar terakhirnya di atas rata-rata tahun berjalan —
// pertanda gajinya sedang naik, jadi basis rata-rata bisa kerendahan.
const skpdTrenNaik = computed(() =>
  (akhir.value.skpd || []).filter(s => s.tren > 1.01).sort((a, b) => b.tren - a.tren))

// ---- Sim Gaji: unggah balik file yang sudah diisi ----
//
// Bulan tidak pernah ditanyakan: file export mencantumkan bulan realisasi
// terakhir saat ia dibuat, dan angka SIM Gaji selalu berasal dari bulan itu.
const mengimpor = ref(false)

async function handleImportSim(uploadFile) {
  if (!uploadFile?.raw) return false
  mengimpor.value = true
  try {
    const hasil = await bacaSimGajiDariWorkbook(uploadFile.raw)

    if (String(hasil.tahun) !== String(tahun.value)) {
      ElMessage.error(`File ini untuk TA ${hasil.tahun}, sedangkan yang sedang dibuka TA ${tahun.value}.`)
      return false
    }
    if (!hasil.rows.length) {
      ElMessage.warning('Tidak ada kolom "Sim Gaji /Bln" yang terisi di file itu.')
      return false
    }

    // Isian dinas yang ada di file akan menimpa yang tersimpan, jadi pemakai
    // diberi tahu dulu berapa yang terpengaruh sebelum data lama tertindih.
    try {
      await ElMessageBox.confirm(
        `${hasil.dinasTerisi} dinas terisi (${hasil.rows.length} baris), Sim Gaji bulan ` +
        `${NAMA_BULAN[hasil.bulan]}. Isian tersimpan untuk dinas-dinas itu akan diganti. Lanjutkan?`,
        'Simpan isian Sim Gaji',
        { confirmButtonText: 'Ya, simpan', cancelButtonText: 'Batal', type: 'warning' }
      )
    } catch { return false }

    const res = await api.post('/sim-gaji', {
      tahun: tahun.value, bulan: hasil.bulan, data: hasil.rows,
    })
    ElMessage.success(`Tersimpan — ${res.data.count} baris dari ${res.data.dinas} dinas.`)
    await load()
    tab.value = 'akhir'
  } catch (e) {
    if (e instanceof BerkasTidakDikenal) ElMessage.error(e.message)
    else ElMessage.error(e?.response?.data?.error || 'Gagal membaca file: ' + (e?.message || e))
  } finally {
    mengimpor.value = false
  }
  return false
}

// ---- Perbandingan Rumus vs Sim Gaji (dalam tab Proyeksi Akhir) ----
const simInfo = computed(() => data.value.simInfo || { bulan: null, dinas: 0, totalDinas: 0, jumlah: 0 })
const adaSim = computed(() => simInfo.value.jumlah > 0)
// Isian dari bulan yang lebih tua dari realisasi terakhir berarti sudah
// tertinggal — angkanya masih boleh dipakai, tapi pemakai harus tahu.
const simTertinggal = computed(() =>
  adaSim.value && simInfo.value.bulan && data.value.bulanTerakhir &&
  simInfo.value.bulan < data.value.bulanTerakhir)

// Isian Sim Gaji nilainya jutaan — tanpa pemisah ribuan, salah ketik satu digit
// tidak akan kelihatan. Ditulis balik bertitik saat sel tidak sedang diketik.
function formatIsian(val) {
  if (val == null || val === '') return ''
  return Number(val).toLocaleString('id-ID', { maximumFractionDigits: 0 })
}
function uraiIsian(teks) {
  return String(teks ?? '').replace(/[^\d]/g, '')
}

function formatDeviasi(val) {
  if (val == null) return '\u2014'
  const n = Number(val) * 100
  return (n > 0 ? '+' : n < 0 ? '\u2212' : '') +
    Math.abs(n).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%'
}
function warnaDeviasi(val) {
  const n = Math.abs(Number(val) || 0)
  if (n > 0.05) return '#f56c6c'
  if (n >= 0.02) return '#e6a23c'
  return '#67c23a'
}
// Sim Gaji (Usulan, Pergeseran, dst) sekarang dihitung server lewat algoritma
// kantong-pooling yang sama dengan sisi rumus — nilainya tidak bisa ditambal
// di tempat kayak dulu (cuma menghitung ulang satu rekening tidak cukup,
// karena kantong-pooling melihat kebutuhan SELURUH dinas sekaligus). Jadi
// begitu tersimpan, seluruh data dimuat ulang — tabel akan tampak "melompat"
// sebentar, tapi angkanya selalu benar.
async function simpanSel(skpd, rek, nilai) {
  try {
    await api.put('/sim-gaji/baris', {
      tahun: tahun.value,
      bulan: simInfo.value.bulan || data.value.bulanTerakhir,
      kodeSkpd: skpd.kodeSkpd, namaSkpd: skpd.namaSkpd,
      kodeRekening: rek.kodeRekening, namaRekening: rek.namaRekening,
      komponen: '', nilai,
    })
    await load()
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || 'Gagal menyimpan')
  }
}

async function hapusSimGaji() {
  try {
    await ElMessageBox.confirm(
      'Seluruh isian Sim Gaji tahun ini akan dihapus. Angka proyeksi tidak terpengaruh.',
      'Hapus isian Sim Gaji',
      { confirmButtonText: 'Ya, hapus', cancelButtonText: 'Batal', type: 'warning' }
    )
  } catch { return }
  try {
    await api.delete(`/sim-gaji?tahun=${tahun.value}`)
    ElMessage.success('Isian Sim Gaji dihapus')
    await load()
  } catch (e) {
    ElMessage.error(e?.response?.data?.error || 'Gagal menghapus')
  }
}

// Dua export memakai unduhan yang sama, cuma beda pembangun workbook-nya.
function unduh(buf, nama) {
  const url = URL.createObjectURL(new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const a = document.createElement('a')
  a.href = url
  a.download = nama
  a.click()
  URL.revokeObjectURL(url)
}

async function exportExcel() {
  if (!rows.value.length) {
    ElMessage.warning('Tidak ada data untuk diekspor')
    return
  }
  exporting.value = true
  try {
    const buf = await buatWorkbookProyeksiGaji(data.value, { tahun: tahun.value })
    unduh(buf, namaFileProyeksiGaji(tahun.value, data.value.prefix, data.value.bulanTerakhir))
    ElMessage.success(`File diekspor — ${rows.value.length} sheet dinas`)
  } catch (e) {
    ElMessage.error('Gagal membuat file: ' + (e?.message || e))
  } finally {
    exporting.value = false
  }
}

// Berkas terpisah, bukan sheet tambahan di file utama: yang ini dicetak dan
// dibawa saat ditanya "rekening ini kurang, ambilnya dari mana", sementara file
// utama dipakai menyusun usulan alokasi. Dua keperluan, dua berkas.
async function exportKesiapan() {
  if (!rows.value.length) {
    ElMessage.warning('Tidak ada data untuk diekspor')
    return
  }
  if (!data.value.kesiapan) {
    ElMessage.warning('Data kesiapan rekening belum tersedia — muat ulang dulu')
    return
  }
  exportingKesiapan.value = true
  try {
    const buf = await buatWorkbookKesiapan(data.value, { tahun: tahun.value })
    unduh(buf, namaFileKesiapan(tahun.value, data.value.prefix, data.value.bulanTerakhir))
    const t = data.value.kesiapan.total
    ElMessage.success(`Lembar kesiapan diekspor — ${t.rekMentokTotal} rekening mentok, ${t.dinasPerluLuar} dinas perlu dari luar dinas`)
  } catch (e) {
    ElMessage.error('Gagal membuat file: ' + (e?.message || e))
  } finally {
    exportingKesiapan.value = false
  }
}

// ---- Cek Inputan: adu usulan proyeksi dengan pagu yang sudah benar-benar diinput ----
//
// File pembanding dibaca DI BROWSER saja dan tidak pernah dikirim ke server.
// Itu bukan penghematan, tapi syarat: kolom Pagu di seluruh perhitungan
// proyeksi berasal dari tabel anggaran_rekap, jadi kalau file ini ikut
// disimpan, pagunya berubah → usulannya ikut berubah → yang dibandingkan jadi
// dirinya sendiri.
const inputan = ref(null)
const membacaInputan = ref(false)
// Patokan pembanding: usulan sisi rumus atau sisi Sim Gaji. Dipilih pemakai
// karena yang dipakai waktu menginput bisa salah satunya.
const bandingSisi = ref('rumus')
// Selisih di bawah ini dianggap sesuai — waktu input, angka lazim dibulatkan.
const toleransiInputan = ref(0)
// Batas selisih TOTAL satu dinas-golongan. Di bawah ini, rekening yang meleset
// dianggap saling tutup — tampil, tapi tidak dihitung masalah.
const toleransiTotal = ref(0)

const banding = computed(() => inputan.value
  ? bandingkanInputan(akhir.value, inputan.value, {
      sisi: bandingSisi.value, toleransi: toleransiInputan.value,
    })
  : null)

// Rekening yang diinput di bawah kebutuhan riil sampai Desember — dirinci
// langsung di peringatannya, karena matriks tidak memuat kolom kebutuhan.
const barisDibawahKebutuhan = computed(() => (banding.value?.baris || [])
  .filter(r => r.dibawahKebutuhan)
  .sort((a, b) => (a.inputan - a.kebutuhan) - (b.inputan - b.kebutuhan)))

async function handleImportInputan(uploadFile) {
  if (!uploadFile?.raw) return false
  if (!rows.value.length) {
    ElMessage.warning('Muat data proyeksinya dulu sebelum mengunggah pembanding.')
    return false
  }
  membacaInputan.value = true
  try {
    const pertamaKali = !inputan.value
    const hasil = await bacaRekapAnggaran(uploadFile.raw, { prefix: data.value.prefix || prefix.value })
    inputan.value = hasil
    // Kalau isian Sim Gaji ada, itu yang lazimnya dipakai waktu menginput —
    // jadi dijadikan patokan awal, tapi tetap boleh digeser pemakai.
    if (pertamaKali && adaSim.value) bandingSisi.value = 'sim'
    tab.value = 'inputan'
    ElMessage.success(
      `${hasil.jumlahRekening} rekening dari ${hasil.jumlahDinas} dinas terbaca. ` +
      'File tidak disimpan ke server.')
  } catch (e) {
    if (e instanceof BerkasRekapTidakDikenal) ElMessage.error(e.message)
    else ElMessage.error('Gagal membaca file: ' + (e?.message || e))
  } finally {
    membacaInputan.value = false
  }
  return false
}

function lupakanInputan() {
  inputan.value = null
}

// ---- Matriks: perangkat daerah × komponen gaji, per golongan ----
//
// Susunan lembar kerja manual: satu tabel PNS, satu PPPK; tiap sel bisa
// dilihat sebagai Hitungan, Inputan, Selisih, atau hasil adu TRUE/FALSE.
const matriks = computed(() => matriksBanding(banding.value, { toleransiTotal: toleransiTotal.value }))
const golMatriks = ref(null)
const tampilMatriks = ref('cocok')
// 'semua' | 'beda' (ada sel FALSE, termasuk saling tutup) | 'signifikan'
const saringMatriks = ref('semua')
// Yang benar-benar perlu ditindak: dinas-golongan yang total selisihnya lewat
// batas. Rekening yang cuma saling tutup tidak ikut dihitung di sini.
const jumlahSignifikan = computed(() => matriks.value.reduce((a, m) => a + m.dinasSignifikan, 0))
const jumlahSalingTutup = computed(() => matriks.value.reduce((a, m) => a + m.dinasSalingTutup, 0))
const LABEL_STATUS_TOTAL = {
  cocok: { teks: 'COCOK', kelas: 'sel-true' },
  salingTutup: { teks: 'SALING TUTUP', kelas: 'sel-tutup' },
  signifikan: { teks: 'SIGNIFIKAN', kelas: 'sel-false' },
}
function kelasSelMatriks(row, c) {
  if (c.cocok) return 'sel-true'
  return row.status === 'salingTutup' ? 'sel-tutup' : 'sel-false'
}
const exportingMatriks = ref(false)

const matriksAktif = computed(() => {
  const daftar = matriks.value
  if (!daftar.length) return null
  return daftar.find(m => m.kunci === golMatriks.value) || daftar[0]
})
const barisMatriks = computed(() => {
  const m = matriksAktif.value
  if (!m) return []
  if (saringMatriks.value === 'beda') return m.baris.filter(d => !d.cocok)
  if (saringMatriks.value === 'signifikan') return m.baris.filter(d => d.status === 'signifikan')
  return m.baris
})

function nilaiSelMatriks(c) {
  if (tampilMatriks.value === 'hitungan') return c.hitungan
  if (tampilMatriks.value === 'inputan') return c.inputan
  return c.selisih
}
function judulSelMatriks(c) {
  return `Hitungan ${formatRp(c.hitungan)}${c.adaHitungan ? '' : ' (tidak ada di usulan)'}\n` +
    `Inputan ${formatRp(c.inputan)}${c.adaInputan ? '' : ' (tidak ada di berkas)'}\n` +
    `Selisih ${formatSelisih(c.selisih)}`
}
function ringkasMatriks({ columns }) {
  const m = matriksAktif.value
  return columns.map((col, i) => {
    if (i === 0) return tampilMatriks.value === 'cocok' ? 'Jumlah FALSE' : 'JUMLAH'
    const kode = col.columnKey
    if (tampilMatriks.value === 'cocok') {
      if (kode === '__semua') return `${m.dinasSignifikan} signifikan`
      return String(m.total.salah[kode] ?? '')
    }
    const pilih = (h, inp) => tampilMatriks.value === 'hitungan' ? h
      : tampilMatriks.value === 'inputan' ? inp : inp - h
    if (kode === '__semua') return formatRp(pilih(m.jumlahHitungan, m.jumlahInputan))
    if (!(kode in m.total.hitungan)) return ''
    return formatRp(pilih(m.total.hitungan[kode], m.total.inputan[kode]))
  })
}

async function exportMatriks() {
  if (!matriks.value.length) return
  exportingMatriks.value = true
  try {
    const buf = await buatWorkbookMatriksInputan(matriks.value, {
      tahun: tahun.value,
      sisi: bandingSisi.value,
      persenAcress: formatPersen(bandingSisi.value === 'sim' ? akhir.value.persenAkhirSim : akhir.value.persenAkhir),
      toleransi: toleransiInputan.value,
      toleransiTotal: toleransiTotal.value,
      namaBerkas: inputan.value?.namaBerkas || '-',
    })
    unduh(buf, namaFileMatriksInputan(tahun.value))
    ElMessage.success('Matriks cek inputan diekspor')
  } catch (e) {
    ElMessage.error('Gagal membuat file: ' + (e?.message || e))
  } finally {
    exportingMatriks.value = false
  }
}
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Proyeksi Gaji dan Tunjangan</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #909399;">
        Kebutuhan belanja gaji &amp; tunjangan sampai akhir tahun, per SKPD &rarr; per rekening.
        Tab <strong>Proyeksi Kebutuhan</strong> menunjukkan dinas dan rekening mana yang kurang anggaran;
        tab <strong>Proyeksi Akhir</strong> membagi ulang pagu sekabupaten jadi usulan alokasi sampai tutup tahun;
        tab <strong>Cek Inputan</strong> mengadu usulan itu dengan pagu yang sudah benar-benar diinput &bull;
        Sumber: Anggaran Rekap (pagu) &amp; Dokumen Realisasi (SP2D).
      </p>
    </div>

    <!-- Aksi -->
    <el-card style="margin-bottom: 16px;">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
        <span style="font-size: 12px; color: #606266;">Kode rekening</span>
        <el-input v-model="prefix" style="width: 130px;" @keyup.enter="load" />
        <el-button :icon="Refresh" :loading="loading" @click="load">Muat</el-button>
        <span style="font-size: 12px; color: #909399;">
          default <strong>5.1.01.01</strong> = Belanja Gaji dan Tunjangan ASN
        </span>
        <div style="margin-left: auto; display: flex; gap: 8px; align-items: center;">
          <el-upload :auto-upload="false" :show-file-list="false" accept=".xlsx" :on-change="handleImportSim">
            <el-button :icon="Upload" :loading="mengimpor">Import Sim Gaji</el-button>
          </el-upload>
          <el-button type="primary" :icon="Download" :loading="exporting" @click="exportExcel">
            Export Excel
          </el-button>
          <el-button type="warning" plain :icon="Download" :loading="exportingKesiapan" @click="exportKesiapan">
            Export Lembar Kesiapan
          </el-button>
        </div>
      </div>
      <div style="margin-top: 10px; font-size: 12px; color: #909399;">
        File Excel berisi 1 sheet per dinas (rekening urut kode) + sheet REKAP, PER BULAN, REKAP REKENING,
        <strong>PROYEKSI AKHIR</strong> (usulan alokasi per dinas), dan <strong>AKHIR REKENING</strong> (rinciannya
        per rekening, siap jadi lampiran usulan pergeseran).
        Kolom <strong>Sim Gaji /Bln</strong> dibiarkan kosong untuk diisi manual — begitu diisi, kolom Kebutuhan,
        Selisih, dan Status ikut terhitung ulang di Excel.
      </div>
      <div style="margin-top: 6px; font-size: 12px; color: #909399;">
        <strong>Export Lembar Kesiapan</strong> menghasilkan berkas terpisah yang menjawab pertanyaan lain:
        &ldquo;rekening ini kurang, ambilnya dari mana?&rdquo; Sheet <strong>JAWABAN</strong> memuat satu baris per
        rekening yang akan mentok beserta rekening sumbernya &mdash; gaji pokok didahulukan, sumber selalu dari dinas
        yang sama, dan yang tidak cukup ditandai perlu dari luar dinas. Ditambah sheet PER DINAS, PER REKENING, dan
        RINGKASAN.
      </div>
    </el-card>

    <el-tabs v-model="tab" class="tab-proyeksi">
      <el-tab-pane label="Proyeksi Kebutuhan" name="kebutuhan">
        <!-- Kartu ringkasan -->
        <el-card v-loading="loading" style="margin-bottom: 16px;">
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px;">
            <div>
              <div style="font-size: 12px; color: #67c23a; font-weight: 600;">Total Anggaran</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totals.pagu) }}</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #e6a23c; font-weight: 600;">Realisasi (SP2D)</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totals.sp2d) }}</div>
              <div style="font-size: 11px; color: #909399;">
                s.d. {{ labelBulanTerakhir }} &bull; {{ formatBulan(data.bulanGajiTerbayarTotal) }} bulan-gaji
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #409eff; font-weight: 600;">Sisa Anggaran</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totals.sisa) }}</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #606266; font-weight: 600;">Kebutuhan {{ data.bulanSisa }} Bulan</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totals.proyeksi) }}</div>
              <div style="font-size: 11px; color: #909399;">{{ rentangSisa }}</div>
            </div>
            <div>
              <div style="font-size: 12px; font-weight: 600;" :style="{ color: totals.selisih < 0 ? '#f56c6c' : '#67c23a' }">
                {{ totals.selisih < 0 ? 'Kurang' : 'Cukup / Sisa' }}
              </div>
              <div style="font-size: 20px; font-weight: 700;" :style="{ color: totals.selisih < 0 ? '#f56c6c' : '#67c23a' }">
                {{ formatMio(Math.abs(totals.selisih)) }}
              </div>
              <div style="font-size: 11px; color: #909399;">Sisa Anggaran &minus; Kebutuhan</div>
            </div>
          </div>
        </el-card>

        <!-- Peringatan -->
        <el-alert v-if="skpdKurang.length" type="error" :closable="false" show-icon style="margin-bottom: 12px;">
          <template #title>
            {{ skpdKurang.length }} SKPD dan {{ totalRekeningKurang }} rekening diproyeksikan
            <strong>kurang anggaran</strong> sampai akhir tahun — total kekurangan {{ formatMio(totalKekurangan) }}.
            Terbesar: {{ skpdKurang[0].namaSkpd }} ({{ formatMio(skpdKurang[0].selisih) }}).
          </template>
        </el-alert>

        <!-- Rekening yang kurang, lintas dinas -->
        <el-card v-if="rekeningKurang.length" style="margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px;">
            <el-icon :size="18" style="color: #f56c6c;"><WarningFilled /></el-icon>
            <span style="font-size: 14px; font-weight: 700; color: #303133;">Rekening yang Kurang Anggaran</span>
            <el-tag type="danger" size="small" effect="light">{{ rekeningKurang.length }} rekening</el-tag>
            <el-button text size="small" @click="tampilkanRekeningKurang = !tampilkanRekeningKurang" style="margin-left: auto;">
              {{ tampilkanRekeningKurang ? 'Sembunyikan' : 'Tampilkan' }}
            </el-button>
          </div>
          <p style="margin: 0 0 10px; font-size: 12px; color: #909399;">
            Dihitung per dinas lalu dikumpulkan — kekurangan di satu dinas tidak ditutup oleh dinas lain yang anggarannya
            lebih. Klik baris untuk melihat dinas mana saja. Ini juga yang ditandai merah di file Excel.
          </p>
          <el-table
            v-if="tampilkanRekeningKurang"
            :data="rekeningKurang"
            row-key="kodeRekening"
            border
            size="small"
            style="width: 100%;"
            :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }"
          >
            <el-table-column type="expand">
              <template #default="{ row }">
                <div style="padding: 8px 16px 12px 48px; background: #fffafa;">
                  <el-table :data="row.daftarKurang" size="small" style="width: 100%;">
                    <el-table-column prop="namaSkpd" label="SKPD" min-width="240" show-overflow-tooltip />
                    <el-table-column label="Anggaran" width="150" align="right">
                      <template #default="{ row: d }">{{ formatRp(d.pagu) }}</template>
                    </el-table-column>
                    <el-table-column label="Realisasi" width="150" align="right">
                      <template #default="{ row: d }">
                          <div>{{ formatRp(d.sp2d) }}</div>
                          <el-tooltip v-if="d.dibayar" placement="left">
                            <template #content>
                              <div style="max-width: 300px; font-size: 12px;">
                                Dibayar {{ formatBulan(d.dibayar) }} kali sejauh ini<template v-if="d.dibayarPerkiraan">
                                (perkiraan — memakai laju bayar dinas)</template>.
                                Kebutuhan sisa = {{ formatRp(d.sp2d) }} &divide; {{ formatBulan(d.dibayar) }} &times;
                                {{ data.bulanSisa }} = {{ formatRp(d.perBulanRutin * data.bulanSisa) }}.
                              </div>
                            </template>
                            <div style="font-size: 10px; color: #a8abb2;">&divide; {{ formatBulan(d.dibayar) }}&times;</div>
                          </el-tooltip>
                        </template>
                    </el-table-column>
                    <el-table-column label="Sisa" width="150" align="right">
                      <template #default="{ row: d }">{{ formatRp(d.sisa) }}</template>
                    </el-table-column>
                    <el-table-column :label="`Kebutuhan ${data.bulanSisa} Bln`" width="150" align="right">
                      <template #default="{ row: d }">{{ formatRp(d.proyeksi) }}</template>
                    </el-table-column>
                    <el-table-column label="Kekurangan" width="150" align="right">
                      <template #default="{ row: d }">
                        <span style="color: #f56c6c; font-weight: 600;">{{ formatRp(d.selisih) }}</span>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="Kode Rek" width="185">
              <template #default="{ row }">
                <span style="font-family: monospace; font-size: 11px; color: #606266;">{{ row.kodeRekening }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="namaRekening" label="Nama Rekening" min-width="240" show-overflow-tooltip />
            <el-table-column label="Dinas Kurang" prop="dinasKurang" width="120" align="center" sortable>
              <template #default="{ row }">
                <el-tag type="danger" size="small" effect="light">{{ row.dinasKurang }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="Total Kekurangan" prop="kekurangan" width="165" align="right" sortable>
              <template #default="{ row }">
                <span style="color: #f56c6c; font-weight: 700; font-variant-numeric: tabular-nums;">
                  {{ formatRp(row.kekurangan) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="Sisa Anggaran (kab.)" prop="sisa" width="165" align="right">
              <template #default="{ row }">
                <span style="font-variant-numeric: tabular-nums; color: #909399;">{{ formatRp(row.sisa) }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-alert v-if="skpdMenyimpang.length" type="warning" :closable="false" show-icon style="margin-bottom: 16px;">
          <template #title>
            {{ skpdMenyimpang.length }} SKPD laju bayarnya menyimpang &ge; 1 bulan-gaji dari kabupaten
            ({{ formatBulan(data.bulanGajiTerbayarTotal) }}) — cek kolom "Bulan-Gaji Dibayar" dan sheet PER BULAN
            sebelum memakai angka proyeksinya.
          </template>
        </el-alert>

        <el-empty
          v-if="!loading && !rows.length"
          description="Belum ada data. Pastikan Anggaran Rekap dan Dokumen Realisasi sudah diimport."
          :image-size="120"
        />

        <el-table
          v-else
          v-loading="loading"
          :data="rows"
          row-key="kodeSkpd"
          border
          size="small"
          style="width: 100%;"
          :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }"
        >
          <el-table-column type="expand">
            <template #default="{ row }">
              <div style="padding: 8px 16px 12px 48px; background: #fafcff;">
                <div style="font-size: 11px; color: #909399; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px;">
                  Rincian per rekening — {{ row.namaSkpd }}
                  <span v-if="rekeningKurangDi(row).length" style="color: #f56c6c;">
                    &bull; {{ rekeningKurangDi(row).length }} rekening kurang (baris merah)
                  </span>
                </div>
                <el-table :data="row.rekening" size="small" style="width: 100%;" :row-class-name="kelasBaris">
                  <el-table-column label="Kode Rek" width="180">
                    <template #default="{ row: d }">
                      <span style="font-family: monospace; font-size: 11px; color: #606266;">{{ d.kodeRekening }}</span>
                    </template>
                  </el-table-column>
                  <el-table-column prop="namaRekening" label="Nama Rekening" min-width="240" show-overflow-tooltip />
                  <el-table-column label="Anggaran" width="140" align="right">
                    <template #default="{ row: d }">{{ formatRp(d.pagu) }}</template>
                  </el-table-column>
                  <el-table-column label="Realisasi" width="140" align="right">
                    <template #default="{ row: d }">{{ formatRp(d.sp2d) }}</template>
                  </el-table-column>
                  <el-table-column label="Sisa" width="140" align="right">
                    <template #default="{ row: d }">{{ formatRp(d.sisa) }}</template>
                  </el-table-column>
                  <el-table-column :label="`Kebutuhan ${data.bulanSisa} Bln`" width="150" align="right">
                    <template #default="{ row: d }">{{ formatRp(d.proyeksi) }}</template>
                  </el-table-column>
                  <el-table-column label="Selisih" width="150" align="right">
                    <template #default="{ row: d }">
                      <span :style="{ color: d.selisih < 0 ? '#f56c6c' : '#67c23a', fontWeight: 600 }">
                        {{ formatRp(d.selisih) }}
                      </span>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="SKPD" min-width="240" sortable :sort-by="'namaSkpd'" show-overflow-tooltip>
            <template #default="{ row }">
              <div style="font-weight: 600; font-size: 13px; color: #303133;">{{ row.namaSkpd }}</div>
              <div style="font-size: 11px; color: #c0c4cc; font-family: monospace;">{{ row.kodeSkpd }}</div>
            </template>
          </el-table-column>

          <el-table-column label="Anggaran" prop="pagu" width="145" align="right" sortable>
            <template #default="{ row }">
              <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.pagu) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="Realisasi (SP2D)" prop="sp2d" width="145" align="right" sortable>
            <template #default="{ row }">
              <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.sp2d) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="Sisa Anggaran" prop="sisa" width="145" align="right" sortable>
            <template #default="{ row }">
              <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.sisa) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="Rata²/Bln" prop="perBulanRutin" width="140" align="right" sortable>
            <template #default="{ row }">
              <span style="font-variant-numeric: tabular-nums; color: #606266;">{{ formatRp(row.perBulanRutin) }}</span>
            </template>
          </el-table-column>

          <el-table-column :label="`Kebutuhan ${data.bulanSisa} Bln`" prop="proyeksi" width="150" align="right" sortable>
            <template #default="{ row }">
              <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.proyeksi) }}</span>
            </template>
          </el-table-column>

          <el-table-column label="Selisih" prop="selisih" width="150" align="right" sortable>
            <template #default="{ row }">
              <span :style="{ color: row.selisih < 0 ? '#f56c6c' : '#67c23a', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
                {{ formatRp(row.selisih) }}
              </span>
            </template>
          </el-table-column>

          <el-table-column label="Status" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.selisih < 0 ? 'danger' : 'success'" size="small" effect="light">
                {{ row.selisih < 0 ? 'KURANG' : 'CUKUP' }}
              </el-tag>
            </template>
          </el-table-column>

          <el-table-column label="Rekening Kurang" width="135" align="center"
            :sort-by="(row) => rekeningKurangDi(row).length" sortable>
            <template #default="{ row }">
              <el-tooltip v-if="rekeningKurangDi(row).length" placement="left">
                <template #content>
                  <div style="white-space: pre-line; max-width: 420px; font-size: 12px;">{{ ringkasRekeningKurang(row) }}</div>
                </template>
                <el-tag type="danger" size="small" effect="dark">
                  {{ rekeningKurangDi(row).length }} rekening
                </el-tag>
              </el-tooltip>
              <span v-else style="color: #c0c4cc;">—</span>
            </template>
          </el-table-column>

          <el-table-column label="Bulan-Gaji Dibayar" width="130" align="center" prop="bulanGajiTerbayar" sortable>
            <template #default="{ row }">
              <span style="font-variant-numeric: tabular-nums;"
                :style="{ color: menyimpang(row) ? '#e6a23c' : '#606266', fontWeight: menyimpang(row) ? 700 : 400 }">
                {{ formatBulan(row.bulanGajiTerbayar) }}
                <el-tooltip
                  v-if="menyimpang(row)"
                  :content="row.pembagiPerkiraan
                    ? 'Realisasi bulanan belum bisa dihitung — dipakai jumlah bulan kalender'
                    : 'Laju bayar menyimpang dari kabupaten — cek sheet PER BULAN'"
                >
                  <el-icon style="vertical-align: -2px;"><WarningFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- =============== TAB 2: PROYEKSI AKHIR (USULAN ALOKASI) =============== -->
      <el-tab-pane name="akhir">
        <template #label>
          Proyeksi Akhir
          <el-tag v-if="akhir.jumlahTambah" type="warning" size="small" effect="light" style="margin-left: 6px;">
            {{ akhir.jumlahTambah }} perlu tambah
          </el-tag>
          <el-badge v-if="adaSim" :value="simInfo.dinas" type="primary" class="lencana-sim" />
        </template>

        <el-card style="margin-bottom: 16px;">
          <p style="margin: 0 0 12px; font-size: 12px; color: #606266; line-height: 1.7;">
            Anggaran gaji sekabupaten diperlakukan sebagai <strong>satu kantong</strong>. Tiap rekening tiap dinas
            dijatah kebutuhan riilnya sampai Desember, lalu ditambah acress. Kalau jumlahnya melebihi isi kantong,
            kekurangannya <strong>disebar ke semua dinas</strong> dengan memangkas acress secara proporsional — bukan
            dengan memotong kebutuhan gajinya, jadi tidak ada dinas yang kehabisan gaji sebelum tutup tahun.
            Urutan kolomnya: <strong>Pagu &middot; Realisasi &middot; {{ labelBasis }} &middot; Kebutuhan &middot;
            Acress &middot; Usulan &middot; Pergeseran</strong> &mdash; itu sisi <strong>rumus</strong> (dari tren
            realisasi SP2D). Begitu isian Sim Gaji ada, kolom yang sama diulang bertanda <strong>(Sim)</strong>
            di sebelahnya: rantai hitungan yang sama persis, cuma kebutuhannya dari isian Sim Gaji.
          </p>
          <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
            <div>
              <div style="font-size: 12px; color: #606266; margin-bottom: 6px;">Dasar proyeksi (per rekening)</div>
              <el-radio-group v-model="basis" size="small" @change="load">
                <el-radio-button value="rata">Rata² tiap bayar</el-radio-button>
                <el-radio-button value="tertinggi">Tertinggi sekali bayar</el-radio-button>
              </el-radio-group>
              <div style="font-size: 11px; color: #909399; margin-top: 6px; max-width: 460px; line-height: 1.6;">
                Dihitung per rekening, bukan per dinas. <strong>Rata²</strong> = realisasi &divide; berapa kali rekening itu
                dibayar. <strong>Tertinggi</strong> = nilai sekali bayar yang paling besar — dipakai kalau ingin berjaga-jaga
                kalau-kalau gaji naik di sisa tahun. Bulan yang memuat dua kali pembayaran dibagi dulu sebelum dibandingkan.
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #606266; margin-bottom: 6px;">Acress</div>
              <el-input-number v-model="persenCadangan" :min="0" :max="25" :step="0.5" :precision="2"
                size="small" controls-position="right" style="width: 130px;" @change="load" />
              <div style="font-size: 11px; color: #909399; margin-top: 6px; max-width: 330px; line-height: 1.6;">
                persen — dikalikan ke kebutuhan <strong>tiap rekening</strong>, bukan ke total dinas.
                Usulan = Kebutuhan + Acress.
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #606266; margin-bottom: 6px;">Tambahan Fix (Pembulatan &amp; Tunj. Khusus)</div>
              <el-input-number v-model="tambahanFix" :min="0" :step="50000" :precision="0"
                size="small" controls-position="right" style="width: 150px;" @change="load" />
              <div style="font-size: 11px; color: #909399; margin-top: 6px; max-width: 330px; line-height: 1.6;">
                rupiah, FLAT — ditempelkan di atas Acress khusus rekening <strong>Pembulatan Gaji</strong> dan
                <strong>Tunjangan PPh/Tunjangan Khusus</strong> tiap dinas (tidak ikut dipotong proporsional kalau
                kantong kurang). Dua rekening ini paling sering kurang walau sudah dapat acress.
                Hanya untuk golongan yang memang ada pegawainya &mdash; dinas tanpa PPPK tidak dapat tambahan di
                rekening PPPK.
              </div>
            </div>
            <el-alert v-if="skpdTrenNaik.length" type="warning" :closable="false" style="flex: 1; min-width: 260px;">
              <template #title>
                <span style="font-size: 12px;">
                  {{ skpdTrenNaik.length }} dinas 3 kali bayar terakhirnya di atas rata-rata (tertinggi
                  {{ formatBulan(skpdTrenNaik[0].tren) }}&times;) — kalau khawatir, pakai basis
                  <strong>Tertinggi</strong> dan bandingkan angkanya.
                </span>
              </template>
            </el-alert>
          </div>
        </el-card>

        <!-- Sim Gaji: status isian + perbandingan dengan rumus -->
        <el-alert v-if="!adaSim" type="info" :closable="false" show-icon
          title="Belum ada isian Sim Gaji"
          style="margin-bottom: 16px;">
          <div style="font-size: 12px; line-height: 1.7;">
            Export Excel dulu, isi kolom kuning <strong>Sim Gaji /Bln</strong> di sheet tiap dinas dari aplikasi
            SIM Gaji, lalu unggah kembali filenya lewat tombol <strong>Import Sim Gaji</strong> di atas.
            Bulannya ikut file &mdash; tidak perlu dipilih. Begitu terisi, kolom Usulan &amp; Pergeseran di bawah
            ini akan tampil dua sisi: dari rumus dan dari Sim Gaji, dihitung dengan algoritma yang sama persis.
          </div>
        </el-alert>
        <template v-else>
          <el-alert v-if="simTertinggal" type="warning" :closable="false" show-icon
            style="margin-bottom: 16px;"
            :title="`Isian Sim Gaji dari bulan ${NAMA_BULAN[simInfo.bulan]}, sedangkan realisasi sudah sampai ${NAMA_BULAN[data.bulanTerakhir]}`">
            <div style="font-size: 12px;">
              Perbandingannya masih terbaca, tapi selisihnya bisa berasal dari kenaikan gaji yang belum ikut terisi.
              Export ulang lalu isi lagi kalau ingin angkanya sebanding.
            </div>
          </el-alert>
          <div style="display: flex; justify-content: flex-end; margin-bottom: 8px;">
            <el-button link type="danger" size="small" @click="hapusSimGaji">Hapus isian Sim Gaji</el-button>
          </div>
        </template>

        <!-- Kartu ringkasan usulan -->
        <el-card v-loading="loading" style="margin-bottom: 16px;">
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px;">
            <div>
              <div style="font-size: 12px; color: #409eff; font-weight: 600;">Pagu Tersedia</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(akhir.kantong) }}</div>
              <div style="font-size: 11px; color: #909399;">
                kantong bersama {{ akhir.skpd.length - akhir.jumlahTerkunci }} dinas
                <template v-if="akhir.jumlahTerkunci">&bull; {{ akhir.jumlahTerkunci }} dikunci</template>
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #606266; font-weight: 600;">Kebutuhan s.d. Desember</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(akhir.totalKebutuhan) }}</div>
              <div style="font-size: 11px; color: #909399;">
                realisasi + {{ labelBasis.toLowerCase() }} &times; {{ data.bulanSisa }} bulan
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #e6a23c; font-weight: 600;">Acress</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(akhir.totalCadanganAkhir) }}</div>
              <div style="font-size: 11px; color: #909399;">
                {{ formatPersen(akhir.persenAkhir) }} dari kebutuhan
                <template v-if="akhir.faktorPotong > 0">(diminta {{ formatPersen(akhir.persenCadangan) }})</template>
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #67c23a; font-weight: 600;">Usulan</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(akhir.totalAlokasiAktif) }}</div>
              <div style="font-size: 11px; color: #909399;">
                pergeseran {{ formatMio(akhir.pergeseranMasuk) }} antar dinas
              </div>
            </div>
            <div>
              <div style="font-size: 12px; font-weight: 600;" :style="{ color: akhir.cukup ? '#67c23a' : '#f56c6c' }">
                {{ akhir.cukup ? 'Sisa Kantong' : 'Kekurangan Riil' }}
              </div>
              <div style="font-size: 20px; font-weight: 700;" :style="{ color: akhir.cukup ? '#67c23a' : '#f56c6c' }">
                {{ formatMio(akhir.cukup ? akhir.sisaKantong : akhir.defisitRiil) }}
              </div>
              <div style="font-size: 11px; color: #909399;">
                {{ akhir.cukup ? 'pagu tersisa setelah usulan' : 'tidak bisa ditutup pergeseran' }}
              </div>
            </div>
          </div>
        </el-card>

        <!-- Ringkasan sekali lagi dari basis Sim Gaji — algoritma kantong-pooling
             yang SAMA, cuma kebutuhannya dari isian Sim Gaji (rekening yang belum
             diisi jatuh balik ke rata²). Bukan hitungan terpisah, jadi dua sisi
             ini selalu bisa dibandingkan apa adanya. -->
        <el-card v-if="adaSim" v-loading="loading" style="margin-bottom: 16px;">
          <div style="font-size: 14px; font-weight: 700; color: #303133; margin-bottom: 4px;">
            Sekali Lagi dari Sim Gaji
          </div>
          <p style="margin: 0 0 12px; font-size: 12px; color: #909399; line-height: 1.7;">
            Rantai hitungan yang sama persis ({{ formatPersen(persenCadangan) }} acress, kantong pagu yang sama) —
            bedanya cuma kebutuhannya dari isian Sim Gaji, bukan tren realisasi. Rekening yang belum diisi jatuh
            balik ke rata² (bukan 0), supaya dinas yang isiannya baru sebagian tetap punya kebutuhan yang wajar.
          </p>
          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px;">
            <div>
              <div style="font-size: 12px; color: #409eff; font-weight: 600;">Pagu Tersedia</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(akhir.kantong) }}</div>
              <div style="font-size: 11px; color: #909399;">sama dengan sisi rumus</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #606266; font-weight: 600;">Kebutuhan s.d. Desember</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(akhir.totalKebutuhanSim) }}</div>
              <div style="font-size: 11px; color: #909399;">
                <span :style="{ color: warnaPergeseran(akhir.totalKebutuhanSim - akhir.totalKebutuhan) }">
                  {{ formatSelisih(akhir.totalKebutuhanSim - akhir.totalKebutuhan) }}
                </span> vs rumus
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #e6a23c; font-weight: 600;">Acress</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(akhir.totalCadanganAkhirSim) }}</div>
              <div style="font-size: 11px; color: #909399;">
                {{ formatPersen(akhir.persenAkhirSim) }} dari kebutuhan
                <template v-if="akhir.faktorPotongSim > 0">(diminta {{ formatPersen(akhir.persenCadangan) }})</template>
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #67c23a; font-weight: 600;">Usulan</div>
              <div style="font-size: 20px; font-weight: 700;">{{ formatMio(akhir.totalAlokasiAktifSim) }}</div>
              <div style="font-size: 11px; color: #909399;">
                <span :style="{ color: warnaPergeseran(akhir.totalAlokasiAktifSim - akhir.totalAlokasiAktif) }">
                  {{ formatSelisih(akhir.totalAlokasiAktifSim - akhir.totalAlokasiAktif) }}
                </span> vs rumus
              </div>
            </div>
            <div>
              <div style="font-size: 12px; font-weight: 600;" :style="{ color: akhir.cukupSim ? '#67c23a' : '#f56c6c' }">
                {{ akhir.cukupSim ? 'Sisa Kantong' : 'Kekurangan Riil' }}
              </div>
              <div style="font-size: 20px; font-weight: 700;" :style="{ color: akhir.cukupSim ? '#67c23a' : '#f56c6c' }">
                {{ formatMio(akhir.cukupSim ? akhir.sisaKantongSim : akhir.defisitRiilSim) }}
              </div>
              <div style="font-size: 11px; color: #909399;">dari basis Sim Gaji</div>
            </div>
          </div>
        </el-card>

        <el-alert v-if="!akhir.cukup" type="error" :closable="false" show-icon style="margin-bottom: 16px;">
          <template #title>
            Pagu gaji sekabupaten <strong>kurang {{ formatMio(akhir.defisitRiil) }}</strong> dari kebutuhan riil sampai Desember.
          </template>
          <template #default>
            <div style="font-size: 12px; line-height: 1.7;">
              Acress sudah dinolkan dan seluruh pagu berlebih sudah ditarik, tapi kekurangan ini tetap tidak bisa
              disebar tanpa membuat ada dinas kehabisan gaji sebelum tutup tahun. Usulan di bawah sudah dipasang
              sama persis dengan kebutuhan tiap rekening — selisih {{ formatRp(akhir.defisitRiil) }} perlu tambahan
              anggaran atau pergeseran dari belanja di luar rekening {{ data.prefix }}.
            </div>
          </template>
        </el-alert>
        <el-alert v-else-if="akhir.faktorPotong > 0" type="warning" :closable="false" show-icon style="margin-bottom: 16px;">
          <template #title>
            Kekurangan {{ formatMio(akhir.kelebihan) }} disebar ke seluruh dinas — acress dipangkas
            {{ formatPersen(akhir.persenCadangan) }} &rarr; <strong>{{ formatPersen(akhir.persenAkhir) }}</strong>.
          </template>
          <template #default>
            <div style="font-size: 12px; line-height: 1.7;">
              Kebutuhan + acress {{ formatPersen(akhir.persenCadangan) }} berjumlah {{ formatRp(akhir.totalIdeal) }},
              melebihi pagu tersedia {{ formatRp(akhir.kantong) }}. Kekurangannya ditanggung bersama dengan memangkas
              acress tiap rekening secara proporsional; tidak ada satu pun dinas yang usulannya jatuh di bawah kebutuhan
              gajinya sampai Desember. Hasilnya nol jumlah: {{ formatRp(akhir.pergeseranMasuk) }} masuk ke
              {{ akhir.jumlahTambah }} dinas, diambil dari {{ akhir.jumlahKurangi }} dinas yang pagunya berlebih —
              jadi tidak perlu tambahan anggaran, cukup pergeseran.
            </div>
          </template>
        </el-alert>
        <el-alert v-else type="success" :closable="false" show-icon style="margin-bottom: 16px;">
          <template #title>
            Pagu cukup — seluruh rekening dapat kebutuhan penuh + acress {{ formatPersen(akhir.persenCadangan) }},
            masih tersisa {{ formatMio(akhir.sisaKantong) }}.
          </template>
        </el-alert>

        <el-alert v-if="akhirTanpaRealisasi.length" type="info" :closable="false" show-icon style="margin-bottom: 16px;">
          <template #title>
            {{ akhirTanpaRealisasi.length }} dinas punya rekening berpagu yang belum sekali pun dibayar — pagunya
            diusulkan ditarik penuh. Periksa dulu komponen yang memang baru dibayar sekali di akhir tahun.
          </template>
        </el-alert>

        <!-- Rekap per golongan pegawai -->
        <el-card v-if="akhir.golongan.length" style="margin-bottom: 16px;">
          <div style="font-size: 14px; font-weight: 700; color: #303133; margin-bottom: 4px;">Rekap per Golongan Pegawai</div>
          <p style="margin: 0 0 12px; font-size: 12px; color: #909399;">
            Dipisah dari segmen terakhir kode rekening (&hellip;{{ akhir.golongan.map(g => g.kunci).join(', &hellip;') }}) —
            seluruh rekening PNS berkumpul sendiri dan PPPK sendiri. Kolom polos = sisi rumus (realisasi + tren),
            kolom bertanda <strong>(Sim)</strong> = rantai hitungan yang sama dari isian Sim Gaji.
          </p>
          <el-table
            :data="akhir.golongan"
            row-key="kunci"
            border
            size="small"
            class="tabel-rapat"
            style="width: 100%;"
            :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }"
          >
            <el-table-column label="Golongan" width="100">
              <template #default="{ row }">
                <el-tag :type="row.label === 'PNS' ? 'primary' : 'success'" size="small" effect="light">{{ row.label }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="Rek" prop="jumlahRekening" width="55" align="center" />
                <el-table-column label="Pagu Sekarang" prop="pagu" min-width="130" align="right" sortable>
                  <template #default="{ row }">
                    <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.pagu) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="Realisasi" prop="sp2d" min-width="130" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.sp2d) }}</div>
                    <div v-if="row.dibayar" style="font-size: 10px; color: #a8abb2;">{{ formatBulan(row.dibayar) }}&times; bayar</div>
                  </template>
                </el-table-column>
                <el-table-column :label="labelBasis" prop="perBulanRutin" min-width="125" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.perBulanRutin) }}</div>
                    <div v-if="row.tren" style="font-size: 10px;" :style="{ color: row.tren > 1.01 ? '#e6a23c' : '#a8abb2' }">
                      tren {{ formatBulan(row.tren) }}&times;
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="Kebutuhan s.d. Des" prop="kebutuhan" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.kebutuhan) }}</div>
                    <div style="font-size: 10px; color: #a8abb2;">realisasi + {{ labelBasis.toLowerCase() }}&times;{{ data.bulanSisa }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="Acress" prop="cadanganAkhir" min-width="125" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums; color: #e6a23c;">{{ formatRp(row.cadanganAkhir) }}</div>
                    <div style="font-size: 10px; color: #a8abb2;">{{ formatPersen(akhir.persenAkhir) }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="Usulan" prop="alokasi" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums; font-weight: 700;">{{ formatRp(row.alokasi) }}</div>
                    <div style="font-size: 10px; color: #a8abb2;">kebutuhan + acress</div>
                  </template>
                </el-table-column>
                <el-table-column label="Pergeseran" prop="pergeseran" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <span :style="{ color: warnaPergeseran(row.pergeseran), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
                      {{ formatSelisih(row.pergeseran) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column v-if="adaSim" label="Kebutuhan (Sim)" prop="kebutuhanSim" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.kebutuhanSim) }}</div>
                    <div style="font-size: 10px;" :style="{ color: warnaPergeseran(row.kebutuhanSim - row.kebutuhan) }">
                      {{ formatSelisih(row.kebutuhanSim - row.kebutuhan) }} vs rumus
                    </div>
                  </template>
                </el-table-column>
                <el-table-column v-if="adaSim" label="Acress (Sim)" prop="cadanganAkhirSim" min-width="125" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums; color: #e6a23c;">{{ formatRp(row.cadanganAkhirSim) }}</div>
                    <div style="font-size: 10px; color: #a8abb2;">{{ formatPersen(akhir.persenAkhirSim) }}</div>
                  </template>
                </el-table-column>
                <el-table-column v-if="adaSim" label="Usulan (Sim)" prop="alokasiSim" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums; font-weight: 700;">{{ formatRp(row.alokasiSim) }}</div>
                    <div style="font-size: 10px; color: #a8abb2;">kebutuhan sim + acress</div>
                  </template>
                </el-table-column>
                <el-table-column v-if="adaSim" label="Pergeseran (Sim)" prop="pergeseranSim" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <span :style="{ color: warnaPergeseran(row.pergeseranSim), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
                      {{ formatSelisih(row.pergeseranSim) }}
                    </span>
                  </template>
                </el-table-column>
          </el-table>
        </el-card>

        <!-- Usulan per rekening, lintas dinas, dikelompokkan per golongan -->
        <el-card style="margin-bottom: 16px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px;">
            <span style="font-size: 14px; font-weight: 700; color: #303133;">Usulan per Rekening (lintas dinas)</span>
            <el-button text size="small" @click="tampilkanRekeningAkhir = !tampilkanRekeningAkhir" style="margin-left: auto;">
              {{ tampilkanRekeningAkhir ? 'Sembunyikan' : 'Tampilkan' }}
            </el-button>
          </div>
          <p style="margin: 0 0 10px; font-size: 12px; color: #909399;">
            Komponen gaji mana yang pagunya kurang dan mana yang berlebih. Perhatikan kolom
            <strong>{{ labelBasis }}</strong>: itulah angka yang dikalikan {{ data.bulanSisa }} bulan sisa.
            Baris kecil "&times; bayar" menunjukkan berapa kali rekening itu sudah dibayar — iuran BPJS hanya sekali
            sebulan, sedangkan gaji pokok ikut terbayar di bulan THR dan gaji ke-13.
          </p>
          <template v-if="tampilkanRekeningAkhir">
            <div v-for="g in akhir.golongan" :key="g.kunci" style="margin-bottom: 14px;">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
                <el-tag :type="g.label === 'PNS' ? 'primary' : 'success'" size="small" effect="dark">{{ g.label }}</el-tag>
                <span style="font-size: 12px; color: #909399;">{{ g.jumlahRekening }} rekening &bull; kode &hellip;{{ g.kunci }}</span>
                <div style="margin-left: auto; text-align: right; line-height: 1.5;">
                  <div style="font-size: 12px; color: #606266;">
                    Kebutuhan {{ formatRp(g.kebutuhan) }} + acress {{ formatRp(g.cadanganAkhir) }} =
                    <strong>{{ formatRp(g.alokasi) }}</strong>
                    (<span :style="{ color: warnaPergeseran(g.pergeseran) }">{{ formatSelisih(g.pergeseran) }}</span>)
                  </div>
                  <div v-if="adaSim" style="font-size: 12px; color: #909399;">
                    Sim Gaji: {{ formatRp(g.kebutuhanSim) }} + {{ formatRp(g.cadanganAkhirSim) }} =
                    <strong>{{ formatRp(g.alokasiSim) }}</strong>
                    (<span :style="{ color: warnaPergeseran(g.pergeseranSim) }">{{ formatSelisih(g.pergeseranSim) }}</span>)
                  </div>
                </div>
              </div>
              <el-table
                :data="rekeningRekapGolongan(g.kunci)"
                row-key="kodeRekening"
                border
                size="small"
                class="tabel-rapat"
                style="width: 100%;"
                :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }"
              >
                <el-table-column label="Rek" width="88">
                  <template #default="{ row }">
                    <el-tooltip :content="row.kodeRekening" placement="right">
                      <span style="font-family: monospace; font-size: 11px; color: #606266;">{{ kodeSingkat(row.kodeRekening) }}</span>
                    </el-tooltip>
                    <div style="font-size: 10px; color: #a8abb2;">
                      <span style="color: #e6a23c;">{{ row.dinasTambah }}</span>/<span style="color: #409eff;">{{ row.dinasKurangi }}</span> dinas
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="namaRekening" label="Nama Rekening" min-width="150" show-overflow-tooltip />
                <el-table-column label="Pagu Sekarang" prop="pagu" min-width="130" align="right" sortable>
                  <template #default="{ row }">
                    <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.pagu) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="Realisasi" prop="sp2d" min-width="130" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.sp2d) }}</div>
                    <div v-if="row.dibayar" style="font-size: 10px; color: #a8abb2;">{{ formatBulan(row.dibayar) }}&times; bayar</div>
                  </template>
                </el-table-column>
                <el-table-column :label="labelBasis" prop="perBulanRutin" min-width="125" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.perBulanRutin) }}</div>
                    <div v-if="row.tren" style="font-size: 10px;" :style="{ color: row.tren > 1.01 ? '#e6a23c' : '#a8abb2' }">
                      tren {{ formatBulan(row.tren) }}&times;
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="Kebutuhan s.d. Des" prop="kebutuhan" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.kebutuhan) }}</div>
                    <div style="font-size: 10px; color: #a8abb2;">realisasi + {{ labelBasis.toLowerCase() }}&times;{{ data.bulanSisa }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="Acress" prop="cadanganAkhir" min-width="125" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums; color: #e6a23c;">{{ formatRp(row.cadanganAkhir) }}</div>
                    <div style="font-size: 10px; color: #a8abb2;">{{ formatPersen(akhir.persenAkhir) }}</div>
                  </template>
                </el-table-column>
                <el-table-column label="Usulan" prop="alokasi" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums; font-weight: 700;">{{ formatRp(row.alokasi) }}</div>
                    <div style="font-size: 10px; color: #a8abb2;">kebutuhan + acress</div>
                  </template>
                </el-table-column>
                <el-table-column label="Pergeseran" prop="pergeseran" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <span :style="{ color: warnaPergeseran(row.pergeseran), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
                      {{ formatSelisih(row.pergeseran) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column v-if="adaSim" label="Kebutuhan (Sim)" prop="kebutuhanSim" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.kebutuhanSim) }}</div>
                    <div style="font-size: 10px;" :style="{ color: warnaPergeseran(row.kebutuhanSim - row.kebutuhan) }">
                      {{ formatSelisih(row.kebutuhanSim - row.kebutuhan) }} vs rumus
                    </div>
                  </template>
                </el-table-column>
                <el-table-column v-if="adaSim" label="Acress (Sim)" prop="cadanganAkhirSim" min-width="125" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums; color: #e6a23c;">{{ formatRp(row.cadanganAkhirSim) }}</div>
                    <div style="font-size: 10px; color: #a8abb2;">{{ formatPersen(akhir.persenAkhirSim) }}</div>
                  </template>
                </el-table-column>
                <el-table-column v-if="adaSim" label="Usulan (Sim)" prop="alokasiSim" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <div style="font-variant-numeric: tabular-nums; font-weight: 700;">{{ formatRp(row.alokasiSim) }}</div>
                    <div style="font-size: 10px; color: #a8abb2;">kebutuhan sim + acress</div>
                  </template>
                </el-table-column>
                <el-table-column v-if="adaSim" label="Pergeseran (Sim)" prop="pergeseranSim" min-width="140" align="right" sortable>
                  <template #default="{ row }">
                    <span :style="{ color: warnaPergeseran(row.pergeseranSim), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
                      {{ formatSelisih(row.pergeseranSim) }}
                    </span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </template>
        </el-card>

        <!-- Usulan per dinas -->
        <el-table
          v-loading="loading"
          :data="akhir.skpd"
          row-key="kodeSkpd"
          border
          size="small"
          class="tabel-rapat"
          style="width: 100%;"
          :row-class-name="kelasBarisAkhir"
          :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }"
        >
          <el-table-column type="expand" width="40">
            <template #default="{ row }">
              <div style="padding: 10px 12px 12px 20px; background: #fafcff;">
                <div class="dasar-hitung">
                  <div>
                    <span class="label">Realisasi s.d. sekarang</span>
                    <span class="nilai">{{ formatRp(row.sp2d) }}</span>
                    <span class="ket">bulan terakhir {{ row.bulanTerakhirSkpd ? namaBulan(row.bulanTerakhirSkpd) : '—' }}</span>
                  </div>
                  <div>
                    <span class="label">Rata² tiap kali bayar</span>
                    <span class="nilai">{{ formatRp(row.rataRata) }}</span>
                    <span class="ket">dipakai kalau basis "Rata²"</span>
                  </div>
                  <div :class="{ sorot: akhir.basis === 'tertinggi' || row.tren > 1.01 }">
                    <span class="label">Tertinggi sekali bayar</span>
                    <span class="nilai">{{ formatRp(row.tertinggi) }}</span>
                    <span class="ket">
                      {{ row.rataRata > 0 ? formatBulan(row.tertinggi / row.rataRata) + '× rata²' : '—' }}
                      &bull; 3 bayar terakhir {{ formatBulan(row.tren) }}&times;
                    </span>
                  </div>
                  <div>
                    <span class="label">Kebutuhan {{ data.bulanSisa }} bulan</span>
                    <span class="nilai">{{ formatRp(row.proyeksi) }}</span>
                    <span class="ket">{{ labelBasis }} &times; {{ data.bulanSisa }}</span>
                  </div>
                  <div>
                    <span class="label">Kebutuhan s.d. Desember</span>
                    <span class="nilai">{{ formatRp(row.kebutuhan) }}</span>
                    <span class="ket">realisasi + kebutuhan sisa bulan</span>
                  </div>
                  <div>
                    <span class="label">Acress</span>
                    <span class="nilai">{{ row.terkunci ? '—' : formatRp(row.cadanganAkhir) }}</span>
                    <span class="ket">{{ row.terkunci ? 'dinas dikunci' : formatPersen(row.persenAkhir) + ' dari kebutuhan' }}</span>
                  </div>
                  <div v-if="adaSim">
                    <span class="label">Kebutuhan s.d. Desember (Sim Gaji)</span>
                    <span class="nilai">{{ formatRp(row.kebutuhanSim) }}</span>
                    <span class="ket">realisasi + sim &times; sisa bulan</span>
                  </div>
                  <div v-if="adaSim" :class="{ sorot: row.pergeseranSim > 0 }">
                    <span class="label">Usulan (Sim Gaji)</span>
                    <span class="nilai">{{ formatRp(row.alokasiSim) }}</span>
                    <span class="ket" :style="{ color: warnaPergeseran(row.pergeseranSim) }">
                      {{ formatSelisih(row.pergeseranSim) }} vs pagu
                    </span>
                  </div>
                </div>

                <div v-for="g in row.golongan" :key="g.kunci" style="margin-bottom: 12px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                    <el-tag :type="g.label === 'PNS' ? 'primary' : 'success'" size="small" effect="dark">{{ g.label }}</el-tag>
                    <span style="font-size: 11px; color: #909399;">{{ g.jumlahRekening }} rekening</span>
                    <div style="margin-left: auto; text-align: right; line-height: 1.5;">
                      <div style="font-size: 11px; color: #606266;">
                        Kebutuhan {{ formatRp(g.kebutuhan) }} + acress {{ formatRp(g.cadanganAkhir) }} =
                        <strong>{{ formatRp(g.alokasi) }}</strong>
                        (<span :style="{ color: warnaPergeseran(g.pergeseran) }">{{ formatSelisih(g.pergeseran) }}</span>)
                      </div>
                      <div v-if="adaSim" style="font-size: 11px; color: #909399;">
                        Sim Gaji: {{ formatRp(g.kebutuhanSim) }} + {{ formatRp(g.cadanganAkhirSim) }} =
                        <strong>{{ formatRp(g.alokasiSim) }}</strong>
                        (<span :style="{ color: warnaPergeseran(g.pergeseranSim) }">{{ formatSelisih(g.pergeseranSim) }}</span>)
                      </div>
                    </div>
                  </div>
                  <el-table :data="rekeningGolongan(row, g.kunci)" size="small" class="tabel-rapat"
                    style="width: 100%;" :row-class-name="kelasBarisAkhir">
                    <el-table-column label="Rek" width="88">
                      <template #default="{ row: d }">
                        <el-tooltip :content="d.kodeRekening" placement="right">
                          <span style="font-family: monospace; font-size: 11px; color: #606266;">{{ kodeSingkat(d.kodeRekening) }}</span>
                        </el-tooltip>
                      </template>
                    </el-table-column>
                    <el-table-column label="Nama Rekening" min-width="150" show-overflow-tooltip>
                      <template #default="{ row: d }">
                        {{ d.namaRekening }}
                        <el-tag v-if="d.tanpaRealisasi" type="info" size="small" effect="plain" style="margin-left: 6px;">
                          belum pernah dibayar
                        </el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column label="Pagu Sekarang" prop="pagu" min-width="115" align="right" sortable>
                      <template #default="{ row: d }">
                        <span style="font-variant-numeric: tabular-nums;">{{ formatRp(d.pagu) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="Realisasi" prop="sp2d" min-width="115" align="right" sortable>
                      <template #default="{ row: d }">
                        <div style="font-variant-numeric: tabular-nums;">{{ formatRp(d.sp2d) }}</div>
                        <div v-if="d.dibayar" style="font-size: 10px; color: #a8abb2;">{{ formatBulan(d.dibayar) }}&times; bayar</div>
                      </template>
                    </el-table-column>
                    <el-table-column :label="labelBasis" prop="perBulanRutin" min-width="115" align="right" sortable>
                      <template #default="{ row: d }">
                        <div style="font-variant-numeric: tabular-nums;">{{ formatRp(d.perBulanRutin) }}</div>
                        <div v-if="d.tren" style="font-size: 10px;" :style="{ color: d.tren > 1.01 ? '#e6a23c' : '#a8abb2' }">
                          tren {{ formatBulan(d.tren) }}&times;
                        </div>
                      </template>
                    </el-table-column>
                    <el-table-column label="Kebutuhan s.d. Des" prop="kebutuhan" min-width="130" align="right" sortable>
                      <template #default="{ row: d }">
                        <div style="font-variant-numeric: tabular-nums;">{{ formatRp(d.kebutuhan) }}</div>
                        <div style="font-size: 10px; color: #a8abb2;">realisasi + {{ labelBasis.toLowerCase() }}&times;{{ data.bulanSisa }}</div>
                      </template>
                    </el-table-column>
                    <el-table-column label="Acress" prop="cadanganAkhir" min-width="115" align="right" sortable>
                      <template #default="{ row: d }">
                        <div style="font-variant-numeric: tabular-nums; color: #e6a23c;">{{ formatRp(d.cadanganAkhir) }}</div>
                        <div style="font-size: 10px; color: #a8abb2;">{{ formatPersen(akhir.persenAkhir) }}</div>
                      </template>
                    </el-table-column>
                    <el-table-column label="Usulan" prop="alokasi" min-width="130" align="right" sortable>
                      <template #default="{ row: d }">
                        <div style="font-variant-numeric: tabular-nums; font-weight: 700;">{{ formatRp(d.alokasi) }}</div>
                        <div style="font-size: 10px; color: #a8abb2;">kebutuhan + acress</div>
                      </template>
                    </el-table-column>
                    <el-table-column label="Pergeseran" prop="pergeseran" min-width="130" align="right" sortable>
                      <template #default="{ row: d }">
                        <span :style="{ color: warnaPergeseran(d.pergeseran), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
                          {{ formatSelisih(d.pergeseran) }}
                        </span>
                      </template>
                    </el-table-column>
                    <el-table-column label="Sim Gaji /Bln" width="145" align="right">
                      <template #default="{ row: d }">
                        <el-input-number :model-value="d.sim" size="small" :controls="false" :min="0" :step="100000"
                          style="width: 130px;"
                          :formatter="formatIsian" :parser="uraiIsian"
                          @change="(v) => simpanSel(row, d, v)" />
                      </template>
                    </el-table-column>
                    <el-table-column label="Selisih /Bln" width="105" align="right">
                      <template #default="{ row: d }">
                        <span style="font-variant-numeric: tabular-nums;" :style="{ color: warnaDeviasi(d.deviasiSim) }">
                          {{ formatSelisih(d.selisihSim) }}
                        </span>
                      </template>
                    </el-table-column>
                    <el-table-column label="Deviasi" width="72" align="center">
                      <template #default="{ row: d }">
                        <strong :style="{ color: warnaDeviasi(d.deviasiSim) }">{{ formatDeviasi(d.deviasiSim) }}</strong>
                      </template>
                    </el-table-column>
                    <el-table-column label="Usulan (Sim)" prop="alokasiSim" min-width="130" align="right" sortable>
                      <template #default="{ row: d }">
                        <div style="font-variant-numeric: tabular-nums; font-weight: 700;">{{ formatRp(d.alokasiSim) }}</div>
                      </template>
                    </el-table-column>
                    <el-table-column label="Pergeseran (Sim)" prop="pergeseranSim" min-width="135" align="right" sortable>
                      <template #default="{ row: d }">
                        <span :style="{ color: warnaPergeseran(d.pergeseranSim), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
                          {{ formatSelisih(d.pergeseranSim) }}
                        </span>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </div>
            </template>
          </el-table-column>

          <el-table-column label="SKPD" min-width="180" sortable :sort-by="'namaSkpd'" show-overflow-tooltip>
            <template #default="{ row }">
              <div style="font-weight: 600; font-size: 13px; color: #303133;">
                {{ row.namaSkpd }}
                <el-tag v-if="row.terkunci" type="info" size="small" effect="plain" style="margin-left: 4px;">DIKUNCI</el-tag>
                <el-tooltip v-else-if="row.tren > 1.01" placement="right">
                  <template #content>
                    <div style="max-width: 320px; font-size: 12px;">
                      Tiga kali bayar terakhir rata-rata {{ formatBulan(row.tren) }}&times; dari rata-rata tahun berjalan —
                      gajinya sedang naik. Tertinggi sekali bayar {{ formatRp(row.tertinggi) }} vs rata²
                      {{ formatRp(row.rataRata) }}. Pertimbangkan basis "Tertinggi".
                    </div>
                  </template>
                  <el-icon style="color: #e6a23c; vertical-align: -2px;"><WarningFilled /></el-icon>
                </el-tooltip>
              </div>
              <div style="font-size: 11px; color: #c0c4cc; font-family: monospace;">{{ row.kodeSkpd }}</div>
            </template>
          </el-table-column>
          <el-table-column label="Pagu Sekarang" prop="pagu" min-width="130" align="right" sortable>
            <template #default="{ row }">
              <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.pagu) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Realisasi" prop="sp2d" min-width="130" align="right" sortable>
            <template #default="{ row }">
              <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.sp2d) }}</div>
              <div v-if="row.dibayar" style="font-size: 10px; color: #a8abb2;">{{ formatBulan(row.dibayar) }}&times; bayar</div>
            </template>
          </el-table-column>
          <el-table-column :label="labelBasis" prop="perBulanRutin" min-width="125" align="right" sortable>
            <template #default="{ row }">
              <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.perBulanRutin) }}</div>
              <div v-if="row.tren" style="font-size: 10px;" :style="{ color: row.tren > 1.01 ? '#e6a23c' : '#a8abb2' }">
                tren {{ formatBulan(row.tren) }}&times;
              </div>
            </template>
          </el-table-column>
          <el-table-column label="Kebutuhan s.d. Des" prop="kebutuhan" min-width="140" align="right" sortable>
            <template #default="{ row }">
              <div style="font-variant-numeric: tabular-nums;">{{ formatRp(row.kebutuhan) }}</div>
              <div style="font-size: 10px; color: #a8abb2;">realisasi + {{ labelBasis.toLowerCase() }}&times;{{ data.bulanSisa }}</div>
            </template>
          </el-table-column>
          <el-table-column label="Acress" prop="cadanganAkhir" min-width="125" align="right" sortable>
            <template #default="{ row }">
              <div style="font-variant-numeric: tabular-nums; color: #e6a23c;">{{ formatRp(row.cadanganAkhir) }}</div>
              <div style="font-size: 10px; color: #a8abb2;">{{ formatPersen(akhir.persenAkhir) }}</div>
            </template>
          </el-table-column>
          <el-table-column label="Usulan" prop="alokasi" min-width="140" align="right" sortable>
            <template #default="{ row }">
              <div style="font-variant-numeric: tabular-nums; font-weight: 700;">{{ formatRp(row.alokasi) }}</div>
              <div style="font-size: 10px; color: #a8abb2;">kebutuhan + acress</div>
            </template>
          </el-table-column>
          <el-table-column label="Pergeseran" prop="pergeseran" min-width="140" align="right" sortable>
            <template #default="{ row }">
              <span :style="{ color: warnaPergeseran(row.pergeseran), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
                {{ formatSelisih(row.pergeseran) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column v-if="adaSim" label="Usulan (Sim)" prop="alokasiSim" min-width="140" align="right" sortable>
            <template #default="{ row }">
              <div style="font-variant-numeric: tabular-nums; font-weight: 700;">{{ formatRp(row.alokasiSim) }}</div>
            </template>
          </el-table-column>
          <el-table-column v-if="adaSim" label="Pergeseran (Sim)" prop="pergeseranSim" min-width="140" align="right" sortable>
            <template #default="{ row }">
              <span :style="{ color: warnaPergeseran(row.pergeseranSim), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
                {{ formatSelisih(row.pergeseranSim) }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- Cek Inputan: usulan proyeksi vs pagu yang sudah benar-benar diinput -->
      <el-tab-pane name="inputan">
        <template #label>
          Cek Inputan
          <el-badge v-if="banding && jumlahSignifikan" :value="jumlahSignifikan"
            type="danger" class="lencana-sim" />
        </template>

        <el-card style="margin-bottom: 16px;">
          <p style="margin: 0 0 12px; font-size: 12px; color: #606266; line-height: 1.7;">
            Sesudah usulan di tab <strong>Proyeksi Akhir</strong> diinput ke SIPD, unggah kembali berkas
            <strong>rekap anggaran</strong> hasil inputnya di sini &mdash; tiap rekening tiap dinas diadu satu-satu
            dengan angka usulannya, jadi yang salah ketik atau belum sempat diinput langsung kelihatan.
            Berkasnya sama dengan yang dipakai menu <strong>Anggaran Rekap</strong> (rekap4/rekap5).
          </p>
          <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px;">
            <template #title>
              <span style="font-size: 12px;">
                File pembanding dibaca <strong>di browser saja</strong> dan tidak disimpan ke server.
              </span>
            </template>
            <div style="font-size: 12px; line-height: 1.7;">
              Ini disengaja: kolom Pagu di seluruh perhitungan proyeksi berasal dari tabel Anggaran Rekap, jadi kalau
              file ini ikut disimpan, pagunya berubah &rarr; usulannya ikut berubah &rarr; yang dibandingkan jadi
              dirinya sendiri. Untuk benar-benar memperbarui pagu di aplikasi, lewat menu Anggaran Rekap seperti biasa.
            </div>
          </el-alert>
          <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
            <div>
              <div style="font-size: 12px; color: #606266; margin-bottom: 6px;">Berkas hasil input</div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <el-upload :auto-upload="false" :show-file-list="false" accept=".xlsx,.xls"
                  :on-change="handleImportInputan">
                  <el-button type="primary" :icon="Upload" :loading="membacaInputan">
                    {{ inputan ? 'Ganti berkas' : 'Pilih berkas rekap anggaran' }}
                  </el-button>
                </el-upload>
                <el-button v-if="inputan" link type="danger" @click="lupakanInputan">Lupakan</el-button>
              </div>
              <div v-if="inputan" style="font-size: 11px; color: #909399; margin-top: 6px; max-width: 420px; line-height: 1.6;">
                <strong>{{ inputan.namaBerkas }}</strong> &bull; {{ inputan.jumlahRekening }} rekening
                dari {{ inputan.jumlahDinas }} dinas &bull; total pagu {{ formatRp(inputan.totalPagu) }}
                <template v-if="inputan.barisData > inputan.barisTerpakai">
                  <br />{{ (inputan.barisData - inputan.barisTerpakai).toLocaleString('id-ID') }} baris lain di berkas
                  itu di luar awalan {{ data.prefix }} &mdash; diabaikan.
                </template>
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #606266; margin-bottom: 6px;">Diadu dengan usulan versi</div>
              <el-radio-group v-model="bandingSisi" size="small">
                <el-radio-button value="rumus">Rumus</el-radio-button>
                <el-radio-button value="sim" :disabled="!adaSim">Sim Gaji</el-radio-button>
              </el-radio-group>
              <div style="font-size: 11px; color: #909399; margin-top: 6px; max-width: 320px; line-height: 1.6;">
                Pilih yang benar-benar kamu pakai waktu menginput. Acress yang terpakai sekarang
                <strong>{{ formatPersen(bandingSisi === 'sim' ? akhir.persenAkhirSim : akhir.persenAkhir) }}</strong> &mdash;
                kalau waktu input pakai acress lain, angkanya wajar beda.
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #606266; margin-bottom: 6px;">Toleransi</div>
              <el-input-number v-model="toleransiInputan" :min="0" :step="1000" :precision="0"
                size="small" controls-position="right" style="width: 140px;" />
              <div style="font-size: 11px; color: #909399; margin-top: 6px; max-width: 300px; line-height: 1.6;">
                rupiah &mdash; selisih di bawah ini dihitung <strong>SESUAI</strong>. Naikkan kalau waktu input
                angkanya dibulatkan ke ribuan.
              </div>
            </div>
            <div>
              <div style="font-size: 12px; color: #606266; margin-bottom: 6px;">Batas selisih total</div>
              <el-input-number v-model="toleransiTotal" :min="0" :step="100000" :precision="0"
                size="small" controls-position="right" style="width: 160px;" />
              <div style="font-size: 11px; color: #909399; margin-top: 6px; max-width: 320px; line-height: 1.6;">
                rupiah, per dinas per golongan &mdash; kalau <strong>jumlah</strong> inputannya masih dalam batas ini,
                rekening yang meleset dianggap <strong>saling tutup</strong>: tetap ditampilkan, tapi bukan masalah.
              </div>
            </div>
          </div>
        </el-card>

        <el-empty v-if="!inputan" description="Belum ada berkas pembanding. Unggah rekap anggaran hasil input di atas." />

        <template v-else>
          <!-- Ringkasan hasil adu -->
          <el-card style="margin-bottom: 16px;">
            <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px;">
              <div>
                <div style="font-size: 12px; color: #67c23a; font-weight: 600;">Sesuai</div>
                <div style="font-size: 20px; font-weight: 700;">{{ banding.total.sesuai }}</div>
                <div style="font-size: 11px; color: #909399;">dari {{ banding.total.jumlah }} rekening</div>
              </div>
              <div>
                <div style="font-size: 12px; color: #f56c6c; font-weight: 600;">Kurang diinput</div>
                <div style="font-size: 20px; font-weight: 700; color: #f56c6c;">{{ banding.total.kurang }}</div>
                <div style="font-size: 11px; color: #909399;">{{ formatRp(banding.total.selisihKurang) }}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: #e6a23c; font-weight: 600;">Lebih diinput</div>
                <div style="font-size: 20px; font-weight: 700; color: #e6a23c;">{{ banding.total.lebih }}</div>
                <div style="font-size: 11px; color: #909399;">+{{ formatRp(banding.total.selisihLebih) }}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: #909399; font-weight: 600;">Belum ada di berkas</div>
                <div style="font-size: 20px; font-weight: 700;">{{ banding.total.hilang }}</div>
                <div style="font-size: 11px; color: #909399;">rekening usulan tanpa pasangan</div>
              </div>
              <div>
                <div style="font-size: 12px; color: #909399; font-weight: 600;">Di luar usulan</div>
                <div style="font-size: 20px; font-weight: 700;">{{ banding.total.ekstra }}</div>
                <div style="font-size: 11px; color: #909399;">ada di berkas, tidak di proyeksi</div>
              </div>
            </div>
            <el-divider style="margin: 14px 0;" />
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
              <div>
                <div style="font-size: 12px; color: #606266; font-weight: 600;">Total Usulan</div>
                <div style="font-size: 18px; font-weight: 700;">{{ formatRp(banding.total.usulan) }}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: #409eff; font-weight: 600;">Total Diinput</div>
                <div style="font-size: 18px; font-weight: 700;">{{ formatRp(banding.total.inputan) }}</div>
              </div>
              <div>
                <div style="font-size: 12px; font-weight: 600;" :style="{ color: warnaPergeseran(banding.total.selisih) }">
                  Selisih
                </div>
                <div style="font-size: 18px; font-weight: 700;" :style="{ color: warnaPergeseran(banding.total.selisih) }">
                  {{ formatSelisih(banding.total.selisih) }}
                </div>
              </div>
            </div>
          </el-card>

          <el-alert v-if="banding.jumlahDibawahKebutuhan" type="error" :closable="false" show-icon
            style="margin-bottom: 16px;">
            <template #title>
              {{ banding.jumlahDibawahKebutuhan }} rekening diinput <strong>di bawah kebutuhan riilnya</strong>
              sampai Desember &mdash; bukan cuma kehilangan acress.
            </template>
            <template #default>
              <div style="font-size: 12px; line-height: 1.7;">
                Kekurangan di bawah garis kebutuhan berarti gajinya memang tidak akan cukup sampai tutup tahun,
                bukan sekadar meleset dari usulan &mdash; walau di matriks dinasnya terbaca saling tutup.
              </div>
              <table class="daftar-dibawah">
                <tr>
                  <th>Perangkat Daerah</th><th>Rekening</th>
                  <th>Kebutuhan s.d. Des</th><th>Diinput</th><th>Kurang</th>
                </tr>
                <tr v-for="r in barisDibawahKebutuhan" :key="r.kunci">
                  <td>{{ r.namaSkpd }}</td>
                  <td>{{ r.namaRekening }}</td>
                  <td>{{ formatRp(r.kebutuhan) }}</td>
                  <td>{{ formatRp(r.inputan) }}</td>
                  <td style="font-weight: 700;">{{ formatSelisih(r.inputan - r.kebutuhan) }}</td>
                </tr>
              </table>
            </template>
          </el-alert>

          <!-- Kesimpulan di tingkat total: ada selisih signifikan atau tidak -->
          <el-card style="margin-bottom: 16px;">
            <div style="font-size: 14px; font-weight: 700; color: #303133; margin-bottom: 4px;">
              Secara total, ada selisih signifikan?
            </div>
            <p style="margin: 0 0 12px; font-size: 12px; color: #909399; line-height: 1.6;">
              Dinilai per dinas per golongan. Rekening yang meleset tapi jumlah dinasnya tetap pas
              (dalam batas {{ formatRp(toleransiTotal) }}) = <strong>saling tutup</strong>, dibiarkan.
              Saling tutup hanya di dalam golongan yang sama &mdash; PNS tidak menutup PPPK.
            </p>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px;">
              <div v-for="m in matriks" :key="m.kunci" class="vonis-golongan"
                :class="m.dinasSignifikan ? 'vonis-merah' : m.dinasSalingTutup ? 'vonis-kuning' : 'vonis-hijau'">
                <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px;">
                  <span style="font-size: 15px; font-weight: 700;">{{ m.label }}</span>
                  <span style="font-size: 12px; font-weight: 700;">
                    {{ m.dinasSignifikan ? `${m.dinasSignifikan} dinas SIGNIFIKAN`
                      : m.dinasSalingTutup ? 'Tidak signifikan — hanya saling tutup' : 'Semua cocok' }}
                  </span>
                </div>
                <div class="vonis-angka">
                  <span>Hitungan</span><strong>{{ formatRp(m.jumlahHitungan) }}</strong>
                  <span>Inputan</span><strong>{{ formatRp(m.jumlahInputan) }}</strong>
                  <span>Selisih total</span>
                  <strong :style="{ color: warnaPergeseran(m.selisih) }">{{ formatSelisih(m.selisih) }}</strong>
                </div>
                <div style="font-size: 11px; color: #606266; margin-top: 6px; line-height: 1.6;">
                  {{ m.baris.length - m.dinasSalah }} dinas cocok &bull;
                  {{ m.dinasSalingTutup }} saling tutup ({{ m.selSalingTutup }} rekening) &bull;
                  {{ m.dinasSignifikan }} signifikan<template v-if="m.dinasSignifikan">
                    (bersih {{ formatSelisih(m.selisihSignifikan) }})</template>
                  <template v-if="!m.totalSignifikan && m.dinasSignifikan">
                    <br />Total golongan pas, tapi karena dinas yang lebih menutup dinas yang kurang &mdash;
                    tiap dinas tetap perlu dibetulkan.
                  </template>
                </div>
              </div>
            </div>
          </el-card>

          <!-- Matriks: perangkat daerah × komponen, per golongan -->
          <el-card style="margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px;">
              <span style="font-size: 14px; font-weight: 700; color: #303133;">Matriks Hitungan vs Inputan</span>
              <el-radio-group v-model="golMatriks" size="small">
                <el-radio-button v-for="m in matriks" :key="m.kunci" :value="m.kunci">
                  {{ m.label }}
                  <span v-if="m.jumlahSalah" style="color: #f56c6c; font-weight: 700;">&nbsp;{{ m.jumlahSalah }}</span>
                </el-radio-button>
              </el-radio-group>
              <el-radio-group v-model="tampilMatriks" size="small">
                <el-radio-button value="cocok">Perbandingan</el-radio-button>
                <el-radio-button value="hitungan">Hitungan</el-radio-button>
                <el-radio-button value="inputan">Inputan</el-radio-button>
                <el-radio-button value="selisih">Selisih</el-radio-button>
              </el-radio-group>
              <el-select v-model="saringMatriks" size="small" style="width: 190px;">
                <el-option value="semua" label="Semua dinas" />
                <el-option value="beda" label="Yang ada FALSE" />
                <el-option value="signifikan" label="Hanya yang signifikan" />
              </el-select>
              <el-button type="success" plain size="small" :icon="Download" :loading="exportingMatriks"
                style="margin-left: auto;" @click="exportMatriks">
                Ekspor Excel
              </el-button>
            </div>
            <p style="margin: 0 0 10px; font-size: 12px; color: #909399; line-height: 1.6;">
              Susunannya sama dengan lembar kerja manual: baris perangkat daerah, kolom komponen gaji.
              <strong>TRUE</strong> = selisih inputan dengan hitungan &le; toleransi. Arahkan kursor ke sel untuk melihat
              kedua angkanya. File Excel-nya memuat blok Hitungan, Inputan, Perbandingan (rumus TRUE/FALSE), dan Selisih.
            </p>
            <el-table v-if="matriksAktif" :data="barisMatriks" row-key="kodeSkpd" border size="small"
              class="tabel-rapat tabel-matriks" style="width: 100%;" max-height="640"
              show-summary :summary-method="ringkasMatriks"
              :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }">
              <el-table-column label="Perangkat Daerah" prop="namaSkpd" min-width="220" fixed show-overflow-tooltip>
                <template #default="{ row }">
                  <span style="font-size: 12px; color: #303133;">{{ row.namaSkpd }}</span>
                </template>
              </el-table-column>
              <el-table-column v-for="k in matriksAktif.kolom" :key="k.kode" :column-key="k.kode"
                :min-width="tampilMatriks === 'cocok' ? 96 : 130" align="center">
                <template #header>
                  <el-tooltip :content="`${k.nama} (${k.kodeAsli})`" placement="top">
                    <span>{{ k.label }}</span>
                  </el-tooltip>
                </template>
                <template #default="{ row }">
                  <template v-if="row.sel[k.kode]">
                    <span v-if="tampilMatriks === 'cocok'" :title="judulSelMatriks(row.sel[k.kode])"
                      :class="kelasSelMatriks(row, row.sel[k.kode])">
                      {{ row.sel[k.kode].cocok ? 'TRUE' : 'FALSE' }}
                    </span>
                    <span v-else :title="judulSelMatriks(row.sel[k.kode])"
                      style="display: block; text-align: right; font-variant-numeric: tabular-nums; font-size: 12px;"
                      :style="{
                        color: tampilMatriks === 'selisih' ? warnaPergeseran(nilaiSelMatriks(row.sel[k.kode]))
                          : !row.sel[k.kode].cocok ? '#f56c6c' : '#303133',
                        fontWeight: row.sel[k.kode].cocok ? 400 : 700,
                      }">
                      {{ tampilMatriks === 'selisih' ? formatSelisih(nilaiSelMatriks(row.sel[k.kode]))
                        : formatRp(nilaiSelMatriks(row.sel[k.kode])) }}
                    </span>
                  </template>
                  <span v-else style="color: #dcdfe6;">&mdash;</span>
                </template>
              </el-table-column>
              <el-table-column :label="tampilMatriks === 'cocok' ? 'Total dinas' : 'Jumlah'" column-key="__semua"
                :min-width="tampilMatriks === 'cocok' ? 120 : 150" align="center" fixed="right">
                <template #default="{ row }">
                  <span v-if="tampilMatriks === 'cocok'" :class="LABEL_STATUS_TOTAL[row.status].kelas"
                    :title="`${row.salah} rekening FALSE • selisih jumlah ${formatSelisih(row.selisih)}`">
                    {{ LABEL_STATUS_TOTAL[row.status].teks }}
                  </span>
                  <span v-else style="display: block; text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; font-size: 12px;"
                    :style="{ color: tampilMatriks === 'selisih' ? warnaPergeseran(row.selisih) : '#303133' }">
                    {{ tampilMatriks === 'hitungan' ? formatRp(row.jumlahHitungan)
                      : tampilMatriks === 'inputan' ? formatRp(row.jumlahInputan) : formatSelisih(row.selisih) }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <!-- Ringkasan per dinas -->
          <el-card style="margin-bottom: 16px;">
            <div style="font-size: 14px; font-weight: 700; color: #303133; margin-bottom: 4px;">Per Dinas</div>
            <p style="margin: 0 0 12px; font-size: 12px; color: #909399;">
              Diurut dari yang paling perlu ditengok &mdash; dinas yang seluruh rekeningnya sudah sesuai turun ke bawah.
            </p>
            <el-table :data="banding.dinas" row-key="kodeSkpd" border size="small" class="tabel-rapat"
              style="width: 100%;"
              :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }">
              <el-table-column label="SKPD" min-width="200" show-overflow-tooltip sortable :sort-by="'namaSkpd'">
                <template #default="{ row }">
                  <div style="font-weight: 600; font-size: 13px; color: #303133;">
                    {{ row.namaSkpd }}
                    <el-tag v-if="row.terkunci" type="info" size="small" effect="plain" style="margin-left: 4px;">DIKUNCI</el-tag>
                  </div>
                  <div style="font-size: 11px; color: #c0c4cc; font-family: monospace;">{{ row.kodeSkpd }}</div>
                </template>
              </el-table-column>
              <el-table-column label="Rek" prop="jumlah" width="55" align="center" />
              <el-table-column label="Sesuai" prop="sesuai" width="70" align="center" sortable>
                <template #default="{ row }">
                  <span :style="{ color: row.sesuai === row.jumlah ? '#67c23a' : '#909399', fontWeight: 700 }">
                    {{ row.sesuai }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="Kurang" prop="kurang" width="70" align="center" sortable>
                <template #default="{ row }">
                  <span :style="{ color: row.kurang ? '#f56c6c' : '#c0c4cc', fontWeight: 700 }">{{ row.kurang }}</span>
                </template>
              </el-table-column>
              <el-table-column label="Lebih" prop="lebih" width="70" align="center" sortable>
                <template #default="{ row }">
                  <span :style="{ color: row.lebih ? '#e6a23c' : '#c0c4cc', fontWeight: 700 }">{{ row.lebih }}</span>
                </template>
              </el-table-column>
              <el-table-column label="Belum ada" prop="hilang" width="85" align="center" sortable>
                <template #default="{ row }">
                  <span :style="{ color: row.hilang ? '#909399' : '#c0c4cc', fontWeight: 700 }">{{ row.hilang }}</span>
                </template>
              </el-table-column>
              <el-table-column label="Usulan" prop="usulan" min-width="140" align="right" sortable>
                <template #default="{ row }">
                  <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.usulan) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="Diinput" prop="inputan" min-width="140" align="right" sortable>
                <template #default="{ row }">
                  <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.inputan) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="Selisih" prop="selisih" min-width="140" align="right" sortable>
                <template #default="{ row }">
                  <span :style="{ color: warnaPergeseran(row.selisih), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
                    {{ formatSelisih(row.selisih) }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </el-card>

        </template>
      </el-tab-pane>

    </el-tabs>
  </div>
</template>

<style scoped>
/* Rekening yang anggarannya tidak cukup sampai akhir tahun. */
:deep(.el-table .baris-kurang) {
  --el-table-tr-bg-color: #fef0f0;
}
:deep(.el-table .baris-kurang:hover > td) {
  background-color: #fde2e2 !important;
}
:deep(.el-table .baris-kurang td) {
  border-color: #fbc4c4;
}

/* Tab Proyeksi Akhir: dinas yang pagunya perlu ditambah, dan dinas yang dikunci. */
:deep(.el-table .baris-tambah) {
  --el-table-tr-bg-color: #fdf6ec;
}
:deep(.el-table .baris-tambah:hover > td) {
  background-color: #faecd8 !important;
}
:deep(.el-table .baris-kunci) {
  --el-table-tr-bg-color: #f7f8fa;
  color: #909399;
}
.tab-proyeksi :deep(.el-tabs__item) {
  font-weight: 600;
}

/* Matriks Cek Inputan: hasil adu TRUE/FALSE, warnanya meniru format bersyarat Excel. */
.sel-true,
.sel-false {
  display: inline-block;
  min-width: 52px;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  cursor: default;
}
.sel-tutup {
  display: inline-block;
  min-width: 52px;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  cursor: default;
  color: #b54708;
  background: #fdf3e3;
}
.sel-true {
  color: #067647;
  background: #eaf7ec;
}
.sel-false {
  color: #b42318;
  background: #fde7e9;
}

/* Daftar rekening di bawah kebutuhan, di dalam peringatan Cek Inputan. */
.daftar-dibawah {
  margin-top: 8px;
  border-collapse: collapse;
  font-size: 12px;
}
.daftar-dibawah th,
.daftar-dibawah td {
  padding: 2px 10px 2px 0;
  text-align: left;
  vertical-align: top;
}
.daftar-dibawah th:nth-child(n + 3),
.daftar-dibawah td:nth-child(n + 3) {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* Kesimpulan total per golongan di tab Cek Inputan. */
.vonis-golongan {
  padding: 10px 12px;
  border-radius: 4px;
  border-left: 4px solid;
}
.vonis-hijau { background: #eaf7ec; border-color: #67c23a; color: #067647; }
.vonis-kuning { background: #fdf3e3; border-color: #e6a23c; color: #b54708; }
.vonis-merah { background: #fde7e9; border-color: #f56c6c; color: #b42318; }
.vonis-angka {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 12px;
  font-size: 12px;
  color: #606266;
}
.vonis-angka strong {
  text-align: right;
  color: #303133;
  font-variant-numeric: tabular-nums;
}

/* Lencana jumlah dinas yang sudah terisi Sim Gaji, di label tab. */
.lencana-sim {
  margin-left: 6px;
  vertical-align: middle;
}

/* Padding sel bawaan Element Plus boros untuk tabel berkolom banyak. Dirapatkan
   supaya kolom rupiah muat tanpa memaksa tabel jadi lebih lebar dari layar. */
:deep(.tabel-rapat .cell) {
  padding-left: 6px;
  padding-right: 6px;
}
:deep(.tabel-rapat .el-table__expand-icon) {
  margin-right: 0;
}

/* Angka dasar hitungan di panel rincian — ditaruh di sini, bukan jadi kolom
   tambahan, supaya tabelnya tetap muat satu layar. */
.dasar-hitung {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px 14px;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
}
.dasar-hitung > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-left: 8px;
  border-left: 2px solid #e4e7ed;
}
.dasar-hitung > div.sorot {
  border-left-color: #e6a23c;
}
.dasar-hitung .label {
  font-size: 11px;
  color: #909399;
  font-weight: 600;
}
.dasar-hitung .nilai {
  font-size: 14px;
  font-weight: 700;
  color: #303133;
  font-variant-numeric: tabular-nums;
}
.dasar-hitung .ket {
  font-size: 11px;
  color: #a8abb2;
}
.dasar-hitung > div.sorot .ket {
  color: #b88230;
}
</style>
