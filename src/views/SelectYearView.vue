<!-- src/views/SelectYearView.vue -->
<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowRight } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '../stores/auth'
import api from '../utils/api.js'

const router = useRouter()
const auth = useAuthStore()

const tahunList = ref([])
const loading = ref(false)
const showForm = ref(false)
const newTahun = ref('')
const submitting = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    const { data } = await api.get('/tahun-anggaran')
    tahunList.value = data.data
  } catch {
    ElMessage.error('Gagal memuat daftar tahun anggaran')
  } finally {
    loading.value = false
  }
})

function pilihTahun(item) {
  router.push({ name: 'Home', params: { tahun: item.tahun } })
}

async function tambahTahun() {
  if (!newTahun.value || isNaN(Number(newTahun.value))) {
    ElMessage.warning('Masukkan tahun yang valid')
    return
  }
  submitting.value = true
  try {
    const { data } = await api.post('/tahun-anggaran', { tahun: Number(newTahun.value) })
    tahunList.value.unshift(data)
    newTahun.value = ''
    showForm.value = false
    ElMessage.success(`Tahun ${data.tahun} berhasil ditambahkan`)
  } catch (err) {
    const msg = err.response?.status === 409
      ? 'Tahun sudah ada'
      : 'Gagal menambahkan tahun'
    ElMessage.error(msg)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div style="max-width: 600px; margin: 60px auto; padding: 0 16px;">
    <div style="text-align: center; margin-bottom: 32px;">
      <h2 style="font-size: 22px; font-weight: 700; color: #303133; margin: 0 0 8px;">
        Pilih Tahun Anggaran
      </h2>
      <p style="color: #909399; margin: 0;">Pilih tahun anggaran untuk mulai bekerja</p>
    </div>

    <div v-loading="loading">
      <el-empty v-if="!loading && tahunList.length === 0" description="Belum ada tahun anggaran" />

      <div
        v-for="item in tahunList"
        :key="item.id"
        @click="pilihTahun(item)"
        style="
          background: #fff;
          border: 1px solid #e4e7ed;
          border-radius: 8px;
          padding: 20px 24px;
          margin-bottom: 12px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          transition: border-color 0.2s, box-shadow 0.2s;
        "
        @mouseenter="$event.currentTarget.style.borderColor = '#409eff'"
        @mouseleave="$event.currentTarget.style.borderColor = '#e4e7ed'"
      >
        <span style="font-size: 20px; font-weight: 600; color: #303133;">
          Tahun {{ item.tahun }}
        </span>
        <el-icon style="color: #909399;"><ArrowRight /></el-icon>
      </div>

      <div v-if="auth.isSuperadmin" style="margin-top: 20px;">
        <el-button
          v-if="!showForm"
          type="primary"
          plain
          style="width: 100%;"
          @click="showForm = true"
        >
          + Tambah Tahun Anggaran
        </el-button>

        <el-card v-else shadow="never" style="border: 1px dashed #409eff;">
          <p style="margin: 0 0 12px; font-weight: 500;">Tambah Tahun Anggaran</p>
          <div style="display: flex; gap: 8px;">
            <el-input
              v-model="newTahun"
              placeholder="contoh: 2026"
              type="number"
              @keyup.enter="tambahTahun"
            />
            <el-button type="primary" :loading="submitting" @click="tambahTahun">Simpan</el-button>
            <el-button @click="showForm = false; newTahun = ''">Batal</el-button>
          </div>
        </el-card>
      </div>
    </div>
  </div>
</template>
