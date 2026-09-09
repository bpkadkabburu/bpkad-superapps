<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import api from '../utils/api.js'
import RekapRealisasiNode from '../components/RekapRealisasiNode.vue'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const loading = ref(false)
const nodes = ref([])
const totals = ref({ pagu: 0, realisasiSpp: 0, realisasiSp2d: 0, realisasiAklap: 0 })
// Bagian realisasi yang didapat dari pembagian proporsional, bukan dari
// anggaran yang sumber dananya tunggal.
const estimasi = ref({ pagu: 0, realisasiSpp: 0, realisasiSp2d: 0, realisasiAklap: 0 })

const search = ref('')
const belumSp2dOnly = ref(false)

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/rekap-per-sumber-dana', { params: { tahun: tahun.value } })
    nodes.value = data.data
    totals.value = data.totals || { pagu: 0, realisasiSpp: 0, realisasiSp2d: 0, realisasiAklap: 0 }
    estimasi.value = data.estimasi || { pagu: 0, realisasiSpp: 0, realisasiSp2d: 0, realisasiAklap: 0 }
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
    // Di rekap ini kolom pencarian juga menerima nama/kode sumber dana, karena
    // itulah pintu masuknya — sub kegiatan tetap dicocokkan persis seperti rekap lain.
    const matchSearch = !q
      || (node.badge === 'Sub Kegiatan' && String(node.kode).toLowerCase() === q)
      || (node.badge === 'Sumber Dana' && (
        String(node.kode).toLowerCase().includes(q) || String(node.nama).toLowerCase().includes(q)
      ))
    const matchBelum = !belumSp2dOnly.value || (node.belumSp2d || 0) > 0

    if (matchSearch && matchBelum) {
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

// Auto-expand hanya kalau yang diketik berupa kode (semua segmen angka) — di
// situ hasilnya sedikit. Mencari nama sumber dana dibiarkan tertutup, karena
// satu sumber dana bisa berisi ribuan baris keturunan.
const autoExpand = computed(() => /^[\d.]+$/.test(search.value.trim()) && !!search.value.trim())

const isFiltering = computed(() => !!search.value.trim() || belumSp2dOnly.value)

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const persenEstimasi = computed(() => {
  if (!totals.value.realisasiSpp) return 0
  return Math.round((estimasi.value.realisasiSpp / totals.value.realisasiSpp) * 1000) / 10
})
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Rekap Realisasi Per Sumber Dana</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #909399;">
        Anggaran vs Realisasi (SPP &amp; SP2D) per Sumber Dana &rarr; SKPD &rarr; Unit SKPD &rarr; Urusan &rarr; Bidang Urusan &rarr; Program &rarr; Kegiatan &rarr; Sub Kegiatan &rarr; Belanja
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

    <!-- Dari mana angka realisasi per sumber dana ini datang. Wajib kelihatan:
         SIPD tidak mengirim sumber dana di dokumen realisasi. -->
    <el-alert type="warning" :closable="false" show-icon style="margin-bottom: 16px;">
      <template #title>
        Realisasi diatribusikan lewat anggaran &mdash; dokumen realisasi SIPD tidak menyimpan sumber dana
      </template>
      <div style="font-size: 12px; line-height: 1.6;">
        Tiap SP2D/SPP dicocokkan ke baris anggarannya (SKPD + Unit + Sub Kegiatan + kode rekening).
        Baris yang anggarannya hanya dari satu sumber dana &rarr; realisasinya jatuh utuh ke sumber dana itu.
        Baris yang anggarannya dipecah ke beberapa sumber dana &rarr; realisasinya dibagi
        <b>proporsional terhadap pagu</b> tiap sumber dana, dan bagian itu ditandai
        <el-tag type="warning" size="small" effect="plain">Estimasi pembagian</el-tag> pada barisnya.
        <span v-if="totals.realisasiSpp">
          Untuk TA {{ tahun }}: {{ formatRp(estimasi.realisasiSpp) }} dari {{ formatRp(totals.realisasiSpp) }}
          realisasi SPP ({{ persenEstimasi }}%) adalah hasil pembagian proporsional.
        </span>
      </div>
    </el-alert>

    <!-- Filter bar -->
    <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px; flex-wrap: wrap;">
      <el-input
        v-model="search"
        placeholder="Cari sumber dana (mis. DAU) atau kode sub kegiatan lengkap"
        :prefix-icon="Search"
        clearable
        style="max-width: 400px;"
      />
      <el-switch
        v-model="belumSp2dOnly"
        active-text="Hanya yang belum SP2D"
        inline-prompt
      />
      <span v-if="isFiltering" style="font-size: 12px; color: #909399;">
        {{ filteredNodes.length }} sumber dana ditampilkan
      </span>
      <span v-else style="font-size: 12px; color: #909399;">
        {{ nodes.length }} sumber dana
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
