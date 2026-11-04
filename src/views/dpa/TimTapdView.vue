<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Refresh } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '../../utils/api.js'

// Tim TAPD (penandatangan DPA) kiriman penat-extension, ikut terkirim saat
// Fetch Jadwal. Sinkron mengganti seluruh tim untuk tahun ini sekaligus.

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const data = ref([])
const memuat = ref(false)

const syncedAt = computed(() => data.value[0]?.synced_at || null)

function waktu(val) {
  if (!val) return ''
  return new Date(val).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

async function muat() {
  memuat.value = true
  try {
    const res = await api.get('/dpa/tim-tapd', { params: { tahun: tahun.value } })
    data.value = res.data.data
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Gagal memuat Tim TAPD')
  } finally {
    memuat.value = false
  }
}

onMounted(muat)
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Tim TAPD</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          {{ data.length }} anggota
          <template v-if="syncedAt"> &bull; sinkron {{ waktu(syncedAt) }}</template>
          &bull; Sumber: penat-extension
        </p>
      </div>
      <el-button :icon="Refresh" :loading="memuat" @click="muat">Muat Ulang</el-button>
    </div>

    <el-empty
      v-if="!memuat && data.length === 0"
      :image-size="120"
      description="Belum ada data Tim TAPD. Tekan Fetch Jadwal di penat-extension untuk mengirim jadwal dan Tim TAPD."
    />

    <el-table
      v-else
      v-loading="memuat"
      :data="data"
      border
      stripe
      size="small"
      style="width:100%;"
      :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
    >
      <el-table-column label="No" prop="no_urut" width="60" align="center" />
      <el-table-column label="Nama" prop="nama" min-width="240" />
      <el-table-column label="NIP" prop="nip" width="190">
        <template #default="{ row }">
          <span style="font-family:monospace; font-size:12px;">{{ row.nip }}</span>
        </template>
      </el-table-column>
      <el-table-column label="Jabatan" prop="jabatan" min-width="320" />
    </el-table>
  </div>
</template>
