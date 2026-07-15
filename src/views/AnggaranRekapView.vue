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
    const { data } = await api.get('/sumber-data/anggaran', { params: { tahun: tahun.value } })
    rawData.value = data.data
  } catch {
    rawData.value = []
  }
})

const filtered = computed(() => {
  // Multi-search: beberapa istilah dipisah koma = OR. Baris tampil jika cocok
  // salah satu istilah. mis. "0060, 0059, listrik" -> semua yang cocok muncul.
  const terms = search.value.toLowerCase().split(',').map(t => t.trim()).filter(Boolean)
  if (!terms.length) return rawData.value
  return rawData.value.filter(r => {
    const hay = [
      r.kode_sub_kegiatan, r.nama_sub_kegiatan, r.kode_sub_unit,
      r.kode_rekening, r.nama_rekening, r.paket_kelompok,
      r.nama_paket_kelompok, r.nama_sumber_dana,
    ].join(' ').toLowerCase()
    return terms.some(t => hay.includes(t))
  })
})

const paginated = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

// Ringkasan hanya muncul saat sedang mencari (mis. sub kegiatan tertentu).
const isSearching = computed(() => !!search.value.trim())

const summary = computed(() => {
  if (!isSearching.value) return null
  let total = 0
  const map = new Map()
  for (const r of filtered.value) {
    const pagu = Number(r.pagu || 0)
    total += pagu
    const nama = r.nama_sumber_dana?.trim() || '(Tanpa Sumber Dana)'
    const key = (r.kode_sumber_dana || '') + '||' + nama
    const cur = map.get(key) || { kode: r.kode_sumber_dana, nama, pagu: 0 }
    cur.pagu += pagu
    map.set(key, cur)
  }
  const sumberDana = [...map.values()].sort((a, b) => b.pagu - a.pagu)
  return { total, sumberDana }
})

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID')
}

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
    const kodeRek = getCellText(row.getCell(colMap['KODE REKENING']).value)
    if (!kodeRek) return

    const obj = {}
    Object.entries(colMap).forEach(([header, colNum]) => {
      obj[header] = getCellText(row.getCell(colNum).value)
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
          placeholder="Cari beberapa istilah dipisah koma, mis. 00060, 00059, listrik"
          :prefix-icon="Search"
          clearable
          style="max-width:380px;"
        />
        <span style="font-size:12px; color:#909399;">{{ filtered.length }} baris ditampilkan</span>
      </div>

      <!-- Ringkasan: hanya muncul saat mencari (mis. sub kegiatan tertentu) -->
      <el-card v-if="summary" shadow="never" style="margin-bottom:16px; border:1px solid #e4e7ed;">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="font-size:12px; color:#67c23a; font-weight:600;">Total Anggaran (hasil pencarian)</div>
            <div style="font-size:22px; font-weight:700; font-variant-numeric:tabular-nums;">{{ formatRp(summary.total) }}</div>
          </div>
          <div style="font-size:12px; color:#909399;">{{ summary.sumberDana.length }} sumber dana</div>
        </div>
        <el-divider style="margin:12px 0;" />
        <div style="font-size:11px; color:#909399; font-weight:600; text-transform:uppercase; letter-spacing:.4px; margin-bottom:6px;">
          Per Sumber Dana
        </div>
        <div
          v-for="sd in summary.sumberDana"
          :key="(sd.kode || '') + sd.nama"
          style="display:flex; justify-content:space-between; gap:12px; padding:3px 0; border-bottom:1px dashed #f0f2f5;"
        >
          <span style="font-size:13px; color:#606266;">
            {{ sd.nama }}
            <span v-if="sd.kode" style="font-family:monospace; font-size:11px; color:#c0c4cc;">({{ sd.kode }})</span>
          </span>
          <span style="font-size:13px; font-variant-numeric:tabular-nums;">{{ formatRp(sd.pagu) }}</span>
        </div>
      </el-card>

      <el-table
        :data="paginated"
        border
        stripe
        size="small"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
      >
        <el-table-column type="index" :index="(currentPage - 1) * pageSize + 1" label="No" width="55" align="center" />
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
        <el-table-column label="Nama Paket/Kelompok" prop="nama_paket_kelompok" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.nama_paket_kelompok">{{ row.nama_paket_kelompok }}</span>
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
