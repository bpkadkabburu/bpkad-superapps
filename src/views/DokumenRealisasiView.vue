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

function getCellText(val) {
  if (val == null) return null
  if (typeof val === 'object' && val.richText) return val.richText.map(r => r.text).join('')
  if (typeof val === 'object' && val.text) return val.text
  return String(val)
}

onMounted(async () => {
  try {
    const { data } = await api.get('/sumber-data/dokumen-realisasi', { params: { tahun: tahun.value } })
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
    r.nomor_dokumen?.toLowerCase().includes(q) ||
    r.nomor_sp2d?.toLowerCase().includes(q) ||
    r.kode_sub_skpd?.toLowerCase().includes(q)
  )
})

const paginated = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch(search, () => { currentPage.value = 1 })

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

  const rows = []
  ws.eachRow((row, rowNum) => {
    if (rowNum <= 5) return
    const obj = {}
    Object.entries(colMap).forEach(([header, colNum]) => {
      obj[header] = getCellText(row.getCell(colNum).value)
    })
    // Skip baris kosong
    if (!obj['Kode Sub Kegiatan'] && !obj['Nomor Dokumen']) return
    rows.push(obj)
  })

  if (!rows.length) {
    ElMessage.warning('Tidak ada data yang ditemukan dalam file')
    return false
  }

  try {
    await api.post('/sumber-data/dokumen-realisasi', { data: rows, tahun: tahun.value })
    const { data } = await api.get('/sumber-data/dokumen-realisasi', { params: { tahun: tahun.value } })
    rawData.value = data.data
    ElMessage.success(`${rows.length} dokumen realisasi berhasil diimport`)
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
  rawData.value = []
  ElMessage.success('Data berhasil dihapus')
}
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Dokumen Realisasi</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          {{ rawData.length }} dokumen &bull; Sumber: API SIPD Penatausahaan (via extension) atau import Excel
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

    <el-alert
      v-if="rawData.length === 0"
      type="info"
      :closable="false"
      style="margin-bottom:20px;"
    >
      <template #title>Kirim data dari extension SIPD</template>
      <template #default>
        <p style="margin:8px 0 0; font-size:13px; line-height:1.6;">
          Gunakan <strong>browser extension SIPD</strong> untuk menarik Laporan Realisasi Per Dokumen
          dan kirim JSON apa adanya ke endpoint berikut:
        </p>
        <el-tag type="info" style="margin-top:8px; font-family:monospace; font-size:12px;">
          POST /api/sumber-data/dokumen-realisasi
        </el-tag>
        <p style="margin:8px 0 0; font-size:12px; color:#909399;">
          Body: <code>&#123; "tahun": {{ tahun }}, "data": [ ...baris JSON SIPD... ] &#125;</code>
          &nbsp;&bull;&nbsp; Authorization: Bearer &lt;token&gt;
        </p>
        <p style="margin:6px 0 0; font-size:12px; color:#909399;">
          Alternatif: tombol <strong>Import Excel</strong> di kanan atas untuk file Laporan Realisasi Per Dokumen.
        </p>
      </template>
    </el-alert>

    <el-empty
      v-if="rawData.length === 0"
      description="Belum ada data. Kirim dari extension SIPD atau import Excel untuk memulai."
      :image-size="120"
    />

    <template v-else>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">
        <el-input
          v-model="search"
          placeholder="Cari kode sub kegiatan / nomor dokumen / nomor SP2D..."
          :prefix-icon="Search"
          clearable
          style="max-width:420px;"
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
        <el-table-column label="Kode Sub SKPD" prop="kode_sub_skpd" width="200">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_skpd }}</span>
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
        :total="filtered.length"
        layout="total, sizes, prev, pager, next"
        background
        style="margin-top:16px; justify-content:flex-end; display:flex;"
      />
    </template>
  </div>
</template>
