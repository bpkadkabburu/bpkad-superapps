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
const totals = ref({ pagu: 0, realisasiSpp: 0, realisasiSp2d: 0 })

const search = ref('')
const belumSp2dOnly = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/rekap-realisasi', { params: { tahun: tahun.value } })
    nodes.value = data.data
    totals.value = data.totals || { pagu: 0, realisasiSpp: 0, realisasiSp2d: 0 }
  } catch {
    nodes.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

// Prune tree rekursif: node ditampilkan bila dirinya cocok filter,
// ATAU ada keturunan yang cocok (jalur induk ikut tampil).
// Search hanya match KODE sub kegiatan secara PENUH/persis
// (mis. "1.01.01.2.05.0001") -> potongan kode tidak memicu render berat.
// belumSp2dOnly: node punya sisa belum cair (belumSp2d > 0)
function filterTree(list) {
  const q = search.value.trim().toLowerCase()
  if (!q && !belumSp2dOnly.value) return list

  const result = []
  for (const node of list) {
    const filteredChildren = filterTree(node.children || [])

    const matchSearch = !q
      || (node.badge === 'Sub Kegiatan' && String(node.kode).toLowerCase() === q)
    const matchBelum = !belumSp2dOnly.value || (node.belumSp2d || 0) > 0

    const selfMatch = matchSearch && matchBelum

    if (selfMatch || filteredChildren.length) {
      result.push({ ...node, children: filteredChildren })
    }
  }
  return result
}

const filteredNodes = computed(() => filterTree(nodes.value))

// Auto-expand HANYA saat search (biar hasil langsung kelihatan).
const autoExpand = computed(() => !!search.value.trim())

const isFiltering = computed(() => !!search.value.trim() || belumSp2dOnly.value)

// Mode flat: saat toggle "belum SP2D" aktif (dan tidak sedang search),
// tampilkan daftar datar semua Sub Kegiatan yang belum SP2D dari semua SKPD,
// tiap baris membawa konteks nama SKPD & Unit SKPD-nya.
const flatMode = computed(() => belumSp2dOnly.value && !search.value.trim())

const flatSubKegiatan = computed(() => {
  if (!flatMode.value) return []
  const out = []
  function walk(list, ctx) {
    for (const node of list) {
      const nextCtx = { ...ctx }
      if (node.badge === 'SKPD') nextCtx.skpd = node.nama
      else if (node.badge === 'Unit SKPD') nextCtx.unitSkpd = node.nama

      if (node.badge === 'Sub Kegiatan') {
        if ((node.belumSp2d || 0) > 0) {
          out.push({ ...node, skpd: nextCtx.skpd, unitSkpd: nextCtx.unitSkpd })
        }
        // node.children (Belanja) tetap terbawa untuk ditampilkan saat expand
      } else {
        walk(node.children || [], nextCtx)
      }
    }
  }
  walk(nodes.value, {})
  return out.sort((a, b) => b.belumSp2d - a.belumSp2d)
})

// State expand per kartu flat (key = skpd||kode sub kegiatan)
const expandedFlat = ref(new Set())
function flatKey(item) {
  return item.skpd + '||' + item.kode
}
function toggleFlat(item) {
  const key = flatKey(item)
  const next = new Set(expandedFlat.value)
  next.has(key) ? next.delete(key) : next.add(key)
  expandedFlat.value = next
}

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Rekap Realisasi</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #909399;">
        Anggaran vs Realisasi (SPP &amp; SP2D) per SKPD &rarr; Unit SKPD &rarr; Urusan &rarr; Bidang Urusan &rarr; Program &rarr; Kegiatan &rarr; Sub Kegiatan &rarr; Belanja
      </p>
    </div>

    <el-card v-loading="loading" style="margin-bottom: 16px;">
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
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
      <span v-if="flatMode" style="font-size: 12px; color: #909399;">
        {{ flatSubKegiatan.length }} sub kegiatan belum SP2D
      </span>
      <span v-else-if="isFiltering" style="font-size: 12px; color: #909399;">
        {{ filteredNodes.length }} SKPD ditampilkan
      </span>
    </div>

    <el-empty
      v-if="!loading && nodes.length === 0"
      description="Belum ada data. Pastikan Anggaran Rekap dan Dokumen Realisasi sudah diimport."
      :image-size="120"
    />

    <!-- Mode flat: daftar sub kegiatan belum SP2D dari semua SKPD -->
    <template v-else-if="flatMode">
      <el-empty
        v-if="flatSubKegiatan.length === 0"
        description="Semua sub kegiatan sudah SP2D. Tidak ada yang tersisa."
        :image-size="120"
      />
      <div
        v-for="item in flatSubKegiatan"
        :key="flatKey(item)"
        style="border: 1px solid #e4e7ed; border-radius: 4px; margin-bottom: 8px; background: #fff;"
      >
        <div
          style="padding: 10px 14px; cursor: pointer; user-select: none;"
          @click="toggleFlat(item)"
        >
          <!-- Baris 1: badge + nama + kode + bidang -->
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <el-icon
              :style="{
                transition: 'transform .2s',
                transform: expandedFlat.has(flatKey(item)) ? 'rotate(90deg)' : 'none',
                color: (item.children && item.children.length) ? '#606266' : '#dcdfe6',
              }"
            >
              <ArrowRight />
            </el-icon>
            <el-tag type="danger" size="small" effect="dark">Sub Kegiatan</el-tag>
            <span style="font-weight: 600; font-size: 13px; color: #303133;">{{ item.nama }}</span>
            <span style="font-size: 11px; color: #909399; font-family: monospace;">{{ item.kode }}</span>
            <el-tag v-if="item.bidang" type="success" size="small" effect="plain">Bidang: {{ item.bidang }}</el-tag>
          </div>
          <!-- Baris 2: konteks SKPD -->
          <div style="font-size: 11px; color: #909399; margin-top: 4px; padding-left: 26px;">
            {{ item.skpd }}<template v-if="item.unitSkpd && item.unitSkpd !== item.skpd"> &rsaquo; {{ item.unitSkpd }}</template>
          </div>
          <!-- Baris 3: angka + belum SP2D -->
          <div style="display: flex; gap: 20px; margin-top: 6px; flex-wrap: wrap; padding-left: 26px; align-items: center;">
            <span style="font-size: 12px;"><span style="color:#67c23a; font-weight:600;">Anggaran</span> {{ formatRp(item.totals.pagu) }}</span>
            <span style="font-size: 12px;"><span style="color:#409eff; font-weight:600;">SPP</span> {{ formatRp(item.totals.realisasiSpp) }}</span>
            <span style="font-size: 12px;"><span style="color:#e6a23c; font-weight:600;">SP2D</span> {{ formatRp(item.totals.realisasiSp2d) }}</span>
            <el-tag type="danger" size="small" effect="plain" style="font-family: monospace;">
              Belum SP2D: {{ formatRp(item.belumSp2d) }}
            </el-tag>
          </div>
          <!-- Total per sumber dana (langsung, tanpa expand) -->
          <div v-if="item.sumberDana && item.sumberDana.length" style="margin-top: 8px; padding-left: 26px;">
            <div style="font-size: 10px; color: #909399; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 3px;">
              Anggaran per Sumber Dana
            </div>
            <div
              v-for="sd in item.sumberDana"
              :key="sd.kode"
              style="display: flex; justify-content: space-between; gap: 12px; max-width: 520px; padding: 1px 0;"
            >
              <span style="font-size: 12px; color: #606266;">{{ sd.nama }} <span style="font-family: monospace; color: #c0c4cc;">({{ sd.kode }})</span></span>
              <span style="font-size: 12px; font-variant-numeric: tabular-nums;">{{ formatRp(sd.pagu) }}</span>
            </div>
          </div>
        </div>

        <!-- Rincian belanja (semua, sudah & belum SP2D) saat di-expand -->
        <div
          v-if="expandedFlat.has(flatKey(item)) && item.children && item.children.length"
          style="border-top: 1px solid #f0f2f5; padding: 6px 14px 10px 40px;"
        >
          <el-table :data="item.children" size="small" style="width: 100%;">
            <el-table-column prop="nama" label="Belanja" min-width="200" show-overflow-tooltip />
            <el-table-column prop="kode" label="Kode Rekening" width="170">
              <template #default="{ row }">
                <span style="font-family: monospace; font-size: 11px; color: #606266;">{{ row.kode }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Anggaran (per Sumber Dana)" min-width="240">
              <template #default="{ row }">
                <div v-if="row.sumberDana && row.sumberDana.length" style="display: flex; flex-direction: column; gap: 2px;">
                  <div v-for="sd in row.sumberDana" :key="sd.kode" style="display: flex; justify-content: space-between; gap: 10px;">
                    <span style="font-size: 11px; color: #606266;">{{ sd.nama }}</span>
                    <span style="font-size: 11px; font-variant-numeric: tabular-nums;">{{ formatRp(sd.pagu) }}</span>
                  </div>
                  <div v-if="row.sumberDana.length > 1" style="display: flex; justify-content: space-between; gap: 10px; border-top: 1px dashed #dcdfe6; padding-top: 2px;">
                    <span style="font-size: 11px; font-weight: 600;">Total</span>
                    <span style="font-size: 11px; font-weight: 600; font-variant-numeric: tabular-nums;">{{ formatRp(row.totals.pagu) }}</span>
                  </div>
                </div>
                <span v-else style="font-variant-numeric: tabular-nums;">{{ formatRp(row.totals.pagu) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="SPP" width="140" align="right">
              <template #default="{ row }">{{ formatRp(row.totals.realisasiSpp) }}</template>
            </el-table-column>
            <el-table-column label="SP2D" width="140" align="right">
              <template #default="{ row }">{{ formatRp(row.totals.realisasiSp2d) }}</template>
            </el-table-column>
            <el-table-column label="Belum SP2D" width="140" align="right">
              <template #default="{ row }">
                <span :style="{ color: (row.belumSp2d || 0) > 0 ? '#f56c6c' : '#909399', fontWeight: (row.belumSp2d || 0) > 0 ? '600' : '400' }">
                  {{ formatRp(row.belumSp2d || 0) }}
                </span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </template>

    <!-- Mode tree biasa -->
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
