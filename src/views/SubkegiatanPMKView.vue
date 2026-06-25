<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import ExcelJS from 'exceljs'
import { Upload, Delete, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../utils/api.js'

const rawData = ref([])
const search = ref('')
const currentPage = ref(1)
const pageSize = ref(50)
const route = useRoute()
const tahun = computed(() => route.params.tahun)

onMounted(async () => {
  try {
    const { data } = await api.get('/referensi/subkegiatan-pmk', { params: { tahun: tahun.value } })
    rawData.value = data.data
  } catch {
    rawData.value = []
  }
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rawData.value
  return rawData.value.filter(r =>
    r.kode_subkegiatan?.toLowerCase().includes(q) ||
    r.subkegiatan?.toLowerCase().includes(q) ||
    r.bidang?.toLowerCase().includes(q)
  )
})

const paginated = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch(search, () => { currentPage.value = 1 })

const bidangList = computed(() => {
  const set = new Set(rawData.value.map(r => r.bidang).filter(Boolean))
  return [...set].sort()
})

async function handleFileImport(uploadFile) {
  if (!uploadFile.raw) return false

  const buffer = await uploadFile.raw.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) {
    ElMessage.error('Sheet tidak ditemukan dalam file Excel')
    return false
  }

  // Detect header row (row 1)
  const headerRow = ws.getRow(1)
  const colMap = {}
  headerRow.eachCell((cell, colNum) => {
    const key = String(cell.value || '').trim().toLowerCase()
    colMap[key] = colNum
  })

  const kodeCol = colMap['kode_subkegiatan']
  const subkegCol = colMap['subkegiatan']
  const bidangCol = colMap['bidang']

  if (!kodeCol || !subkegCol || !bidangCol) {
    ElMessage.error('Kolom tidak ditemukan. Pastikan header: kode_subkegiatan, subkegiatan, bidang')
    return false
  }

  const rows = []
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const kode = String(row.getCell(kodeCol).value ?? '').trim()
    const subkeg = String(row.getCell(subkegCol).value ?? '').trim()
    const bidang = String(row.getCell(bidangCol).value ?? '').trim()
    if (kode || subkeg) rows.push({ kode_subkegiatan: kode, subkegiatan: subkeg, bidang })
  })

  if (!rows.length) {
    ElMessage.warning('Tidak ada data yang bisa dibaca dari file')
    return false
  }

  try {
    await api.post('/referensi/subkegiatan-pmk', { data: rows, tahun: tahun.value })
    rawData.value = rows
    ElMessage.success(`${rows.length} subkegiatan PMK berhasil diimport`)
  } catch {
    ElMessage.error('Gagal menyimpan data ke server')
  }

  return false
}

async function clearData() {
  try {
    await ElMessageBox.confirm(
      'Semua data subkegiatan PMK akan dihapus. Lanjutkan?',
      'Konfirmasi Hapus',
      { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
    )
  } catch {
    return
  }
  await api.delete('/referensi/subkegiatan-pmk', { params: { tahun: tahun.value } })
  rawData.value = []
  ElMessage.success('Data berhasil dihapus')
}
</script>

<template>
  <div>
    <!-- Header -->
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Subkegiatan PMK</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          {{ rawData.length }} subkegiatan &bull; {{ bidangList.length }} bidang
        </p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".xlsx,.xls"
          :on-change="handleFileImport"
        >
          <el-button type="primary" :icon="Upload">Import Excel</el-button>
        </el-upload>
        <el-button type="danger" :icon="Delete" :disabled="rawData.length === 0" @click="clearData">
          Hapus Semua
        </el-button>
      </div>
    </div>

    <el-empty
      v-if="rawData.length === 0"
      description="Belum ada data. Import file Excel untuk memulai."
      :image-size="120"
    />

    <template v-else>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">
        <el-input
          v-model="search"
          placeholder="Cari kode / subkegiatan / bidang..."
          :prefix-icon="Search"
          clearable
          style="max-width:380px;"
        />
        <span style="font-size:12px; color:#909399;">{{ filtered.length }} baris ditampilkan</span>
      </div>

      <el-table
        :data="paginated"
        border
        stripe
        size="small"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
      >
        <el-table-column type="index" :index="(currentPage - 1) * pageSize + 1" label="No" width="55" align="center" />
        <el-table-column label="Kode Subkegiatan" prop="kode_subkegiatan" width="200">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:12px; color:#606266;">{{ row.kode_subkegiatan }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Subkegiatan" prop="subkegiatan" min-width="300">
          <template #default="{ row }">
            <span style="font-size:12px; color:#303133;">{{ row.subkegiatan }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Bidang" prop="bidang" width="160">
          <template #default="{ row }">
            <el-tag size="small" type="info" style="text-transform:capitalize;">{{ row.bidang }}</el-tag>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[20, 50, 100, 200]"
        :total="filtered.length"
        layout="total, sizes, prev, pager, next"
        background
        style="margin-top:16px; justify-content:flex-end; display:flex;"
      />
    </template>
  </div>
</template>
