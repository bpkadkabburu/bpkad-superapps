<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Search, ArrowRight } from '@element-plus/icons-vue'
import api from '../utils/api.js'
import RekapRealisasiNode from '../components/RekapRealisasiNode.vue'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const loading = ref(false)
const nodes = ref([])
const totals = ref({ pagu: 0, realisasiSpp: 0, realisasiSp2d: 0, realisasiAklap: 0 })

const search = ref('')
const belumSp2dOnly = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/rekap-per-urusan', { params: { tahun: tahun.value } })
    nodes.value = data.data
    totals.value = data.totals || { pagu: 0, realisasiSpp: 0, realisasiSp2d: 0, realisasiAklap: 0 }
  } catch {
    nodes.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

function filterTree(list) {
  const q = search.value.trim().toLowerCase()
  if (!q && !belumSp2dOnly.value) return list

  const result = []
  for (const node of list) {
    const matchSearch = !q
      || (node.badge === 'Sub Kegiatan' && String(node.kode).toLowerCase() === q)
    const matchBelum = !belumSp2dOnly.value || (node.belumSp2d || 0) > 0

    const selfMatch = matchSearch && matchBelum

    if (selfMatch) {
      result.push({ ...node })
      continue
    }

    const filteredChildren = filterTree(node.children || [])
    if (filteredChildren.length) {
      result.push({ ...node, children: filteredChildren })
    }
  }
  return result
}

const filteredNodes = computed(() => filterTree(nodes.value))

const autoExpand = computed(() => !!search.value.trim())

const isFiltering = computed(() => !!search.value.trim() || belumSp2dOnly.value)

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Rekap Realisasi Per Urusan</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #909399;">
        Anggaran vs Realisasi (SPP &amp; SP2D) per Urusan &rarr; Bidang Urusan &rarr; SKPD &rarr; Unit SKPD &rarr; Program &rarr; Kegiatan &rarr; Sub Kegiatan &rarr; Belanja
      </p>
    </div>

    <el-card v-loading="loading" style="margin-bottom: 16px;">
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;">
        <div>
          <div style="font-size: 12px; color: #67c23a; font-weight: 600;">Total Anggaran</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatRp(totals.pagu) }}</div>
        </div>
        <div>
          <div style="font-size: 12px; color: #409eff; font-weight: 600;">Total Realisasi SPP</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatRp(totals.realisasiSpp) }}</div>
        </div>
        <div>
          <div style="font-size: 12px; color: #e6a23c; font-weight: 600;">Total Realisasi SP2D</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatRp(totals.realisasiSp2d) }}</div>
        </div>
        <div>
          <div style="font-size: 12px; color: #9254de; font-weight: 600;">Total Realisasi AKLAP</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatRp(totals.realisasiAklap) }}</div>
        </div>
      </div>
    </el-card>

    <!-- Filter bar -->
    <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px; flex-wrap: wrap;">
      <el-input
        v-model="search"
        placeholder="Masukkan kode sub kegiatan lengkap (mis. 1.01.01.2.05.0001)"
        :prefix-icon="Search"
        clearable
        style="max-width: 360px;"
      />
      <el-switch
        v-model="belumSp2dOnly"
        active-text="Hanya yang belum SP2D"
        inline-prompt
      />
      <span v-if="isFiltering" style="font-size: 12px; color: #909399;">
        {{ filteredNodes.length }} urusan ditampilkan
      </span>
    </div>

    <el-empty
      v-if="!loading && nodes.length === 0"
      description="Belum ada data. Pastikan Anggaran Rekap dan Dokumen Realisasi sudah diimport."
      :image-size="120"
    />

    <template v-else>
      <el-empty
        v-if="filteredNodes.length === 0"
        description="Tidak ada hasil yang cocok dengan filter."
        :image-size="120"
      />
      <RekapRealisasiNode
        v-for="node in filteredNodes"
        :key="node.kode"
        :node="node"
        :default-expanded="autoExpand"
      />
    </template>
  </div>
</template>
