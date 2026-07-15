<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { PieChart } from '@element-plus/icons-vue'
import api from '../utils/api.js'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const loading = ref(false)
const rows = ref([])
const total = ref(0)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/sumber-data/anggaran/rekap-sumber-dana', {
      params: { tahun: tahun.value }
    })
    rows.value = data.data || []
    total.value = data.total || 0
  } catch {
    rows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

onMounted(load)

function pct(pagu) {
  if (!total.value) return 0
  return (Number(pagu || 0) / total.value) * 100
}

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID')
}

// Ringkas ke satuan miliar untuk baca cepat (mis. "120,45 M")
function formatMiliar(val) {
  const m = Number(val || 0) / 1_000_000_000
  return m.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' M'
}
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Rekap Anggaran per Sumber Dana</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #909399;">
        Total pagu anggaran dikelompokkan per sumber dana &bull; Sumber: Anggaran Rekap
      </p>
    </div>

    <el-card v-loading="loading" style="margin-bottom: 16px;">
      <div style="display: flex; align-items: center; gap: 14px;">
        <el-icon :size="28" style="color: #67c23a;"><PieChart /></el-icon>
        <div>
          <div style="font-size: 12px; color: #67c23a; font-weight: 600;">Total Pagu Anggaran</div>
          <div style="font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums;">
            {{ formatRp(total) }}
            <span style="font-size: 13px; font-weight: 500; color: #909399;">({{ formatMiliar(total) }})</span>
          </div>
        </div>
        <div style="margin-left: auto; text-align: right;">
          <div style="font-size: 12px; color: #909399;">Jumlah Sumber Dana</div>
          <div style="font-size: 22px; font-weight: 700;">{{ rows.length }}</div>
        </div>
      </div>
    </el-card>

    <el-empty
      v-if="!loading && rows.length === 0"
      description="Belum ada data. Import file Anggaran Rekap terlebih dahulu."
      :image-size="120"
    />

    <el-table
      v-else
      v-loading="loading"
      :data="rows"
      border
      stripe
      size="small"
      style="width: 100%;"
      :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
    >
      <el-table-column type="index" label="No" width="55" align="center" />
      <el-table-column label="Sumber Dana" prop="nama" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <span style="font-weight: 600; color: #303133;">{{ row.nama }}</span>
          <span v-if="row.kode" style="font-family: monospace; font-size: 11px; color: #c0c4cc; margin-left: 6px;">{{ row.kode }}</span>
        </template>
      </el-table-column>
      <el-table-column label="Proporsi" min-width="200">
        <template #default="{ row }">
          <div style="display: flex; align-items: center; gap: 10px;">
            <el-progress
              :percentage="pct(row.pagu)"
              :stroke-width="10"
              :show-text="false"
              color="#67c23a"
              style="flex: 1;"
            />
            <span style="font-size: 12px; color: #606266; font-variant-numeric: tabular-nums; min-width: 48px; text-align: right;">
              {{ pct(row.pagu).toFixed(1) }}%
            </span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="Pagu" prop="pagu" width="190" align="right">
        <template #default="{ row }">
          <div style="font-family: monospace; font-size: 12px; font-variant-numeric: tabular-nums;">{{ formatRp(row.pagu) }}</div>
          <div style="font-size: 11px; color: #909399;">{{ formatMiliar(row.pagu) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="Baris" prop="jumlah_baris" width="90" align="right">
        <template #default="{ row }">
          <span style="font-size: 12px; color: #909399;">{{ Number(row.jumlah_baris).toLocaleString('id-ID') }}</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
