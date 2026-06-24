<script setup>
import { ref, computed, onMounted } from 'vue'
import ExcelJS from 'exceljs'
import { Upload, Delete, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../utils/api.js'

const rawData = ref([])
const search = ref('')
const expandedSubkeg = ref(new Set())
const loading = ref(false)

onMounted(async () => {
  try {
    const { data } = await api.get('/paket-anggaran')
    rawData.value = data.data
  } catch {
    rawData.value = []
  }
})

function formatRupiah(val) {
  if (!val && val !== 0) return '-'
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)
}

// Group: SUB UNIT → SUB KEGIATAN → PAKET/KELOMPOK (sum pagu per nama paket)
const grouped = computed(() => {
  const unitMap = new Map()

  for (const row of rawData.value) {
    const kodeSubUnit = row['KODE SUB UNIT'] || ''
    const namaSubUnit = row['NAMA SUB UNIT'] || '(Tanpa Sub Unit)'
    const kodeSubkeg = row['KODE SUB KEGIATAN'] || ''
    const namaSubkeg = row['NAMA SUB KEGIATAN'] || '-'
    const namaKegiatan = row['NAMA KEGIATAN'] || '-'
    const kodeKegiatan = row['KODE KEGIATAN'] || ''
    const kodeSumberDana = row['KODE SUMBER DANA'] || ''
    const namaSumberDana = row['NAMA SUMBER DANA'] || ''
    const namaPaket = row['NAMA PAKET/KELOMPOK'] || ''
    const pagu = Number(row['PAGU']) || 0

    if (!namaPaket || namaPaket === '-') continue

    // Sub unit
    if (!unitMap.has(kodeSubUnit)) {
      unitMap.set(kodeSubUnit, {
        kodeSubUnit,
        namaSubUnit,
        totalPagu: 0,
        subkegMap: new Map(),
      })
    }
    const unit = unitMap.get(kodeSubUnit)
    unit.totalPagu += pagu

    // Sub kegiatan dalam unit
    if (!unit.subkegMap.has(kodeSubkeg)) {
      unit.subkegMap.set(kodeSubkeg, {
        kodeSubkeg,
        namaSubkeg,
        kodeKegiatan,
        namaKegiatan,
        totalPagu: 0,
        paketMap: new Map(),
      })
    }
    const sk = unit.subkegMap.get(kodeSubkeg)
    sk.totalPagu += pagu

    // Paket dalam sub kegiatan — key: nama paket (gabung/sum pagu yang sama)
    const paketKey = namaPaket.trim()
    if (!sk.paketMap.has(paketKey)) {
      sk.paketMap.set(paketKey, {
        namaPaket: paketKey,
        sumberDana: [],
        rekening: [],
        pagu: 0,
      })
    }
    const paket = sk.paketMap.get(paketKey)
    paket.pagu += pagu
    // Kumpulkan sumber dana unik
    if (namaSumberDana && namaSumberDana !== '-' && !paket.sumberDana.find(s => s.kode === kodeSumberDana)) {
      paket.sumberDana.push({ kode: kodeSumberDana, nama: namaSumberDana })
    }
    // Kumpulkan rekening penyusun
    const kodeRekening = row['KODE REKENING'] || ''
    const namaRekening = row['NAMA REKENING'] || ''
    if (namaRekening && namaRekening !== '-') {
      paket.rekening.push({ kode: kodeRekening, nama: namaRekening, pagu })
    }
  }

  return Array.from(unitMap.values()).map(unit => ({
    ...unit,
    subkegiatan: Array.from(unit.subkegMap.values()).map(sk => ({
      ...sk,
      pakets: Array.from(sk.paketMap.values()),
    })),
  }))
})

const filteredGrouped = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return grouped.value

  return grouped.value
    .map(unit => ({
      ...unit,
      subkegiatan: unit.subkegiatan.filter(sk =>
        sk.kodeSubkeg.toLowerCase().includes(q) ||
        sk.namaSubkeg.toLowerCase().includes(q)
      ),
    }))
    .filter(unit => unit.subkegiatan.length > 0)
})

function toggleSubkeg(kode) {
  if (expandedSubkeg.value.has(kode)) {
    expandedSubkeg.value.delete(kode)
  } else {
    expandedSubkeg.value.add(kode)
  }
  expandedSubkeg.value = new Set(expandedSubkeg.value)
}

function toggleUnit(kode) {
  if (expandedSubkeg.value.has(kode)) {
    expandedSubkeg.value.delete(kode)
  } else {
    expandedSubkeg.value.add(kode)
  }
  expandedSubkeg.value = new Set(expandedSubkeg.value)
}

function expandAll() {
  const keys = []
  for (const unit of filteredGrouped.value) {
    keys.push(unit.kodeSubUnit)
    for (const sk of unit.subkegiatan) keys.push(sk.kodeSubkeg)
  }
  expandedSubkeg.value = new Set(keys)
}

function collapseAll() {
  expandedSubkeg.value = new Set()
}

// Warna tag sumber dana berdasarkan kode awalan
function sumberDanaTagType(kode) {
  if (!kode || kode === '-') return 'info'
  const prefix = String(kode).trim().charAt(0)
  if (prefix === '1') return ''       // primary (biru) = PAD / APBD
  if (prefix === '2') return 'success' // hijau = Dana Transfer
  if (prefix === '3') return 'warning' // kuning = Pinjaman
  if (prefix === '4') return 'danger'  // merah = Hibah
  return 'info'
}

// Import Excel
async function handleFileImport(uploadFile) {
  const file = uploadFile.raw
  if (!file) return false

  loading.value = true
  try {
    const buffer = await file.arrayBuffer()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)

    const sheet = workbook.worksheets[0]
    if (!sheet) {
      ElMessage.error('Sheet tidak ditemukan dalam file Excel.')
      return false
    }

    const rows = []
    let headers = []

    function cellToValue(raw) {
      if (raw === null || raw === undefined) return ''
      // Formula cell: ambil result-nya
      if (typeof raw === 'object' && 'result' in raw) return cellToValue(raw.result)
      // Rich text cell
      if (typeof raw === 'object' && Array.isArray(raw.richText)) {
        return raw.richText.map(r => r.text ?? '').join('')
      }
      // Shared string / hyperlink
      if (typeof raw === 'object' && 'text' in raw) return String(raw.text)
      // Date object
      if (raw instanceof Date) return raw.toISOString()
      return raw
    }

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) {
        headers = row.values.slice(1).map(h => String(cellToValue(h) || '').trim())
        return
      }
      const obj = {}
      headers.forEach((h, i) => {
        const cell = row.getCell(i + 1)
        obj[h] = cellToValue(cell.value)
      })
      rows.push(obj)
    })

    if (rows.length === 0) {
      ElMessage.error('File Excel kosong atau tidak memiliki data.')
      return false
    }

    const KEEP_COLS = [
      'KODE SUB UNIT', 'NAMA SUB UNIT',
      'KODE SUB KEGIATAN', 'NAMA SUB KEGIATAN',
      'NAMA KEGIATAN', 'KODE KEGIATAN',
      'KODE SUMBER DANA', 'NAMA SUMBER DANA',
      'NAMA PAKET/KELOMPOK', 'PAGU',
      'KODE REKENING', 'NAMA REKENING',
    ]
    const slimRows = rows.map(r => Object.fromEntries(KEEP_COLS.map(k => [k, r[k] ?? ''])))
    rawData.value = slimRows
    await api.post('/paket-anggaran', { data: slimRows })
    expandedSubkeg.value = new Set()
    ElMessage.success(`Berhasil import ${rows.length} baris dari ${file.name}.`)
  } catch (e) {
    ElMessage.error('Gagal membaca file Excel. Pastikan format sesuai.')
  } finally {
    loading.value = false
  }
  return false
}

async function clearData() {
  await ElMessageBox.confirm(
    'Semua data paket anggaran akan dihapus. Lanjutkan?',
    'Konfirmasi Hapus',
    { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
  )
  await api.delete('/paket-anggaran')
  rawData.value = []
  expandedSubkeg.value = new Set()
  ElMessage.success('Data berhasil dihapus.')
}

const totalPaguAll = computed(() => grouped.value.reduce((s, u) => s + u.totalPagu, 0))
const totalSubUnit = computed(() => grouped.value.length)
const totalSubkeg = computed(() => grouped.value.reduce((s, u) => s + u.subkegiatan.length, 0))
const totalPaket = computed(() => grouped.value.reduce((s, u) => s + u.subkegiatan.reduce((ss, sk) => ss + sk.pakets.length, 0), 0))
</script>

<template>
  <div>
    <!-- Header -->
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Paket Anggaran</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          Daftar paket/kelompok per sub kegiatan beserta sumber dana
        </p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".xlsx,.xls"
          :on-change="handleFileImport"
        >
          <el-button type="primary" :icon="Upload" :loading="loading">Import Excel</el-button>
        </el-upload>
        <el-button type="danger" :icon="Delete" :disabled="rawData.length === 0" @click="clearData">
          Hapus Semua
        </el-button>
      </div>
    </div>

    <!-- Summary cards -->
    <el-row :gutter="16" style="margin-bottom:20px;" v-if="rawData.length > 0">
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" style="border-radius:8px;">
          <div style="font-size:12px; color:#909399; margin-bottom:4px;">Sub Unit</div>
          <div style="font-size:20px; font-weight:700; color:#303133;">{{ totalSubUnit }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" style="border-radius:8px;">
          <div style="font-size:12px; color:#909399; margin-bottom:4px;">Sub Kegiatan</div>
          <div style="font-size:20px; font-weight:700; color:#606266;">{{ totalSubkeg }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" style="border-radius:8px;">
          <div style="font-size:12px; color:#909399; margin-bottom:4px;">Paket</div>
          <div style="font-size:20px; font-weight:700; color:#409eff;">{{ totalPaket }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" style="border-radius:8px;">
          <div style="font-size:12px; color:#909399; margin-bottom:4px;">Total Pagu</div>
          <div style="font-size:15px; font-weight:700; color:#303133;">{{ formatRupiah(totalPaguAll) }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- Empty state -->
    <el-empty
      v-if="rawData.length === 0"
      description="Belum ada data. Import file Excel (rekapver5) untuk memulai."
      :image-size="120"
    />

    <template v-else>
      <!-- Search + expand controls -->
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">
        <el-input
          v-model="search"
          placeholder="Cari kode / nama sub kegiatan..."
          :prefix-icon="Search"
          clearable
          style="max-width:400px;"
        />
        <el-button size="small" @click="expandAll">Buka Semua</el-button>
        <el-button size="small" @click="collapseAll">Tutup Semua</el-button>
        <span style="font-size:12px; color:#909399;">
          {{ filteredGrouped.length }} sub unit ditampilkan
        </span>
      </div>

      <!-- No result -->
      <el-empty
        v-if="filteredGrouped.length === 0"
        description="Tidak ada sub kegiatan yang cocok."
        :image-size="80"
      />

      <!-- Sub Unit cards -->
      <div v-for="unit in filteredGrouped" :key="unit.kodeSubUnit" style="margin-bottom:16px;">

        <!-- Unit header -->
        <div
          @click="toggleUnit(unit.kodeSubUnit)"
          style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            background:#409eff;
            border-radius:8px;
            padding:12px 18px;
            cursor:pointer;
            user-select:none;
          "
          :style="expandedSubkeg.has(unit.kodeSubUnit)
            ? 'border-bottom-left-radius:0;border-bottom-right-radius:0;'
            : ''"
        >
          <div style="flex:1; min-width:0;">
            <div style="font-family:monospace; font-size:11px; color:rgba(255,255,255,0.75); margin-bottom:2px;">
              {{ unit.kodeSubUnit }}
            </div>
            <div style="font-size:14px; font-weight:700; color:#fff;">{{ unit.namaSubUnit }}</div>
          </div>
          <div style="display:flex; align-items:center; gap:20px; flex-shrink:0; margin-left:16px;">
            <div style="text-align:right;">
              <div style="font-size:11px; color:rgba(255,255,255,0.7);">Sub Kegiatan</div>
              <div style="font-size:14px; font-weight:700; color:#fff;">{{ unit.subkegiatan.length }}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px; color:rgba(255,255,255,0.7);">Total Pagu</div>
              <div style="font-size:13px; font-weight:700; color:#fff;">{{ formatRupiah(unit.totalPagu) }}</div>
            </div>
            <el-icon
              style="color:#fff; transition:transform 0.2s;"
              :style="expandedSubkeg.has(unit.kodeSubUnit) ? 'transform:rotate(180deg)' : ''"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
            </el-icon>
          </div>
        </div>

        <!-- Sub kegiatan list (inside unit) -->
        <div
          v-show="expandedSubkeg.has(unit.kodeSubUnit)"
          style="
            border:1px solid #e4e7ed;
            border-top:none;
            border-bottom-left-radius:8px;
            border-bottom-right-radius:8px;
            background:#f8f9fc;
            padding:12px;
          "
        >
          <div v-for="sk in unit.subkegiatan" :key="sk.kodeSubkeg" style="margin-bottom:10px;">

            <!-- Sub kegiatan header -->
            <div
              @click="toggleSubkeg(sk.kodeSubkeg)"
              style="
                display:flex;
                align-items:center;
                justify-content:space-between;
                background:#fff;
                border:1px solid #dcdfe6;
                border-radius:6px;
                padding:10px 14px;
                cursor:pointer;
                user-select:none;
              "
              :style="expandedSubkeg.has(sk.kodeSubkeg)
                ? 'border-bottom-left-radius:0;border-bottom-right-radius:0;border-bottom-color:transparent;'
                : ''"
            >
              <div style="flex:1; min-width:0;">
                <div style="font-family:monospace; font-size:11px; color:#909399; margin-bottom:2px;">
                  {{ sk.kodeSubkeg }}
                </div>
                <div style="font-size:13px; font-weight:600; color:#303133; line-height:1.4;">{{ sk.namaSubkeg }}</div>
                <div style="font-size:11px; color:#c0c4cc; margin-top:1px;">{{ sk.namaKegiatan }}</div>
              </div>
              <div style="display:flex; align-items:center; gap:20px; flex-shrink:0; margin-left:12px;">
                <div style="text-align:right;">
                  <div style="font-size:11px; color:#909399;">Paket</div>
                  <div style="font-size:13px; font-weight:600; color:#409eff;">{{ sk.pakets.length }}</div>
                </div>
                <div style="text-align:right;">
                  <div style="font-size:11px; color:#909399;">Total Pagu</div>
                  <div style="font-size:12px; font-weight:600; color:#303133;">{{ formatRupiah(sk.totalPagu) }}</div>
                </div>
                <el-icon
                  style="color:#909399; transition:transform 0.2s;"
                  :style="expandedSubkeg.has(sk.kodeSubkeg) ? 'transform:rotate(180deg)' : ''"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
                </el-icon>
              </div>
            </div>

            <!-- Paket table -->
            <div
              v-show="expandedSubkeg.has(sk.kodeSubkeg)"
              style="
                border:1px solid #dcdfe6;
                border-top:none;
                border-bottom-left-radius:6px;
                border-bottom-right-radius:6px;
                background:#fff;
                overflow:hidden;
              "
            >
              <el-table
                :data="sk.pakets"
                size="small"
                style="width:100%;"
                :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
                stripe
                row-key="namaPaket"
              >
                <el-table-column type="expand">
                  <template #default="{ row }">
                    <div v-if="row.rekening.length > 1" style="padding:8px 16px 8px 48px; background:#fafafa;">
                      <div style="font-size:11px; color:#909399; margin-bottom:6px; font-weight:600;">Rekening Penyusun:</div>
                      <el-table
                        :data="row.rekening"
                        size="small"
                        :show-header="true"
                        :header-cell-style="{ background:'#f0f2f5', color:'#909399', fontSize:'11px' }"
                        style="width:100%;"
                      >
                        <el-table-column label="Kode Rekening" prop="kode" width="200">
                          <template #default="{ row: r }">
                            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ r.kode }}</span>
                          </template>
                        </el-table-column>
                        <el-table-column label="Nama Rekening" prop="nama" min-width="260">
                          <template #default="{ row: r }">
                            <span style="font-size:11px; color:#303133;">{{ r.nama }}</span>
                          </template>
                        </el-table-column>
                        <el-table-column label="Pagu" width="180" align="right">
                          <template #default="{ row: r }">
                            <span style="font-size:11px; color:#606266;">{{ formatRupiah(r.pagu) }}</span>
                          </template>
                        </el-table-column>
                      </el-table>
                    </div>
                    <div v-else style="padding:8px 16px 8px 48px; font-size:12px; color:#c0c4cc; background:#fafafa;">
                      Hanya 1 rekening — tidak ada rincian tambahan.
                    </div>
                  </template>
                </el-table-column>
                <el-table-column type="index" label="No" width="50" align="center" />
                <el-table-column label="Nama Paket / Kelompok" prop="namaPaket" min-width="300">
                  <template #default="{ row }">
                    <div style="display:flex; align-items:center; gap:6px;">
                      <div style="font-size:12px; color:#303133; line-height:1.5;">{{ row.namaPaket }}</div>
                      <el-tag v-if="row.rekening.length > 1" size="small" type="warning" style="flex-shrink:0;">
                        {{ row.rekening.length }} rekening
                      </el-tag>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="Sumber Dana" width="260">
                  <template #default="{ row }">
                    <div v-if="row.sumberDana.length" style="display:flex; flex-direction:column; gap:4px;">
                      <div v-for="sd in row.sumberDana" :key="sd.kode" style="display:flex; flex-direction:column; gap:2px;">
                        <el-tag
                          :type="sumberDanaTagType(sd.kode)"
                          size="small"
                          style="max-width:220px; white-space:normal; height:auto; line-height:1.4; padding:2px 6px;"
                        >
                          {{ sd.nama }}
                        </el-tag>
                        <span style="font-size:10px; color:#c0c4cc; font-family:monospace;">{{ sd.kode }}</span>
                      </div>
                    </div>
                    <span v-else style="color:#c0c4cc; font-size:12px;">-</span>
                  </template>
                </el-table-column>
                <el-table-column label="Pagu" width="200" align="right">
                  <template #default="{ row }">
                    <span style="font-size:12px; font-weight:600; color:#303133;">{{ formatRupiah(row.pagu) }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>

          </div>
        </div>

      </div>
    </template>
  </div>
</template>
