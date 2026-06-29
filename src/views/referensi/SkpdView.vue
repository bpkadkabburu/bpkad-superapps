<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Delete } from '@element-plus/icons-vue'
import { useTahunStore } from '../../stores/tahun'
import { useAuthStore } from '../../stores/auth'
import api from '../../utils/api.js'

const route = useRoute()
const tahunStore = useTahunStore()
const auth = useAuthStore()

const tahun = route.params.tahun
const loading = ref(false)
const skpdList = ref([])
const deleting = ref(false)

onMounted(() => fetchSkpd())

async function fetchSkpd() {
  loading.value = true
  try {
    // Ambil juga info tahun untuk sinkronisasi state skpd_synced_at
    const [skpdRes, taRes] = await Promise.all([
      api.get(`/referensi/skpd?tahun=${tahun}`),
      api.get('/tahun-anggaran'),
    ])
    skpdList.value = skpdRes.data.data
    const taItem = taRes.data.data.find(t => String(t.tahun) === String(tahun))
    if (taItem) tahunStore.setActiveTahun(taItem)
  } catch {
    ElMessage.error('Gagal memuat data SKPD')
  } finally {
    loading.value = false
  }
}

async function resetSkpd() {
  try {
    await ElMessageBox.confirm(
      'Semua data SKPD untuk tahun ini akan dihapus dan status sinkronisasi direset. Lanjutkan?',
      'Reset SKPD',
      { confirmButtonText: 'Ya, Reset', cancelButtonText: 'Batal', type: 'warning' }
    )
  } catch {
    return
  }

  deleting.value = true
  try {
    await api.delete(`/referensi/skpd?tahun=${tahun}`)
    skpdList.value = []
    tahunStore.clearSkpdSync()
    ElMessage.success('Data SKPD berhasil direset')
  } catch {
    ElMessage.error('Gagal mereset data SKPD')
  } finally {
    deleting.value = false
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <div>
        <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">
          Referensi SKPD
        </h2>
        <p style="margin: 4px 0 0; color: #909399; font-size: 13px;">
          Tahun Anggaran {{ tahun }}
        </p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <el-button
          v-if="auth.isSuperadmin && skpdList.length > 0"
          type="danger"
          plain
          size="small"
          :icon="Delete"
          :loading="deleting"
          @click="resetSkpd"
        >
          Reset SKPD
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="!tahunStore.skpdSyncedAt"
      type="warning"
      :closable="false"
      style="margin-bottom: 20px;"
    >
      <template #title>
        SKPD belum disinkronisasi untuk tahun {{ tahun }}
      </template>
      <template #default>
        <p style="margin: 8px 0 0; font-size: 13px; line-height: 1.6;">
          Gunakan <strong>browser extension SIPD</strong> untuk menarik data SKPD dan kirim ke endpoint berikut:
        </p>
        <el-tag type="info" style="margin-top: 8px; font-family: monospace; font-size: 12px;">
          POST /api/referensi/skpd
        </el-tag>
        <p style="margin: 8px 0 0; font-size: 12px; color: #909399;">
          Body: <code>&#123; "tahun": {{ tahun }}, "data": [...] &#125;</code>
          &nbsp;&bull;&nbsp;
          Authorization: Bearer &lt;token&gt;
        </p>
        <p style="margin: 6px 0 0; font-size: 12px; color: #909399;">
          Menu lainnya akan tersedia setelah sinkronisasi berhasil.
        </p>
      </template>
    </el-alert>

    <el-alert
      v-else
      type="success"
      :closable="false"
      style="margin-bottom: 20px;"
    >
      <template #title>
        SKPD tersinkronisasi — {{ skpdList.length }} satuan kerja
      </template>
      <template #default>
        <span style="font-size: 12px; color: #67c23a;">
          Terakhir sync: {{ formatDate(tahunStore.skpdSyncedAt) }}
        </span>
      </template>
    </el-alert>

    <el-card shadow="never" style="border: 1px solid #e4e7ed;">
      <el-table
        v-loading="loading"
        :data="skpdList"
        stripe
        style="width: 100%;"
        empty-text="Belum ada data SKPD"
      >
        <el-table-column prop="kode_skpd" label="Kode SKPD" width="200" />
        <el-table-column prop="nama_skpd" label="Nama SKPD" min-width="250" />
        <el-table-column prop="status" label="Status" width="110">
          <template #default="{ row }">
            <el-tag :type="row.is_skpd ? 'primary' : 'info'" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="nama_kepala" label="Kepala" min-width="200" />
        <el-table-column prop="nip_kepala" label="NIP Kepala" width="160" />
      </el-table>
    </el-card>
  </div>
</template>
