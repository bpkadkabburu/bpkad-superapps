<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Download, Refresh, Upload, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../utils/api.js'
import { buatWorkbookProyeksiGaji, namaFileProyeksiGaji } from '../utils/proyeksiGajiExcel.js'
import { bacaSimGajiDariWorkbook, BerkasTidakDikenal } from '../utils/proyeksiGajiImport.js'

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
}

const KOSONG = {
  skpd: [], rekening: [], bulanList: [], bulanSisa: 0, bulanGajiTerbayarTotal: 0,
  totals: { pagu: 0, spp: 0, sp2d: 0, proyeksi: 0, sisa: 0, selisih: 0 },
  akhir: KOSONG_AKHIR,
}

const loading = ref(false)
const exporting = ref(false)
const prefix = ref('5.1.01.01')
const data = ref(KOSONG)
const tampilkanRekeningKurang = ref(true)
const tampilkanRekeningAkhir = ref(true)
const tab = ref('kebutuhan')
// Cadangan di atas kebutuhan riil. Dikirim ke API supaya angka di layar dan di
// file Excel berasal dari satu perhitungan yang sama.
const persenCadangan = ref(2.5)
// Dasar proyeksi tiap rekening: 'rata' = rata-rata tiap kali bayar, 'tertinggi' =
// nilai sekali bayar yang paling besar (jaga-jaga kalau gaji naik di sisa tahun).
const basis = ref('rata')

async function load() {
  loading.value = true
  try {
    const res = await api.get('/proyeksi-gaji', {
      params: {
        tahun: tahun.value, prefix: prefix.value,
        persen: persenCadangan.value, basis: basis.value,
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
    tab.value = 'banding'
  } catch (e) {
    if (e instanceof BerkasTidakDikenal) ElMessage.error(e.message)
    else ElMessage.error(e?.response?.data?.error || 'Gagal membaca file: ' + (e?.message || e))
  } finally {
    mengimpor.value = false
  }
  return false
}

// ---- Tab pembanding ----
const simInfo = computed(() => data.value.simInfo || { bulan: null, dinas: 0, totalDinas: 0, jumlah: 0 })
const adaSim = computed(() => simInfo.value.jumlah > 0)
// Isian dari bulan yang lebih tua dari realisasi terakhir berarti sudah
// tertinggal — angkanya masih boleh dipakai, tapi pemakai harus tahu.
const simTertinggal = computed(() =>
  adaSim.value && simInfo.value.bulan && data.value.bulanTerakhir &&
  simInfo.value.bulan < data.value.bulanTerakhir)

const AMBANG_SEPELE = 0.02
const sembunyikanSepele = ref(true)

// Angka dinas dan angka total di tab ini disusun ulang di sini, bukan dipakai
// apa adanya dari server. Sel yang baru saja diedit belum ikut terhitung di
// server, dan kalau angka di atasnya tidak ikut bergerak, tabelnya jadi tampak
// bertentangan dengan dirinya sendiri. Aturannya sama persis dengan ringkasSim()
// di API: yang dijumlahkan hanya rekening yang sudah diisi, di KEDUA sisi
// sekaligus — kalau sisi rumus ikut menghitung rekening yang belum diisi,
// deviasinya terbaca seolah rumusnya meleset padahal isiannya yang belum lengkap.
function ringkasBanding(rekening) {
  const terisi = (rekening || []).filter(r => r.sim != null)
  if (!terisi.length) {
    return {
      sim: null, rataRataBanding: null, selisihSim: null, deviasiSim: null,
      proyeksiSim: null, proyeksiBanding: null, rekeningSim: 0,
    }
  }
  const sim = terisi.reduce((a, r) => a + r.sim, 0)
  const banding = terisi.reduce((a, r) => a + r.rataRata, 0)
  const sisa = data.value.bulanSisa || 0
  return {
    sim,
    rataRataBanding: banding,
    selisihSim: sim - banding,
    deviasiSim: banding > 0 ? sim / banding - 1 : null,
    proyeksiSim: sim * sisa,
    proyeksiBanding: banding * sisa,
    rekeningSim: terisi.length,
  }
}

// `rekening` sengaja tidak ikut disalin isinya — array-nya tetap menunjuk objek
// yang sama, jadi mengubah satu sel langsung terlihat sampai ke baris dinas.
const dinasBanding = computed(() =>
  rows.value
    .map(s => ({ ...s, ...ringkasBanding(s.rekening) }))
    .filter(s => s.sim != null))

const totalBanding = computed(() =>
  ringkasBanding(dinasBanding.value.flatMap(s => s.rekening || [])))

const barisBanding = computed(() => {
  if (!sembunyikanSepele.value) return dinasBanding.value
  return dinasBanding.value.filter(s => Math.abs(s.deviasiSim ?? 0) >= AMBANG_SEPELE)
})

function rekeningBanding(row) {
  const daftar = (row.rekening || []).filter(r => r.sim != null)
  if (!sembunyikanSepele.value) return daftar
  return daftar.filter(r => Math.abs(r.deviasiSim ?? 0) >= AMBANG_SEPELE)
}

// Isian Sim Gaji nilainya jutaan — tanpa pemisah ribuan, salah ketik satu digit
// tidak akan kelihatan. Ditulis balik bertitik saat sel tidak sedang diketik.
function formatIsian(val) {
  if (val == null || val === '') return ''
  return Number(val).toLocaleString('id-ID', { maximumFractionDigits: 0 })
}
function uraiIsian(teks) {
  return String(teks ?? '').replace(/[^\d]/g, '')
}

// Kebutuhan sampai akhir tahun: versi rumus vs versi Sim Gaji. Inilah angka yang
// benar-benar dipakai menyusun anggaran, jadi selisihnya ditampilkan tersendiri
// dan tidak dibiarkan harus dikurangkan sendiri oleh pembacanya.
function selisihKebutuhan(row) {
  if (row.proyeksiSim == null || row.proyeksiBanding == null) return null
  return row.proyeksiSim - row.proyeksiBanding
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
function kelasBarisBanding({ row }) {
  const n = Math.abs(Number(row.deviasiSim) || 0)
  if (n > 0.05) return 'baris-kurang'
  return ''
}

// Menyimpan satu sel: nilai diperbarui di tempat, bukan lewat load() penuh,
// supaya tabel tidak melompat dan fokus ketikan tidak hilang.
async function simpanSel(skpd, rek, nilai) {
  const sebelum = rek.sim
  try {
    await api.put('/sim-gaji/baris', {
      tahun: tahun.value,
      bulan: simInfo.value.bulan || data.value.bulanTerakhir,
      kodeSkpd: skpd.kodeSkpd, namaSkpd: skpd.namaSkpd,
      kodeRekening: rek.kodeRekening, namaRekening: rek.namaRekening,
      komponen: '', nilai,
    })
    rek.sim = nilai || null
    rek.selisihSim = rek.sim == null ? null : rek.sim - rek.rataRata
    rek.deviasiSim = rek.sim == null || !rek.rataRata ? null : rek.sim / rek.rataRata - 1
    rek.proyeksiSim = rek.sim == null ? null : rek.sim * (data.value.bulanSisa || 0)
  } catch (e) {
    rek.sim = sebelum
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

async function exportExcel() {
  if (!rows.value.length) {
    ElMessage.warning('Tidak ada data untuk diekspor')
    return
  }
  exporting.value = true
  try {
    const buf = await buatWorkbookProyeksiGaji(data.value, { tahun: tahun.value })
    const url = URL.createObjectURL(new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }))
    const a = document.createElement('a')
    a.href = url
    a.download = namaFileProyeksiGaji(tahun.value, data.value.prefix, data.value.bulanTerakhir)
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`File diekspor — ${rows.value.length} sheet dinas`)
  } catch (e) {
    ElMessage.error('Gagal membuat file: ' + (e?.message || e))
  } finally {
    exporting.value = false
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
        tab <strong>Proyeksi Akhir</strong> membagi ulang pagu sekabupaten jadi usulan alokasi sampai tutup tahun &bull;
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
        </div>
      </div>
      <div style="margin-top: 10px; font-size: 12px; color: #909399;">
        File Excel berisi 1 sheet per dinas (rekening urut kode) + sheet REKAP, PER BULAN, REKAP REKENING,
        <strong>PROYEKSI AKHIR</strong> (usulan alokasi per dinas), dan <strong>AKHIR REKENING</strong> (rinciannya
        per rekening, siap jadi lampiran usulan pergeseran).
        Kolom <strong>Sim Gaji /Bln</strong> dibiarkan kosong untuk diisi manual — begitu diisi, kolom Kebutuhan,
        Selisih, dan Status ikut terhitung ulang di Excel.
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
        </template>

        <el-card style="margin-bottom: 16px;">
          <p style="margin: 0 0 12px; font-size: 12px; color: #606266; line-height: 1.7;">
            Anggaran gaji sekabupaten diperlakukan sebagai <strong>satu kantong</strong>. Tiap rekening tiap dinas
            dijatah kebutuhan riilnya sampai Desember, lalu ditambah acress. Kalau jumlahnya melebihi isi kantong,
            kekurangannya <strong>disebar ke semua dinas</strong> dengan memangkas acress secara proporsional — bukan
            dengan memotong kebutuhan gajinya, jadi tidak ada dinas yang kehabisan gaji sebelum tutup tahun.
            Urutan kolomnya: <strong>Pagu &middot; Realisasi &middot; {{ labelBasis }} &middot; Kebutuhan &middot;
            Acress &middot; Usulan &middot; Pergeseran</strong>.
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
            seluruh rekening PNS berkumpul sendiri dan PPPK sendiri.
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
                <span style="font-size: 12px; color: #606266; margin-left: auto;">
                  Kebutuhan {{ formatRp(g.kebutuhan) }} + acress {{ formatRp(g.cadanganAkhir) }} =
                  <strong>{{ formatRp(g.alokasi) }}</strong>
                  (<span :style="{ color: warnaPergeseran(g.pergeseran) }">{{ formatSelisih(g.pergeseran) }}</span>)
                </span>
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
                </div>

                <div v-for="g in row.golongan" :key="g.kunci" style="margin-bottom: 12px;">
                  <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                    <el-tag :type="g.label === 'PNS' ? 'primary' : 'success'" size="small" effect="dark">{{ g.label }}</el-tag>
                    <span style="font-size: 11px; color: #909399;">{{ g.jumlahRekening }} rekening</span>
                    <span style="font-size: 11px; color: #606266; margin-left: auto;">
                      Kebutuhan {{ formatRp(g.kebutuhan) }} + acress {{ formatRp(g.cadanganAkhir) }} =
                      <strong>{{ formatRp(g.alokasi) }}</strong>
                      (<span :style="{ color: warnaPergeseran(g.pergeseran) }">{{ formatSelisih(g.pergeseran) }}</span>)
                    </span>
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
        </el-table>
      </el-tab-pane>

      <el-tab-pane name="banding">
        <template #label>
          Banding Sim Gaji
          <el-badge v-if="adaSim" :value="dinasBanding.length" type="primary" class="lencana-sim" />
        </template>

        <el-alert v-if="!adaSim" type="info" :closable="false" show-icon
          title="Belum ada isian Sim Gaji"
          style="margin-bottom: 16px;">
          <div style="font-size: 12px; line-height: 1.7;">
            Export Excel dulu, isi kolom kuning <strong>Sim Gaji /Bln</strong> di sheet tiap dinas dari aplikasi
            SIM Gaji, lalu unggah kembali filenya lewat tombol <strong>Import Sim Gaji</strong> di atas.
            Bulannya ikut file &mdash; tidak perlu dipilih.
            Angka proyeksi di tab lain tidak berubah karena isian ini; gunanya murni untuk membandingkan.
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

          <el-card v-loading="loading" style="margin-bottom: 16px;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(155px, 1fr)); gap: 16px;">
              <div>
                <div style="font-size: 12px; color: #909399; font-weight: 600;">Rata&sup2;/Bln (Rumus)</div>
                <div style="font-size: 19px; font-weight: 700;">{{ formatMio(totalBanding.rataRataBanding) }}</div>
                <div style="font-size: 11px; color: #909399;">dari realisasi SP2D</div>
              </div>
              <div>
                <div style="font-size: 12px; color: #409eff; font-weight: 600;">Sim Gaji /Bln</div>
                <div style="font-size: 19px; font-weight: 700;">{{ formatMio(totalBanding.sim) }}</div>
                <div style="font-size: 11px; color: #909399;">
                  {{ NAMA_BULAN[simInfo.bulan] }} &bull; {{ dinasBanding.length }}/{{ simInfo.totalDinas }} dinas
                </div>
              </div>
              <div>
                <div style="font-size: 12px; font-weight: 600;" :style="{ color: warnaDeviasi(totalBanding.deviasiSim) }">
                  Selisih /Bln
                </div>
                <div style="font-size: 19px; font-weight: 700;" :style="{ color: warnaDeviasi(totalBanding.deviasiSim) }">
                  {{ formatSelisih(totalBanding.selisihSim) }}
                </div>
                <div style="font-size: 11px; font-weight: 600;" :style="{ color: warnaDeviasi(totalBanding.deviasiSim) }">
                  {{ formatDeviasi(totalBanding.deviasiSim) }}
                </div>
              </div>
              <div>
                <div style="font-size: 12px; color: #909399; font-weight: 600;">
                  Kebutuhan {{ data.bulanSisa }} Bln (Rumus)
                </div>
                <div style="font-size: 19px; font-weight: 700;">{{ formatMio(totalBanding.proyeksiBanding) }}</div>
                <div style="font-size: 11px; color: #909399;">{{ rentangSisa }}</div>
              </div>
              <div>
                <div style="font-size: 12px; color: #409eff; font-weight: 600;">
                  Kebutuhan {{ data.bulanSisa }} Bln (Sim Gaji)
                </div>
                <div style="font-size: 19px; font-weight: 700;">{{ formatMio(totalBanding.proyeksiSim) }}</div>
                <div style="font-size: 11px; color: #909399;">{{ rentangSisa }}</div>
              </div>
              <div>
                <div style="font-size: 12px; font-weight: 600;" :style="{ color: warnaDeviasi(totalBanding.deviasiSim) }">
                  Selisih Kebutuhan
                </div>
                <div style="font-size: 19px; font-weight: 700;" :style="{ color: warnaDeviasi(totalBanding.deviasiSim) }">
                  {{ formatSelisih(selisihKebutuhan(totalBanding)) }}
                </div>
                <div style="font-size: 11px; color: #909399;">
                  {{ totalBanding.rekeningSim }} rekening dibanding
                </div>
              </div>
            </div>

            <div style="margin-top: 12px; font-size: 12px; color: #909399; line-height: 1.7;">
              Yang dibandingkan hanya rekening yang kolom Sim Gaji-nya sudah diisi &mdash; di kedua sisi sekaligus,
              supaya rekening yang belum diisi tidak terbaca seolah rumusnya meleset.
              Deviasi <strong>positif</strong> berarti rumusnya <strong>kerendahan</strong>: kebutuhan sebenarnya
              lebih besar dari yang diproyeksikan.
            </div>
          </el-card>

          <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 12px;">
            <el-switch v-model="sembunyikanSepele" />
            <span style="font-size: 12px; color: #606266;">Sembunyikan yang selisihnya di bawah 2%</span>
            <el-button link type="danger" size="small" style="margin-left: auto;" @click="hapusSimGaji">
              Hapus isian Sim Gaji
            </el-button>
          </div>

          <el-alert v-if="!barisBanding.length" type="success" :closable="false" show-icon
            title="Tidak ada dinas yang selisihnya di atas 2%"
            style="margin-bottom: 16px;">
            <div style="font-size: 12px;">
              Untuk isian yang ada sekarang, proyeksi berbasis realisasi sudah sejalan dengan angka SIM Gaji.
              Matikan saklar di atas untuk melihat seluruh dinas.
            </div>
          </el-alert>

          <el-table v-else v-loading="loading" :data="barisBanding" size="small" stripe
            row-key="kodeSkpd" :row-class-name="kelasBarisBanding" class="tabel-rapat"
            style="width: 100%;" max-height="620">
            <el-table-column type="expand">
              <template #default="{ row }">
                <div style="padding: 8px 16px 16px 48px; background: #fafcff;">
                  <el-table :data="rekeningBanding(row)" size="small" style="width: 100%;"
                    class="tabel-rapat" :row-class-name="kelasBarisBanding">
                    <el-table-column label="Kode Rek" width="140">
                      <template #default="{ row: r }">
                        <span style="font-family: monospace; font-size: 11px;" :title="r.kodeRekening">
                          {{ kodeSingkat(r.kodeRekening) }}
                        </span>
                      </template>
                    </el-table-column>
                    <el-table-column prop="namaRekening" label="Nama Rekening" min-width="220" show-overflow-tooltip />
                    <el-table-column label="Rata&sup2;/Bln (Rumus)" width="150" align="right">
                      <template #default="{ row: r }">
                        <span style="font-variant-numeric: tabular-nums;">{{ formatRp(r.rataRata) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="Sim Gaji /Bln" width="180" align="right">
                      <template #default="{ row: r }">
                        <el-input-number :model-value="r.sim" size="small" :controls="false" :min="0" :step="100000"
                          style="width: 160px;"
                          :formatter="formatIsian" :parser="uraiIsian"
                          @change="(v) => simpanSel(row, r, v)" />
                      </template>
                    </el-table-column>
                    <el-table-column label="Selisih /Bln" width="135" align="right">
                      <template #default="{ row: r }">
                        <span style="font-variant-numeric: tabular-nums;" :style="{ color: warnaDeviasi(r.deviasiSim) }">
                          {{ formatSelisih(r.selisihSim) }}
                        </span>
                      </template>
                    </el-table-column>
                    <el-table-column label="Deviasi" width="90" align="center">
                      <template #default="{ row: r }">
                        <strong :style="{ color: warnaDeviasi(r.deviasiSim) }">{{ formatDeviasi(r.deviasiSim) }}</strong>
                      </template>
                    </el-table-column>
                    <el-table-column :label="`Kebutuhan ${data.bulanSisa} Bln (Rumus)`" width="145" align="right">
                      <template #default="{ row: r }">
                        <span style="font-variant-numeric: tabular-nums;">{{ formatRp(r.proyeksiBanding) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column :label="`Kebutuhan ${data.bulanSisa} Bln (Sim Gaji)`" width="145" align="right">
                      <template #default="{ row: r }">
                        <span style="font-variant-numeric: tabular-nums; font-weight: 600;">{{ formatRp(r.proyeksiSim) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="Selisih Kebutuhan" width="150" align="right">
                      <template #default="{ row: r }">
                        <span style="font-variant-numeric: tabular-nums;" :style="{ color: warnaDeviasi(r.deviasiSim) }">
                          {{ formatSelisih(selisihKebutuhan(r)) }}
                        </span>
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </template>
            </el-table-column>

            <el-table-column label="Nama SKPD" prop="namaSkpd" min-width="260" show-overflow-tooltip sortable />
            <el-table-column label="Rek Terisi" prop="rekeningSim" width="100" align="center" sortable />
            <el-table-column label="Rata&sup2;/Bln (Rumus)" prop="rataRataBanding" min-width="150" align="right" sortable>
              <template #default="{ row }">
                <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.rataRataBanding) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Sim Gaji /Bln" prop="sim" min-width="150" align="right" sortable>
              <template #default="{ row }">
                <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.sim) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Selisih /Bln" prop="selisihSim" min-width="135" align="right" sortable>
              <template #default="{ row }">
                <span style="font-variant-numeric: tabular-nums;" :style="{ color: warnaDeviasi(row.deviasiSim) }">
                  {{ formatSelisih(row.selisihSim) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="Deviasi" prop="deviasiSim" width="95" align="center" sortable>
              <template #default="{ row }">
                <strong :style="{ color: warnaDeviasi(row.deviasiSim) }">{{ formatDeviasi(row.deviasiSim) }}</strong>
              </template>
            </el-table-column>
            <el-table-column :label="`Kebutuhan ${data.bulanSisa} Bln (Rumus)`" prop="proyeksiBanding"
              min-width="145" align="right" sortable>
              <template #default="{ row }">
                <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.proyeksiBanding) }}</span>
              </template>
            </el-table-column>
            <el-table-column :label="`Kebutuhan ${data.bulanSisa} Bln (Sim Gaji)`" prop="proyeksiSim"
              min-width="145" align="right" sortable>
              <template #default="{ row }">
                <span style="font-variant-numeric: tabular-nums; font-weight: 600;">{{ formatRp(row.proyeksiSim) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Selisih Kebutuhan" min-width="155" align="right">
              <template #default="{ row }">
                <span style="font-variant-numeric: tabular-nums;" :style="{ color: warnaDeviasi(row.deviasiSim) }">
                  {{ formatSelisih(selisihKebutuhan(row)) }}
                </span>
              </template>
            </el-table-column>
          </el-table>
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
