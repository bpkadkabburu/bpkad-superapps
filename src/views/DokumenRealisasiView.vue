<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import ExcelJS from 'exceljs'
import { Upload, Delete, Search, Refresh, Grid } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../utils/api.js'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const BULAN_OPTIONS = [
  { value: 1, label: 'Januari' }, { value: 2, label: 'Februari' },
  { value: 3, label: 'Maret' }, { value: 4, label: 'April' },
  { value: 5, label: 'Mei' }, { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' }, { value: 8, label: 'Agustus' },
  { value: 9, label: 'September' }, { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' }, { value: 12, label: 'Desember' },
]
const BULAN_SINGKAT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

// Filter aktif — dipakai bersama oleh matriks kelengkapan dan daftar dokumen.
const filter = ref({ kodeSkpd: '', bulan: null, kodeRekening: '', jenisDokumen: '', sp2d: '', q: '' })

const rows = ref([])
const total = ref(0)
const ringkasan = ref(null)
const currentPage = ref(1)
const pageSize = ref(50)
const loadingTabel = ref(false)

const opsi = ref({ skpd: [], rekening: [], jenisDokumen: [], bulan: [] })
const kelengkapan = ref({ skpd: [], perBulan: [], bulanAda: [] })
const loadingMatriks = ref(false)
const tampilkanMatriks = ref(true)
const hanyaBelumLengkap = ref(false)

const bulanImport = ref(null)

function paramsFilter() {
  const p = { tahun: tahun.value }
  if (filter.value.kodeSkpd) p.kodeSkpd = filter.value.kodeSkpd
  if (filter.value.bulan) p.bulan = filter.value.bulan
  if (filter.value.kodeRekening) p.kodeRekening = filter.value.kodeRekening
  if (filter.value.jenisDokumen) p.jenisDokumen = filter.value.jenisDokumen
  if (filter.value.sp2d) p.sp2d = filter.value.sp2d
  if (filter.value.q.trim()) p.q = filter.value.q.trim()
  return p
}

async function loadTabel() {
  loadingTabel.value = true
  try {
    const { data } = await api.get('/sumber-data/dokumen-realisasi', {
      params: { ...paramsFilter(), page: currentPage.value, pageSize: pageSize.value },
    })
    rows.value = data.data || []
    total.value = data.total || 0
    ringkasan.value = data.ringkasan
  } catch {
    rows.value = []
    total.value = 0
    ringkasan.value = null
  } finally {
    loadingTabel.value = false
  }
}

// Matriks tidak ikut memakai filter bulan/pencarian bebas — kolomnya justru bulan.
async function loadMatriks() {
  loadingMatriks.value = true
  try {
    const p = { tahun: tahun.value }
    if (filter.value.kodeSkpd) p.kodeSkpd = filter.value.kodeSkpd
    if (filter.value.kodeRekening) p.kodeRekening = filter.value.kodeRekening
    if (filter.value.jenisDokumen) p.jenisDokumen = filter.value.jenisDokumen
    if (filter.value.sp2d) p.sp2d = filter.value.sp2d
    const { data } = await api.get('/sumber-data/dokumen-realisasi/kelengkapan', { params: p })
    kelengkapan.value = data
  } catch {
    kelengkapan.value = { skpd: [], perBulan: [], bulanAda: [] }
  } finally {
    loadingMatriks.value = false
  }
}

async function loadOpsi() {
  try {
    const { data } = await api.get('/sumber-data/dokumen-realisasi/opsi', { params: { tahun: tahun.value } })
    opsi.value = data
  } catch { /* biarkan kosong */ }
}

async function loadSemua() {
  await Promise.all([loadOpsi(), loadMatriks(), loadTabel()])
}
onMounted(loadSemua)

// Perubahan filter: halaman kembali ke 1, matriks hanya dimuat ulang kalau filter
// yang memengaruhinya berubah (bulan & pencarian bebas tidak).
let timerCari = null
watch(() => [filter.value.kodeSkpd, filter.value.kodeRekening, filter.value.jenisDokumen, filter.value.sp2d],
  () => { currentPage.value = 1; loadMatriks(); loadTabel() })
watch(() => filter.value.bulan, () => { currentPage.value = 1; loadTabel() })
watch(() => filter.value.q, () => {
  clearTimeout(timerCari)
  timerCari = setTimeout(() => { currentPage.value = 1; loadTabel() }, 350)
})
watch([currentPage, pageSize], loadTabel)

const adaFilter = computed(() => {
  const f = filter.value
  return !!(f.kodeSkpd || f.bulan || f.kodeRekening || f.jenisDokumen || f.sp2d || f.q.trim())
})
function resetFilter() {
  filter.value = { kodeSkpd: '', bulan: null, kodeRekening: '', jenisDokumen: '', sp2d: '', q: '' }
}

// Bulan yang diperiksa = bulan yang sudah ada datanya di minimal satu SKPD.
// Bulan yang memang belum diimport sama sekali tidak dihitung sebagai kekurangan.
const bulanDiperiksa = computed(() => kelengkapan.value.bulanAda || [])

function selMatriks(row, bulan) {
  return row.perBulan?.[bulan] || null
}
function barisLengkap(row) {
  if (!bulanDiperiksa.value.length) return true
  return bulanDiperiksa.value.every(b => !!row.perBulan?.[b])
}
function bulanKosong(row) {
  return bulanDiperiksa.value.filter(b => !row.perBulan?.[b])
}

const barisMatriks = computed(() => {
  const semua = kelengkapan.value.skpd || []
  return hanyaBelumLengkap.value ? semua.filter(r => !barisLengkap(r)) : semua
})
const jumlahBelumLengkap = computed(() =>
  (kelengkapan.value.skpd || []).filter(r => !barisLengkap(r)).length)

function klikSel(row, bulan) {
  // Bulan yang belum diimport sama sekali tidak bisa diklik — tidak ada yang
  // bisa ditampilkan, dan filternya cuma bikin tabel di bawah jadi kosong.
  if (!bulanDiperiksa.value.includes(bulan)) return
  filter.value.kodeSkpd = row.kodeSkpd
  filter.value.bulan = bulan
}

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
}
function formatMio(val) {
  const n = Number(val || 0)
  if (Math.abs(n) >= 1e9) return (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' M'
  if (Math.abs(n) >= 1e6) return (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 }) + ' jt'
  return Number(n).toLocaleString('id-ID')
}
function labelRekening(o) {
  return `${o.kode} — ${o.nama || ''}`
}

// ---------- Import Excel ----------
function getCellText(val) {
  if (val == null) return null
  if (typeof val === 'object' && val.richText) return val.richText.map(r => r.text).join('')
  if (typeof val === 'object' && val.text) return val.text
  return String(val)
}

async function handleFileImport(uploadFile) {
  if (!uploadFile.raw) return false

  if (!bulanImport.value) {
    ElMessage.warning('Pilih bulan terlebih dahulu sebelum import')
    return false
  }

  const buffer = await uploadFile.raw.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) {
    ElMessage.error('Sheet tidak ditemukan dalam file Excel')
    return false
  }

  // Header ada di row 5, skip rows 1-4 (metadata)
  const colMap = {}
  ws.getRow(5).eachCell((cell, colNum) => {
    const key = String(cell.value ?? '').trim()
    if (key) colMap[key] = colNum
  })

  if (!colMap['Kode Sub Kegiatan']) {
    ElMessage.error('Kolom "Kode Sub Kegiatan" tidak ditemukan. Pastikan file adalah Laporan Realisasi Per Dokumen yang benar.')
    return false
  }

  const baris = []
  ws.eachRow((row, rowNum) => {
    if (rowNum <= 5) return
    const obj = {}
    Object.entries(colMap).forEach(([header, colNum]) => {
      obj[header] = getCellText(row.getCell(colNum).value)
    })
    // Skip baris kosong
    if (!obj['Kode Sub Kegiatan'] && !obj['Nomor Dokumen']) return
    baris.push(obj)
  })

  if (!baris.length) {
    ElMessage.warning('Tidak ada data yang ditemukan dalam file')
    return false
  }

  try {
    await api.post('/sumber-data/dokumen-realisasi', { data: baris, tahun: tahun.value, bulan: bulanImport.value })
    await loadSemua()
    const namaBulan = BULAN_OPTIONS.find(b => b.value === bulanImport.value)?.label ?? ''
    ElMessage.success(`${baris.length} dokumen realisasi bulan ${namaBulan} berhasil diimport`)
  } catch {
    ElMessage.error('Gagal menyimpan data ke server')
  }

  return false
}

async function clearData() {
  try {
    await ElMessageBox.confirm(
      'Semua data dokumen realisasi akan dihapus. Lanjutkan?',
      'Konfirmasi Hapus',
      { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
    )
  } catch {
    return
  }
  await api.delete('/sumber-data/dokumen-realisasi', { params: { tahun: tahun.value } })
  resetFilter()
  await loadSemua()
  ElMessage.success('Data berhasil dihapus')
}

const adaData = computed(() => total.value > 0 || adaFilter.value || (kelengkapan.value.skpd || []).length > 0)
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Dokumen Realisasi</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          Sumber: API SIPD Penatausahaan (via extension) atau import Excel
        </p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <el-select v-model="bulanImport" placeholder="Pilih bulan" style="width:150px;">
          <el-option v-for="b in BULAN_OPTIONS" :key="b.value" :label="b.label" :value="b.value" />
        </el-select>
        <el-upload :auto-upload="false" :show-file-list="false" accept=".xlsx,.xls" :on-change="handleFileImport">
          <el-button type="primary" :icon="Upload" :disabled="!bulanImport">Import Excel</el-button>
        </el-upload>
        <el-button type="danger" :icon="Delete" :disabled="!adaData" @click="clearData">
          Hapus Semua
        </el-button>
      </div>
    </div>

    <el-alert v-if="!adaData" type="info" :closable="false" style="margin-bottom:20px;">
      <template #title>Kirim data dari extension SIPD</template>
      <template #default>
        <p style="margin:8px 0 0; font-size:13px; line-height:1.6;">
          Gunakan <strong>browser extension SIPD</strong> untuk menarik Laporan Realisasi Per Dokumen
          dan kirim JSON apa adanya ke endpoint berikut:
        </p>
        <el-tag type="info" style="margin-top:8px; font-family:monospace; font-size:12px;">
          POST /api/sync/dokumen-realisasi
        </el-tag>
        <p style="margin:8px 0 0; font-size:12px; color:#909399;">
          Body: <code>&#123; "tahun": {{ tahun }}, "bulan": 3, "data": [ ...baris JSON SIPD... ] &#125;</code>
          &nbsp;&bull;&nbsp; X-API-Key: &lt;api key&gt;
        </p>
        <p style="margin:6px 0 0; font-size:12px; color:#e6a23c;">
          <strong>bulan</strong> (1-12) wajib dikirim &mdash; menentukan periode data, tidak lagi diambil dari tanggal dokumen.
        </p>
        <p style="margin:6px 0 0; font-size:12px; color:#909399;">
          Alternatif: tombol <strong>Import Excel</strong> di kanan atas untuk file Laporan Realisasi Per Dokumen.
        </p>
      </template>
    </el-alert>

    <el-empty
      v-if="!adaData"
      description="Belum ada data. Kirim dari extension SIPD atau import Excel untuk memulai."
      :image-size="120"
    />

    <template v-else>
      <!-- Filter -->
      <el-card style="margin-bottom:16px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <el-select
            v-model="filter.kodeSkpd"
            placeholder="Semua SKPD"
            clearable filterable
            style="width:250px;"
          >
            <el-option
              v-for="o in opsi.skpd"
              :key="o.kode"
              :label="o.nama || o.kode"
              :value="o.kode"
            >
              <span>{{ o.nama || o.kode }}</span>
              <span style="float:right; color:#c0c4cc; font-size:11px;">{{ o.jumlah }}</span>
            </el-option>
          </el-select>

          <el-select v-model="filter.bulan" placeholder="Semua bulan" clearable style="width:150px;">
            <el-option
              v-for="b in BULAN_OPTIONS"
              :key="b.value"
              :label="b.label"
              :value="b.value"
              :disabled="!opsi.bulan.some(x => x.bulan === b.value)"
            >
              <span>{{ b.label }}</span>
              <span style="float:right; color:#c0c4cc; font-size:11px;">
                {{ opsi.bulan.find(x => x.bulan === b.value)?.jumlah ?? 'belum ada' }}
              </span>
            </el-option>
          </el-select>

          <el-select
            v-model="filter.kodeRekening"
            placeholder="Semua rekening"
            clearable filterable
            style="width:300px;"
          >
            <el-option
              v-for="o in opsi.rekening"
              :key="o.kode"
              :label="labelRekening(o)"
              :value="o.kode"
            />
          </el-select>

          <el-select v-model="filter.jenisDokumen" placeholder="Semua jenis" clearable style="width:130px;">
            <el-option v-for="o in opsi.jenisDokumen" :key="o.kode" :label="o.kode" :value="o.kode" />
          </el-select>

          <el-select v-model="filter.sp2d" placeholder="SP2D: semua" clearable style="width:160px;">
            <el-option label="Sudah ada SP2D" value="ada" />
            <el-option label="Belum ada SP2D" value="belum" />
          </el-select>

          <el-input
            v-model="filter.q"
            placeholder="Cari nomor dokumen / SP2D / sub kegiatan / keterangan..."
            :prefix-icon="Search"
            clearable
            style="width:320px;"
          />

          <el-button v-if="adaFilter" text type="primary" @click="resetFilter">Reset</el-button>
          <el-button :icon="Refresh" :loading="loadingTabel || loadingMatriks" @click="loadSemua" style="margin-left:auto;">
            Muat ulang
          </el-button>
        </div>

        <div v-if="ringkasan" style="margin-top:12px; display:flex; gap:22px; flex-wrap:wrap; font-size:12px; color:#606266;">
          <span>Dokumen: <strong>{{ ringkasan.dokumen.toLocaleString('id-ID') }}</strong></span>
          <span>Nilai: <strong>{{ formatRp(ringkasan.nilai) }}</strong></span>
          <span>Sudah SP2D: <strong>{{ ringkasan.dokumenSp2d.toLocaleString('id-ID') }}</strong> dokumen &bull; {{ formatRp(ringkasan.nilaiSp2d) }}</span>
          <span v-if="ringkasan.dokumen - ringkasan.dokumenSp2d > 0" style="color:#e6a23c;">
            Belum SP2D: <strong>{{ (ringkasan.dokumen - ringkasan.dokumenSp2d).toLocaleString('id-ID') }}</strong> dokumen
          </span>
        </div>
      </el-card>

      <!-- Matriks kelengkapan -->
      <el-card v-loading="loadingMatriks" style="margin-bottom:16px;">
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:10px;">
          <el-icon :size="18" style="color:#409eff;"><Grid /></el-icon>
          <span style="font-size:14px; font-weight:700; color:#303133;">Kelengkapan Dokumen per SKPD &times; Bulan</span>
          <el-tag v-if="jumlahBelumLengkap" type="warning" size="small" effect="light">
            {{ jumlahBelumLengkap }} SKPD belum lengkap
          </el-tag>
          <el-tag v-else-if="bulanDiperiksa.length" type="success" size="small" effect="light">
            Semua SKPD lengkap untuk {{ bulanDiperiksa.length }} bulan
          </el-tag>
          <el-checkbox v-model="hanyaBelumLengkap" size="small" style="margin-left:6px;">
            Hanya yang belum lengkap
          </el-checkbox>
          <el-button text size="small" @click="tampilkanMatriks = !tampilkanMatriks" style="margin-left:auto;">
            {{ tampilkanMatriks ? 'Sembunyikan' : 'Tampilkan' }}
          </el-button>
        </div>

        <p style="margin:0 0 10px; font-size:12px; color:#909399;">
          Baris = SKPD yang <strong>punya pagu</strong> pada rekening yang disaring, jadi dinas yang dokumennya belum
          masuk sama sekali tetap kelihatan. Angka dalam sel = jumlah dokumen; sel abu = belum ada dokumen.
          Bulan yang sama sekali belum diimport tidak dihitung sebagai kekurangan. Klik sel untuk melihat rinciannya.
        </p>

        <div v-if="tampilkanMatriks" style="overflow-x:auto;">
          <table class="matriks">
            <thead>
              <tr>
                <th class="lengket kiri">SKPD</th>
                <th
                  v-for="b in BULAN_OPTIONS"
                  :key="b.value"
                  :class="{ mati: !bulanDiperiksa.includes(b.value) }"
                >
                  {{ BULAN_SINGKAT[b.value] }}
                  <div class="jumlah-bulan">
                    {{ bulanDiperiksa.includes(b.value)
                      ? (kelengkapan.perBulan.find(x => x.bulan === b.value)?.skpdAda ?? 0) + ' skpd'
                      : '—' }}
                  </div>
                </th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in barisMatriks" :key="row.kodeSkpd">
                <td class="lengket kiri nama">
                  <div style="font-weight:600;">{{ row.namaSkpd }}</div>
                  <div style="font-size:10px; color:#c0c4cc; font-family:monospace;">
                    {{ row.kodeSkpd }}
                    <span v-if="row.pagu" style="color:#909399;"> &bull; pagu {{ formatMio(row.pagu) }}</span>
                    <span v-else style="color:#e6a23c;"> &bull; tanpa pagu</span>
                  </div>
                </td>
                <td
                  v-for="b in BULAN_OPTIONS"
                  :key="b.value"
                  :class="{
                    ada: !!selMatriks(row, b.value),
                    kosong: !selMatriks(row, b.value) && bulanDiperiksa.includes(b.value),
                    mati: !bulanDiperiksa.includes(b.value),
                    aktif: filter.kodeSkpd === row.kodeSkpd && filter.bulan === b.value,
                  }"
                  @click="klikSel(row, b.value)"
                >
                  <el-tooltip
                    v-if="selMatriks(row, b.value)"
                    :content="`${selMatriks(row, b.value).dokumen} dokumen · ${formatRp(selMatriks(row, b.value).nilai)} · ${selMatriks(row, b.value).dokumenSp2d} sudah SP2D`"
                    placement="top"
                  >
                    <span>{{ selMatriks(row, b.value).dokumen }}</span>
                  </el-tooltip>
                  <span v-else>{{ bulanDiperiksa.includes(b.value) ? '—' : '' }}</span>
                </td>
                <td class="total">
                  <div>{{ row.dokumen.toLocaleString('id-ID') }}</div>
                  <div v-if="bulanKosong(row).length" class="kurang">
                    kurang {{ bulanKosong(row).map(b => BULAN_SINGKAT[b]).join(', ') }}
                  </div>
                </td>
              </tr>
              <tr v-if="!barisMatriks.length">
                <td :colspan="14" style="text-align:center; color:#909399; padding:14px;">
                  {{ hanyaBelumLengkap ? 'Semua SKPD sudah lengkap' : 'Tidak ada SKPD yang cocok dengan filter' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </el-card>

      <!-- Daftar dokumen -->
      <el-table
        v-loading="loadingTabel"
        :data="rows"
        border
        stripe
        size="small"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
      >
        <el-table-column type="index" :index="(currentPage - 1) * pageSize + 1" label="No" width="55" align="center" />
        <el-table-column label="Bulan" prop="bulan" width="80" align="center">
          <template #default="{ row }">
            <el-tag size="small" type="info" effect="plain">{{ BULAN_SINGKAT[row.bulan] || '—' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="SKPD" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <div style="font-size:12px;">{{ row.nama_sub_skpd || row.nama_skpd }}</div>
            <div style="font-family:monospace; font-size:10px; color:#c0c4cc;">{{ row.kode_sub_skpd }}</div>
          </template>
        </el-table-column>
        <el-table-column label="Kode Sub Kegiatan" prop="kode_sub_kegiatan" width="170">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_kegiatan }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Sub Kegiatan" prop="nama_sub_kegiatan" min-width="200" show-overflow-tooltip />
        <el-table-column label="Kode Rekening" prop="kode_rekening" width="170">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_rekening }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Rekening" prop="nama_rekening" min-width="220" show-overflow-tooltip />
        <el-table-column label="Jenis" prop="jenis_dokumen" width="70" align="center">
          <template #default="{ row }">
            <el-tag size="small" type="info">{{ row.jenis_dokumen }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Tanggal Dokumen" prop="tanggal_dokumen" width="140" />
        <el-table-column label="Keterangan" prop="keterangan_dokumen" min-width="200" show-overflow-tooltip />
        <el-table-column label="Nilai Realisasi" prop="nilai_realisasi" width="160" align="right">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:12px; font-variant-numeric:tabular-nums;">
              {{ Number(row.nilai_realisasi || 0).toLocaleString('id-ID') }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="Nomor SP2D" prop="nomor_sp2d" width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.nomor_sp2d || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[20, 50, 100, 200]"
        :total="total"
        layout="total, sizes, prev, pager, next"
        background
        style="margin-top:16px; justify-content:flex-end; display:flex;"
      />
    </template>
  </div>
</template>

<style scoped>
.matriks {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  width: 100%;
}
.matriks th,
.matriks td {
  border-bottom: 1px solid #ebeef5;
  border-right: 1px solid #ebeef5;
  padding: 5px 6px;
  text-align: center;
  white-space: nowrap;
}
.matriks thead th {
  background: #f5f7fa;
  color: #606266;
  font-weight: 600;
  font-size: 11px;
  position: sticky;
  top: 0;
  z-index: 2;
}
.matriks th.lengket,
.matriks td.lengket {
  position: sticky;
  left: 0;
  z-index: 3;
  background: #fff;
  text-align: left;
  min-width: 240px;
  max-width: 300px;
}
.matriks thead th.lengket {
  background: #f5f7fa;
  z-index: 4;
}
.matriks td.nama {
  white-space: normal;
  line-height: 1.3;
  font-size: 12px;
}
.matriks .jumlah-bulan {
  font-weight: 400;
  font-size: 10px;
  color: #c0c4cc;
}
.matriks td.ada {
  background: #f0f9eb;
  color: #529b2e;
  font-weight: 600;
  cursor: pointer;
}
.matriks td.kosong {
  background: #fef0f0;
  color: #f89898;
  cursor: pointer;
}
.matriks td.mati {
  background: #fafafa;
  color: #dcdfe6;
}
.matriks thead th.mati {
  color: #c0c4cc;
}
.matriks td.aktif {
  outline: 2px solid #409eff;
  outline-offset: -2px;
}
.matriks td.ada:hover,
.matriks td.kosong:hover {
  filter: brightness(0.96);
}
.matriks td.total {
  font-weight: 600;
  color: #303133;
  background: #fafcff;
}
.matriks td.total .kurang {
  font-weight: 400;
  font-size: 10px;
  color: #e6a23c;
}
</style>
