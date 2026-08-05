<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Delete, Search } from '@element-plus/icons-vue'
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
    const { data } = await api.get('/sumber-data/dokumen-aklap', { params: { tahun: tahun.value } })
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
    r.kode_rekening?.toLowerCase().includes(q) ||
    r.kode_sub_skpd?.toLowerCase().includes(q) ||
    r.nama_rekening?.toLowerCase().includes(q) ||
    r.nama_sub_kegiatan?.toLowerCase().includes(q)
  )
})

const paginated = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

watch(search, () => { currentPage.value = 1 })

async function clearData() {
  try {
    await ElMessageBox.confirm(
      'Semua data laporan AKLAP akan dihapus. Lanjutkan?',
      'Konfirmasi Hapus',
      { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
    )
  } catch {
    return
  }
  await api.delete('/sumber-data/dokumen-aklap', { params: { tahun: tahun.value } })
  rawData.value = []
  ElMessage.success('Data berhasil dihapus')
}
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Dokumen AKLAP (LRA Per Program)</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          {{ rawData.length }} baris rekening &bull; Sumber: Extension AKLAP
        </p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
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
      <template #title>Kirim data dari extension AKLAP</template>
      <template #default>
        <p style="margin:8px 0 0; font-size:13px; line-height:1.6;">
          Gunakan <strong>browser extension AKLAP</strong> untuk menarik Laporan Realisasi Anggaran Per Program
          dan kirim JSON apa adanya ke endpoint berikut:
        </p>
        <el-tag type="info" style="margin-top:8px; font-family:monospace; font-size:12px;">
          POST /api/sync/dokumen-aklap
        </el-tag>
        <p style="margin:8px 0 0; font-size:12px; color:#909399;">
          Body: <code>&#123; "tahun": {{ tahun }}, "data": "..." &#125;</code>
          &nbsp;&bull;&nbsp; X-API-Key: &lt;api key&gt;
        </p>
      </template>
    </el-alert>

    <el-empty
      v-if="rawData.length === 0"
      description="Belum ada data. Kirim dari extension AKLAP untuk memulai."
      :image-size="120"
    />

    <template v-else>
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">
        <el-input
          v-model="search"
          placeholder="Cari kode sub skpd / sub kegiatan / rekening..."
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
        <el-table-column label="Nama Rekening" prop="nama_rekening" min-width="220" show-overflow-tooltip />
        <el-table-column label="Nilai Realisasi" prop="nilai_realisasi" width="160" align="right">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:12px; font-variant-numeric:tabular-nums;">
              {{ Number(row.nilai_realisasi || 0).toLocaleString('id-ID') }}
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
