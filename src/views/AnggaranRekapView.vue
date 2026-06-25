<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import ExcelJS from 'exceljs'
import { Upload, Delete, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../utils/api.js'

const rawData = ref([])
const search = ref('')
const route = useRoute()
const tahun = computed(() => route.params.tahun)

onMounted(async () => {
  try {
    const { data } = await api.get('/sumber-data/anggaran', { params: { tahun: tahun.value } })
    rawData.value = data.data
  } catch {
    rawData.value = []
  }
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rawData.value
  return rawData.value.filter(r =>
    r.kode_sub_kegiatan?.toLowerCase().includes(q) ||
    r.nama_sub_kegiatan?.toLowerCase().includes(q) ||
    r.kode_sub_unit?.toLowerCase().includes(q) ||
    r.paket_kelompok?.toLowerCase().includes(q) ||
    r.nama_paket_kelompok?.toLowerCase().includes(q)
  )
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

  // Ambil header dari row 1, simpan exact string sebagai key
  const colMap = {}
  ws.getRow(1).eachCell((cell, colNum) => {
    const key = String(cell.value ?? '').trim()
    if (key) colMap[key] = colNum
  })

  if (!colMap['KODE REKENING']) {
    ElMessage.error('Kolom "KODE REKENING" tidak ditemukan. Pastikan file adalah rekap anggaran yang benar.')
    return false
  }

  const rows = []
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    // Skip baris hierarchy (tanpa kode rekening)
    const kodeRek = row.getCell(colMap['KODE REKENING']).value
    if (!kodeRek) return

    const obj = {}
    Object.entries(colMap).forEach(([header, colNum]) => {
      const val = row.getCell(colNum).value
      obj[header] = val == null ? null : val
    })
    rows.push(obj)
  })

  if (!rows.length) {
    ElMessage.warning('Tidak ada baris data rekening yang ditemukan')
    return false
  }

  try {
    await api.post('/sumber-data/anggaran', { data: rows, tahun: tahun.value })
    const { data } = await api.get('/sumber-data/anggaran', { params: { tahun: tahun.value } })
    rawData.value = data.data
    ElMessage.success(`${rows.length} baris anggaran berhasil diimport`)
  } catch {
    ElMessage.error('Gagal menyimpan data ke server')
  }

  return false
}

async function clearData() {
  try {
    await ElMessageBox.confirm(
      'Semua data anggaran rekap akan dihapus. Lanjutkan?',
      'Konfirmasi Hapus',
      { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
    )
  } catch {
    return
  }
  await api.delete('/sumber-data/anggaran', { params: { tahun: tahun.value } })
  rawData.value = []
  ElMessage.success('Data berhasil dihapus')
}
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Anggaran Rekap</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          {{ rawData.length }} baris &bull; Sumber: file rekap anggaran (rekap4/rekap5)
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
      description="Belum ada data. Import file Excel rekap anggaran untuk memulai."
      :image-size="120"
    />

    <template v-else>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">
        <el-input
          v-model="search"
          placeholder="Cari kode sub kegiatan / nama / paket..."
          :prefix-icon="Search"
          clearable
          style="max-width:380px;"
        />
        <span style="font-size:12px; color:#909399;">{{ filtered.length }} baris ditampilkan</span>
      </div>

      <el-table
        :data="filtered"
        border
        stripe
        size="small"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
      >
        <el-table-column type="index" label="No" width="55" align="center" />
        <el-table-column label="Kode Sub Unit" prop="kode_sub_unit" width="200">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_unit }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Kode Sub Kegiatan" prop="kode_sub_kegiatan" width="170">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_kegiatan }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Sub Kegiatan" prop="nama_sub_kegiatan" min-width="220" show-overflow-tooltip />
        <el-table-column label="Paket/Kelompok" prop="paket_kelompok" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.paket_kelompok" size="small" type="info">{{ row.paket_kelompok }}</el-tag>
            <span v-else style="color:#c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column label="Kode Rekening" prop="kode_rekening" width="170">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_rekening }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Rekening" prop="nama_rekening" min-width="200" show-overflow-tooltip />
        <el-table-column label="Sumber Dana" prop="nama_sumber_dana" width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span style="font-size:12px;">{{ row.nama_sumber_dana || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Pagu" prop="pagu" width="150" align="right">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:12px; font-variant-numeric:tabular-nums;">
              {{ Number(row.pagu || 0).toLocaleString('id-ID') }}
            </span>
          </template>
        </el-table-column>
      </el-table>
    </template>
  </div>
</template>
