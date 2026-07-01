<script setup>
import { ref, watch, computed } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'

const props = defineProps({
  node: { type: Object, required: true },
  defaultExpanded: { type: Boolean, default: false },
})

const expanded = ref(props.defaultExpanded)

// Bisa di-expand hanya kalau punya anak (Belanja leaf tidak lagi di-expand;
// sumber dananya ditampilkan langsung).
const canExpand = computed(() => props.node.children.length > 0)

// Tampilkan rincian sumber dana LANGSUNG (tanpa expand) di Sub Kegiatan & Belanja.
const showSumberDana = computed(() =>
  (props.node.badge === 'Sub Kegiatan' || props.node.badge === 'Belanja')
  && props.node.sumberDana && props.node.sumberDana.length > 0
)

// Saat filter aktif (defaultExpanded berubah true), buka otomatis supaya
// hasil filter langsung kelihatan tanpa expand manual.
watch(() => props.defaultExpanded, (val) => { expanded.value = val })

const BADGE_TYPE = {
  SKPD: 'primary',
  'Unit SKPD': 'success',
  Urusan: 'warning',
  'Bidang Urusan': 'warning',
  Program: 'info',
  Kegiatan: 'info',
  'Sub Kegiatan': 'danger',
  Belanja: '',
}

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function persenSpp(node) {
  if (!node.totals.pagu) return 0
  return Math.min(Math.round((node.totals.realisasiSpp / node.totals.pagu) * 100 * 100) / 100, 100)
}
</script>

<template>
  <div style="border: 1px solid #e4e7ed; border-radius: 4px; margin-bottom: 10px; background: #fff;">
    <!-- Header: toggle manual (bukan el-collapse) supaya anak lazy-mount -->
    <div
      style="display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; cursor: pointer; user-select: none;"
      @click="canExpand && (expanded = !expanded)"
    >
      <el-icon
        style="flex-shrink: 0; margin-top: 3px;"
        :style="{
          transition: 'transform .2s',
          transform: expanded ? 'rotate(90deg)' : 'none',
          color: canExpand ? '#606266' : '#dcdfe6',
        }"
      >
        <ArrowRight />
      </el-icon>

      <!-- Kolom kiri: identitas node (baris 1) + belum SP2D (baris 2) -->
      <div style="flex: 1; min-width: 0;">
        <!-- Baris 1: badge + nama + kode + bidang -->
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <el-tag :type="BADGE_TYPE[node.badge] || ''" size="small" effect="dark">{{ node.badge }}</el-tag>
          <span style="font-weight: 600; font-size: 13px; color: #303133;">{{ node.nama }}</span>
          <span style="font-size: 11px; color: #909399; font-family: monospace;">Kode: {{ node.kode }}</span>
          <el-tag v-if="node.bidang" type="success" size="small" effect="plain">Bidang: {{ node.bidang }}</el-tag>
        </div>
        <!-- Baris 2: badge belum SP2D (di bawah, tidak tumpang tindih) -->
        <div v-if="(node.belumSp2d || 0) > 0" style="margin-top: 6px;">
          <el-tag type="danger" size="small" effect="plain" style="font-family: monospace;">
            Belum SP2D: {{ formatRp(node.belumSp2d) }}
          </el-tag>
        </div>
      </div>

      <!-- Kolom kanan: ringkasan angka -->
      <div style="flex-shrink: 0; display: flex; gap: 18px; align-items: center; flex-wrap: wrap;">
        <div style="text-align: right;">
          <div style="font-size: 10px; color: #67c23a; font-weight: 600;">Anggaran</div>
          <div style="font-size: 12px; font-weight: 700; color: #303133; font-variant-numeric: tabular-nums;">{{ formatRp(node.totals.pagu) }}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 10px; color: #409eff; font-weight: 600;">Realisasi SPP</div>
          <div style="font-size: 12px; font-weight: 700; color: #303133; font-variant-numeric: tabular-nums;">{{ formatRp(node.totals.realisasiSpp) }}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 10px; color: #e6a23c; font-weight: 600;">Realisasi SP2D</div>
          <div style="font-size: 12px; font-weight: 700; color: #303133; font-variant-numeric: tabular-nums;">{{ formatRp(node.totals.realisasiSp2d) }}</div>
        </div>
        <div style="width: 90px;">
          <div style="font-size: 10px; color: #909399;">{{ persenSpp(node) }}%</div>
          <el-progress :percentage="persenSpp(node)" :stroke-width="6" :show-text="false" />
        </div>
      </div>
    </div>

    <!-- Sumber dana ditampilkan LANGSUNG (tanpa expand) di Sub Kegiatan & Belanja -->
    <div v-if="showSumberDana" style="padding: 6px 12px 10px 40px; border-top: 1px solid #f5f7fa;">
      <div style="font-size: 10px; color: #909399; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px;">
        Anggaran per Sumber Dana
      </div>
      <div
        v-for="sd in node.sumberDana"
        :key="sd.kode"
        style="display: flex; justify-content: space-between; gap: 12px; padding: 2px 0;"
      >
        <span style="font-size: 12px; color: #606266;">{{ sd.nama }} <span style="font-family: monospace; color: #c0c4cc;">({{ sd.kode }})</span></span>
        <span style="font-size: 12px; font-variant-numeric: tabular-nums;">{{ formatRp(sd.pagu) }}</span>
      </div>
    </div>

    <!-- Anak baru di-mount saat expanded = true (lazy). v-if, bukan v-show -->
    <div v-if="expanded && node.children.length" style="padding: 0 12px 8px 28px; border-top: 1px solid #f0f2f5;">
      <RekapRealisasiNode
        v-for="child in node.children"
        :key="child.kode"
        :node="child"
        :default-expanded="defaultExpanded"
      />
    </div>
  </div>
</template>
