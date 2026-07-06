<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import api from '../utils/api.js'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const loading = ref(false)
const rows = ref([])
const onlyMismatch = ref(true)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/rekap-realisasi/validasi-subkegiatan', { params: { tahun: tahun.value } })
    rows.value = data.data || []
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

const mismatchCount = computed(() => rows.value.filter(r => r.rekap !== r.referensi).length)

const filteredRows = computed(() => {
  if (!onlyMismatch.value) return rows.value
  return rows.value.filter(r => r.rekap !== r.referensi)
})
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Validasi Sub Kegiatan</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #909399;">
        Membandingkan Sub Kegiatan pada Rekap (Anggaran Rekap &amp; Dokumen Realisasi) dengan Referensi/Sub Kegiatan, per SKPD.
      </p>
    </div>

    <el-card v-loading="loading" style="margin-bottom: 16px;">
      <div style="display: flex; align-items: center; gap: 24px; flex-wrap: wrap;">
        <div>
          <div style="font-size: 12px; color: #909399; font-weight: 600;">Total SKPD</div>
          <div style="font-size: 20px; font-weight: 700;">{{ rows.length }}</div>
        </div>
        <div>
          <div style="font-size: 12px; font-weight: 600;" :style="{ color: mismatchCount ? '#f56c6c' : '#67c23a' }">SKPD Tidak Sesuai</div>
          <div style="font-size: 20px; font-weight: 700;" :style="{ color: mismatchCount ? '#f56c6c' : '#67c23a' }">{{ mismatchCount }}</div>
        </div>
        <el-switch
          v-model="onlyMismatch"
          active-text="Hanya yang tidak sesuai"
          inline-prompt
          style="margin-left: auto;"
        />
      </div>
    </el-card>

    <el-empty
      v-if="!loading && filteredRows.length === 0"
      :description="onlyMismatch && rows.length ? 'Semua SKPD sudah sesuai.' : 'Belum ada data untuk dibandingkan.'"
      :image-size="120"
    />

    <el-table
      v-else
      :data="filteredRows"
      row-key="kode_skpd"
      size="small"
      style="width: 100%;"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div style="padding: 8px 20px 16px 50px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div>
              <div style="font-size: 12px; font-weight: 600; color: #f56c6c; margin-bottom: 6px;">
                Ada di Referensi, tidak ada di Rekap ({{ row.hilangDiRekap.length }})
              </div>
              <div v-if="row.hilangDiRekap.length === 0" style="font-size: 12px; color: #c0c4cc;">-</div>
              <div
                v-for="item in row.hilangDiRekap"
                :key="item.kode"
                style="font-size: 12px; padding: 3px 0; border-bottom: 1px dashed #f0f2f5;"
              >
                <span style="font-family: monospace; color: #909399;">{{ item.kode }}</span>
                <span style="margin-left: 8px;">{{ item.nama }}</span>
              </div>
            </div>
            <div>
              <div style="font-size: 12px; font-weight: 600; color: #e6a23c; margin-bottom: 6px;">
                Ada di Rekap, tidak ada di Referensi ({{ row.hilangDiReferensi.length }})
              </div>
              <div v-if="row.hilangDiReferensi.length === 0" style="font-size: 12px; color: #c0c4cc;">-</div>
              <div
                v-for="item in row.hilangDiReferensi"
                :key="item.kode"
                style="font-size: 12px; padding: 3px 0; border-bottom: 1px dashed #f0f2f5;"
              >
                <span style="font-family: monospace; color: #909399;">{{ item.kode }}</span>
                <span style="margin-left: 8px;">{{ item.nama }}</span>
              </div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="kode_skpd" label="Kode SKPD" width="110" />
      <el-table-column prop="nama_skpd" label="SKPD" min-width="240" show-overflow-tooltip />
      <el-table-column label="Rekap / Referensi" width="150" align="center">
        <template #default="{ row }">
          <span :style="{ fontWeight: 600, color: row.rekap !== row.referensi ? '#f56c6c' : '#67c23a' }">
            {{ row.rekap }}/{{ row.referensi }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="Status" width="120" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.rekap === row.referensi" type="success" size="small" effect="plain">Sesuai</el-tag>
          <el-tag v-else type="danger" size="small" effect="plain">Beda {{ Math.abs(row.rekap - row.referensi) }}</el-tag>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
