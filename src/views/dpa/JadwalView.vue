<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Refresh, Search } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '../../utils/api.js'
import { useTahunStore } from '../../stores/tahun'

// Jadwal DPA kiriman penat-extension (tombol Fetch Jadwal). id_jadwal dan
// id_jadwal_sipd hanya kunci pencocokan dari SIPD, jadi tidak ditampilkan.
// Saklar "Tampil di extension" menyembunyikan jadwal yang gagal / tidak dipakai
// dari pilihan download; sinkron jadwal tidak menimpa setelan ini.

const JENIS = [
  { key: 'persetujuan_depan', label: 'Persetujuan' },
  { key: 'skpd', label: 'DPA SKPD' },
  { key: 'pendapatan', label: 'Pendapatan' },
  { key: 'belanja', label: 'Belanja' },
  { key: 'pembiayaan', label: 'Pembiayaan' },
  { key: 'rincian_belanja', label: 'Rincian Belanja' },
]

const route = useRoute()
const router = useRouter()
const tahunStore = useTahunStore()
const tahun = computed(() => route.params.tahun)

const data = ref([])
const jumlahSkpd = ref(0)
const memuat = ref(false)
const search = ref('')

const tampil = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return data.value
  return data.value.filter(j => j.nama?.toLowerCase().includes(q) || j.tahapan?.toLowerCase().includes(q))
})

const terakhirSinkron = computed(() => {
  const waktuList = data.value.map(j => j.synced_at).filter(Boolean).sort()
  return waktuList.at(-1) || null
})

function waktu(val) {
  if (!val) return ''
  return new Date(val).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

function tipeJumlah(n) {
  if (!n) return 'info'
  return jumlahSkpd.value && n >= jumlahSkpd.value ? 'success' : 'warning'
}

async function muat() {
  memuat.value = true
  try {
    const res = await api.get('/dpa/jadwal', { params: { tahun: tahun.value } })
    data.value = res.data.data
    jumlahSkpd.value = res.data.jumlahSkpd
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Gagal memuat jadwal')
  } finally {
    memuat.value = false
  }
}

const menyimpan = ref(new Set())

async function ubahAktif(j, aktif) {
  menyimpan.value = new Set(menyimpan.value).add(j.id)
  try {
    await api.put(`/dpa/jadwal/${j.id}/aktif`, { aktif })
    j.aktif = aktif
    ElMessage.success(aktif ? 'Jadwal ditampilkan di extension' : 'Jadwal disembunyikan dari extension')
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Gagal mengubah jadwal')
  } finally {
    const sisa = new Set(menyimpan.value)
    sisa.delete(j.id)
    menyimpan.value = sisa
  }
}

function lihatDokumen(j) {
  router.push({ name: 'DpaDokumen', params: { tahun: tahun.value }, query: { jadwal: j.id } })
}

onMounted(muat)
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Jadwal DPA</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          {{ data.length }} jadwal
          <template v-if="terakhirSinkron"> &bull; sinkron terakhir {{ waktu(terakhirSinkron) }}</template>
          &bull; Sumber: penat-extension
        </p>
      </div>
      <el-button :icon="Refresh" :loading="memuat" @click="muat">Muat Ulang</el-button>
    </div>

    <el-empty
      v-if="!memuat && data.length === 0"
      :image-size="120"
      description="Belum ada jadwal. Tekan Fetch Jadwal di penat-extension untuk mengirim jadwal dan Tim TAPD."
    />

    <template v-else>
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; flex-wrap:wrap;">
        <el-input v-model="search" placeholder="Cari nama jadwal / tahapan..." :prefix-icon="Search" clearable style="max-width:360px;" />
        <span style="font-size:12px; color:#909399;">
          Angka = jumlah dinas yang dokumennya sudah terdownload<template v-if="jumlahSkpd"> (dari {{ jumlahSkpd }} SKPD)</template>
        </span>
      </div>

      <el-table
        v-loading="memuat"
        :data="tampil"
        border
        size="small"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
        :row-style="({ row }) => row.aktif ? {} : { opacity: 0.55 }"
      >
        <el-table-column type="index" label="No" width="55" align="center" />
        <el-table-column label="Jadwal" min-width="320">
          <template #default="{ row }">
            <div style="font-size:12px; color:#303133;">
              {{ row.nama || '(belum tersinkron)' }}
              <el-tag v-if="!row.aktif" type="info" size="small" style="margin-left:6px;">nonaktif</el-tag>
            </div>
            <div style="font-size:11px; color:#909399;">{{ row.tahapan }}</div>
          </template>
        </el-table-column>
        <el-table-column label="Tampil di extension" width="130" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.aktif"
              :loading="menyimpan.has(row.id)"
              size="small"
              @change="v => ubahAktif(row, v)"
            />
          </template>
        </el-table-column>
        <el-table-column v-for="j in JENIS" :key="j.key" :label="j.label" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="tipeJumlah(row[j.key])" size="small" disable-transitions>{{ row[j.key] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Sinkron" width="150">
          <template #default="{ row }">
            <span style="font-size:11px; color:#909399;">{{ waktu(row.synced_at) }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="tahunStore.skpdSyncedAt" width="90" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="lihatDokumen(row)">Dokumen</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>
  </div>
</template>
