<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Delete, CopyDocument, ArrowLeft } from '@element-plus/icons-vue'
import { useTahunStore } from '../stores/tahun'
import api from '../utils/api.js'

const router = useRouter()
const tahunStore = useTahunStore()

const loading = ref(false)
const keys = ref([])
const revokingId = ref(null)

const createDialogVisible = ref(false)
const creating = ref(false)
const newKeyName = ref('')

const revealDialogVisible = ref(false)
const revealedKey = ref('')

onMounted(() => fetchKeys())

async function fetchKeys() {
  loading.value = true
  try {
    const { data } = await api.get('/api-keys')
    keys.value = data.data
  } catch {
    ElMessage.error('Gagal memuat daftar API key')
  } finally {
    loading.value = false
  }
}

function openCreateDialog() {
  newKeyName.value = ''
  createDialogVisible.value = true
}

async function submitCreate() {
  if (!newKeyName.value.trim()) {
    ElMessage.warning('Nama diperlukan')
    return
  }
  creating.value = true
  try {
    const { data } = await api.post('/api-keys', { name: newKeyName.value.trim() })
    createDialogVisible.value = false
    revealedKey.value = data.key
    revealDialogVisible.value = true
    await fetchKeys()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Gagal membuat API key')
  } finally {
    creating.value = false
  }
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(revealedKey.value)
    ElMessage.success('Key disalin ke clipboard')
  } catch {
    ElMessage.error('Gagal menyalin, salin manual')
  }
}

function closeRevealDialog() {
  revealDialogVisible.value = false
  revealedKey.value = ''
}

async function revokeKey(row) {
  try {
    await ElMessageBox.confirm(
      `API key "${row.name}" akan dicabut dan tidak bisa dipakai lagi. Lanjutkan?`,
      'Cabut API Key',
      { type: 'warning', confirmButtonText: 'Ya, Cabut', cancelButtonText: 'Batal' }
    )
  } catch {
    return
  }

  revokingId.value = row.id
  try {
    await api.delete(`/api-keys/${row.id}`)
    ElMessage.success('API key berhasil dicabut')
    await fetchKeys()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Gagal mencabut API key')
  } finally {
    revokingId.value = null
  }
}

function goBack() {
  if (tahunStore.activeTahun && tahunStore.skpdSyncedAt) {
    router.push({ name: 'Home', params: { tahun: tahunStore.activeTahun } })
  } else {
    router.push({ name: 'SelectYear' })
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
    <el-button :icon="ArrowLeft" text @click="goBack" style="margin-bottom: 12px;">
      Kembali
    </el-button>

    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <div>
        <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">
          Kelola API Key
        </h2>
        <p style="margin: 4px 0 0; color: #909399; font-size: 13px;">
          Dipakai oleh browser extension untuk sinkronisasi data — tidak terikat tahun anggaran
        </p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreateDialog">
        Buat API Key
      </el-button>
    </div>

    <el-card shadow="never" style="border: 1px solid #e4e7ed;">
      <el-table
        v-loading="loading"
        :data="keys"
        stripe
        style="width: 100%;"
        empty-text="Belum ada API key"
      >
        <el-table-column prop="name" label="Nama" min-width="160" />
        <el-table-column label="Prefix" width="200">
          <template #default="{ row }">
            <span style="font-family: monospace; font-size: 12px;">{{ row.key_prefix }}...</span>
          </template>
        </el-table-column>
        <el-table-column label="Status" width="110">
          <template #default="{ row }">
            <el-tag :type="row.revoked_at ? 'info' : 'success'" size="small">
              {{ row.revoked_at ? 'Dicabut' : 'Aktif' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Terakhir Dipakai" width="180">
          <template #default="{ row }">{{ formatDate(row.last_used_at) }}</template>
        </el-table-column>
        <el-table-column label="Dibuat" width="180">
          <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="Aksi" width="110" align="center">
          <template #default="{ row }">
            <el-button
              type="danger"
              plain
              size="small"
              :icon="Delete"
              :disabled="!!row.revoked_at"
              :loading="revokingId === row.id"
              @click="revokeKey(row)"
            >
              Cabut
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="createDialogVisible" title="Buat API Key Baru" width="420px">
      <el-form @submit.prevent="submitCreate">
        <el-form-item label="Nama">
          <el-input
            v-model="newKeyName"
            placeholder="mis. Browser Extension - Kantor"
            @keyup.enter="submitCreate"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">Batal</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">Buat</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="revealDialogVisible"
      title="API Key Berhasil Dibuat"
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <el-alert
        type="warning"
        :closable="false"
        title="Simpan key ini sekarang — tidak akan ditampilkan lagi setelah dialog ini ditutup."
        style="margin-bottom: 16px;"
      />
      <div style="display: flex; gap: 8px;">
        <el-input :model-value="revealedKey" readonly style="font-family: monospace;" />
        <el-button :icon="CopyDocument" @click="copyKey">Salin</el-button>
      </div>
      <template #footer>
        <el-button type="primary" @click="closeRevealDialog">Selesai</el-button>
      </template>
    </el-dialog>
  </div>
</template>
