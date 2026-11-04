<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import ExcelJS from 'exceljs'
import { Search, Download } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '../utils/api.js'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const loading = ref(false)
const rows = ref([])
const totals = ref({ pagu: 0, spp: 0, sp2d: 0 })
const kategori = ref([]) // [{ key, label, pagu, spp, sp2d }] — untuk filter sumber dana

// Sumber dana yang dianggap bisa diefisiensi (default). Earmarked (DAK) & PAD
// dimatikan karena alokasinya sudah pasti.
const selectedSumberDana = ref(['DAU', 'DAU_DITENTUKAN', 'LKB'])

// Filter
const search = ref('')
const skpdFilter = ref('')
// Daftar kode rekening yang dipilih; kosong berarti semua rekening. Sama seperti
// menu rekening di Dokumen Realisasi: boleh lebih dari satu, tiap kode dipakai
// sebagai AWALAN (5.1.02 ikut mencakup seluruh rinciannya).
const rekeningFilter = ref([])
// Sub kegiatan dipilih lewat kodenya, tapi dicari/ditampilkan lewat namanya.
const subKegiatanFilter = ref([])
const serapanMax = ref(null) // hanya tampilkan serapan <= X %
const sisaMin = ref(null) // hanya tampilkan sisa >= Rp N

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/efisiensi', {
      params: { tahun: tahun.value, sumberDana: selectedSumberDana.value.join(',') },
    })
    rows.value = data.rows || []
    totals.value = data.totals || { pagu: 0, spp: 0, sp2d: 0 }
    if (data.kategori) kategori.value = data.kategori
  } catch {
    rows.value = []
  } finally {
    loading.value = false
  }
}
onMounted(load)

// Ganti pilihan sumber dana -> muat ulang (agregat & serapan dihitung ulang di server).
watch(selectedSumberDana, load)

const skpdOptions = computed(() => {
  const m = new Map()
  for (const r of rows.value) if (!m.has(r.kodeSkpd)) m.set(r.kodeSkpd, r.namaSkpd)
  return Array.from(m, ([kode, nama]) => ({ kode, nama }))
    .sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'))
})

// Pilihan rekening diambil dari rincian seluruh baris, bukan dari jenisnya,
// jadi isinya setara daftar rekening di Dokumen Realisasi.
const rekeningOptions = computed(() => {
  const m = new Map()
  for (const r of rows.value) {
    for (const d of r.details) if (!m.has(d.kodeRekening)) m.set(d.kodeRekening, d.namaRekening)
  }
  return Array.from(m, ([kode, nama]) => ({ kode, nama }))
    .sort((a, b) => String(a.kode).localeCompare(String(b.kode), 'id', { numeric: true }))
})

function cocokRekening(kode) {
  const k = String(kode || '')
  return rekeningFilter.value.some(f => k === f || k.startsWith(f + '.'))
}

const subKegiatanOptions = computed(() => {
  const m = new Map()
  for (const r of rows.value) {
    for (const d of r.details) {
      for (const sub of d.subs || []) if (!m.has(sub.kode)) m.set(sub.kode, sub.nama)
    }
  }
  return Array.from(m, ([kode, nama]) => ({ kode, nama }))
    .sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'))
})

function agregat(daftar) {
  let pagu = 0, spp = 0, sp2d = 0
  for (const d of daftar) { pagu += d.pagu; spp += d.spp; sp2d += d.sp2d }
  return { pagu, spp, sp2d, sisa: pagu - sp2d, serapan: pagu > 0 ? sp2d / pagu : null }
}

// Saat rekening / sub kegiatan disaring, angka baris dihitung ulang dari bagian
// yang cocok saja — supaya pagu/SP2D/sisa yang tampil memang milik pilihan itu,
// bukan seluruh jenis belanjanya. Sub kegiatan dipakai untuk mempersempit tiap
// rincian rekening, karena satu rekening bisa dipakai beberapa sub kegiatan.
function persempit(r, { saringRekening, saringSub }) {
  const details = []
  for (const d of r.details) {
    if (saringRekening && !cocokRekening(d.kodeRekening)) continue
    if (!saringSub) { details.push(d); continue }
    const subs = (d.subs || []).filter(sub => subKegiatanFilter.value.includes(sub.kode))
    if (!subs.length) continue
    details.push({ ...d, subs, ...agregat(subs) })
  }
  if (!details.length) return null
  return { ...r, details, ...agregat(details) }
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const saringRekening = rekeningFilter.value.length > 0
  const saringSub = subKegiatanFilter.value.length > 0
  const hasil = []
  for (const r of rows.value) {
    if (skpdFilter.value && r.kodeSkpd !== skpdFilter.value) continue
    const baris = (saringRekening || saringSub) ? persempit(r, { saringRekening, saringSub }) : r
    if (!baris) continue
    if (serapanMax.value != null && serapanMax.value !== '') {
      const pct = baris.serapan == null ? 0 : baris.serapan * 100
      if (pct > Number(serapanMax.value)) continue
    }
    if (sisaMin.value != null && sisaMin.value !== '') {
      if (baris.sisa < Number(sisaMin.value)) continue
    }
    if (q) {
      const hay = `${baris.namaSkpd} ${baris.namaUnit} ${baris.namaJenis} ${baris.kodeJenis} `
        + baris.details.map(d => `${d.kodeRekening} ${d.namaRekening} `
            + (d.subs || []).map(sub => sub.nama).join(' ')).join(' ')
      if (!hay.toLowerCase().includes(q)) continue
    }
    hasil.push(baris)
  }
  return hasil
})

const filteredTotals = computed(() => {
  const t = { pagu: 0, spp: 0, sp2d: 0, sisa: 0 }
  for (const r of filtered.value) {
    t.pagu += r.pagu; t.spp += r.spp; t.sp2d += r.sp2d; t.sisa += r.sisa
  }
  return t
})

const isFiltering = computed(() =>
  !!(search.value.trim() || skpdFilter.value || rekeningFilter.value.length ||
     subKegiatanFilter.value.length ||
     (serapanMax.value != null && serapanMax.value !== '') ||
     (sisaMin.value != null && sisaMin.value !== '')))

function resetFilter() {
  search.value = ''
  skpdFilter.value = ''
  rekeningFilter.value = []
  subKegiatanFilter.value = []
  serapanMax.value = null
  sisaMin.value = null
}

const totalSisa = computed(() => totals.value.pagu - totals.value.sp2d)
const totalSerapan = computed(() => totals.value.pagu > 0 ? totals.value.sp2d / totals.value.pagu : 0)

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
}
function formatMio(val) {
  const n = Number(val || 0)
  if (Math.abs(n) >= 1e9) return 'Rp' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' M'
  if (Math.abs(n) >= 1e6) return 'Rp' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt'
  return formatRp(n)
}
function pct(v) {
  return v == null ? '—' : (v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%'
}
// Warna serapan: merah rendah -> hijau tinggi. null (pagu 0) dianggap netral.
function serapanColor(v) {
  if (v == null) return '#909399'
  if (v < 0.3) return '#f56c6c'
  if (v < 0.6) return '#e6a23c'
  if (v < 0.85) return '#409eff'
  return '#67c23a'
}
function serapanBarPct(v) {
  if (v == null) return 0
  return Math.max(0, Math.min(100, v * 100))
}

// Sort default el-table: sisa desc.
const defaultSort = { prop: 'sisa', order: 'descending' }

async function exportExcel() {
  if (!filtered.value.length) {
    ElMessage.warning('Tidak ada baris untuk diekspor')
    return
  }
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Efisiensi Belanja')
  ws.columns = [
    { header: 'SKPD', key: 'skpd', width: 32 },
    { header: 'Unit SKPD', key: 'unit', width: 32 },
    { header: 'Kode Jenis', key: 'kodeJenis', width: 12 },
    { header: 'Jenis Belanja', key: 'jenis', width: 34 },
    { header: 'Kode Rekening', key: 'kodeRek', width: 20 },
    { header: 'Rincian Rekening', key: 'namaRek', width: 40 },
    { header: 'Pagu', key: 'pagu', width: 18 },
    { header: 'SPP', key: 'spp', width: 18 },
    { header: 'SP2D', key: 'sp2d', width: 18 },
    { header: 'Sisa (Pagu - SP2D)', key: 'sisa', width: 20 },
    { header: '% Serapan', key: 'serapan', width: 12 },
  ]
  ws.getRow(1).font = { bold: true }
  const numFmt = '#,##0'
  for (const r of filtered.value) {
    ws.addRow({
      skpd: r.namaSkpd, unit: r.namaUnit, kodeJenis: r.kodeJenis, jenis: r.namaJenis,
      kodeRek: '', namaRek: '(total jenis)',
      pagu: r.pagu, spp: r.spp, sp2d: r.sp2d, sisa: r.sisa,
      serapan: r.serapan == null ? null : Math.round(r.serapan * 1000) / 10,
    })
    for (const d of r.details) {
      ws.addRow({
        skpd: r.namaSkpd, unit: r.namaUnit, kodeJenis: r.kodeJenis, jenis: r.namaJenis,
        kodeRek: d.kodeRekening, namaRek: d.namaRekening,
        pagu: d.pagu, spp: d.spp, sp2d: d.sp2d, sisa: d.sisa,
        serapan: d.serapan == null ? null : Math.round(d.serapan * 1000) / 10,
      })
    }
  }
  for (const col of ['pagu', 'spp', 'sp2d', 'sisa']) {
    ws.getColumn(col).numFmt = numFmt
  }
  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `efisiensi-belanja-${tahun.value}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
  ElMessage.success('File diekspor')
}
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Efisiensi Belanja</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #909399;">
        Selisih Anggaran vs Realisasi (SP2D) per Unit SKPD &rarr; Jenis Belanja.
        <strong>Sisa = Pagu &minus; SP2D</strong> &bull; urut sisa terbesar = kandidat efisiensi.
        SP2D diatribusikan ke sumber dana proporsional terhadap porsi pagu.
      </p>
    </div>

    <!-- Kartu ringkasan -->
    <el-card v-loading="loading" style="margin-bottom: 16px;">
      <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;">
        <div>
          <div style="font-size: 12px; color: #67c23a; font-weight: 600;">Total Pagu</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totals.pagu) }}</div>
        </div>
        <div>
          <div style="font-size: 12px; color: #e6a23c; font-weight: 600;">Total SP2D (cair)</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totals.sp2d) }}</div>
        </div>
        <div>
          <div style="font-size: 12px; color: #f56c6c; font-weight: 600;">Total Sisa Anggaran</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totalSisa) }}</div>
        </div>
        <div>
          <div style="font-size: 12px; color: #409eff; font-weight: 600;">Serapan APBD</div>
          <div style="font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 10px;">
            {{ pct(totalSerapan) }}
            <el-progress
              :percentage="serapanBarPct(totalSerapan)"
              :color="serapanColor(totalSerapan)"
              :show-text="false"
              :stroke-width="8"
              style="flex: 1; min-width: 60px;"
            />
          </div>
        </div>
      </div>
    </el-card>

    <!-- Filter sumber dana -->
    <el-card style="margin-bottom: 16px;">
      <div style="display: flex; align-items: baseline; gap: 10px; margin-bottom: 8px; flex-wrap: wrap;">
        <span style="font-size: 13px; font-weight: 600; color: #303133;">Sumber Dana</span>
        <span style="font-size: 11px; color: #909399;">
          hanya dana diskresioner yang bisa diefisiensi — earmarked (DAK: BOS, BOSP, BOP PAUD dll) dimatikan.
        </span>
      </div>
      <el-checkbox-group v-model="selectedSumberDana">
        <el-checkbox
          v-for="k in kategori"
          :key="k.key"
          :value="k.key"
          :label="k.key"
          border
          style="margin: 0 8px 8px 0;"
        >
          <span style="font-weight: 600;">{{ k.label }}</span>
          <span style="color: #909399; font-weight: 400;">&nbsp;· {{ formatMio(k.pagu) }}</span>
        </el-checkbox>
      </el-checkbox-group>
    </el-card>

    <!-- Filter bar -->
    <el-card style="margin-bottom: 16px;">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
        <el-input
          v-model="search"
          placeholder="Cari SKPD / unit / rekening / sub kegiatan..."
          :prefix-icon="Search"
          clearable
          style="max-width: 260px;"
        />
        <el-select v-model="skpdFilter" placeholder="Semua SKPD" clearable filterable style="width: 220px;">
          <el-option v-for="o in skpdOptions" :key="o.kode" :label="o.nama" :value="o.kode" />
        </el-select>
        <el-select
          v-model="rekeningFilter"
          placeholder="Semua rekening"
          multiple collapse-tags collapse-tags-tooltip
          clearable filterable
          :max-collapse-tags="1"
          style="width: 300px;"
        >
          <el-option v-for="o in rekeningOptions" :key="o.kode" :label="`${o.kode} — ${o.nama}`" :value="o.kode" />
        </el-select>
        <el-select
          v-model="subKegiatanFilter"
          placeholder="Semua Sub Kegiatan"
          multiple collapse-tags collapse-tags-tooltip
          clearable filterable
          :max-collapse-tags="1"
          style="width: 300px;"
        >
          <el-option v-for="o in subKegiatanOptions" :key="o.kode" :label="o.nama" :value="o.kode" />
        </el-select>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 12px; color: #606266;">Serapan &le;</span>
          <el-input-number v-model="serapanMax" :min="0" :max="100" :step="5" controls-position="right" style="width: 110px;" />
          <span style="font-size: 12px; color: #606266;">%</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 12px; color: #606266;">Sisa &ge; Rp</span>
          <el-input-number v-model="sisaMin" :min="0" :step="100000000" controls-position="right" style="width: 170px;" />
        </div>
        <el-button v-if="isFiltering" text type="primary" @click="resetFilter">Reset</el-button>
        <el-button :icon="Download" @click="exportExcel" style="margin-left: auto;">Export Excel</el-button>
      </div>
      <div v-if="isFiltering" style="margin-top: 10px; font-size: 12px; color: #909399; display: flex; gap: 18px; flex-wrap: wrap;">
        <span>{{ filtered.length }} baris</span>
        <span>Pagu: <strong>{{ formatMio(filteredTotals.pagu) }}</strong></span>
        <span>SP2D: <strong>{{ formatMio(filteredTotals.sp2d) }}</strong></span>
        <span style="color: #f56c6c;">Sisa: <strong>{{ formatMio(filteredTotals.sisa) }}</strong></span>
      </div>
    </el-card>

    <el-empty
      v-if="!loading && rows.length === 0"
      description="Belum ada data. Pastikan Anggaran Rekap dan Dokumen Realisasi sudah diimport."
      :image-size="120"
    />

    <el-table
      v-else
      v-loading="loading"
      :data="filtered"
      :default-sort="defaultSort"
      row-key="kodeUnit"
      border
      size="small"
      style="width: 100%;"
      :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div style="padding: 8px 16px 12px 48px; background: #fafcff;">
            <div style="font-size: 11px; color: #909399; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px;">
              Rincian per rekening — {{ row.namaJenis }}
            </div>
            <el-table :data="row.details" size="small" style="width: 100%;">
              <el-table-column label="Kode Rekening" width="180">
                <template #default="{ row: d }">
                  <span style="font-family: monospace; font-size: 11px; color: #606266;">{{ d.kodeRekening }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="namaRekening" label="Rincian" min-width="240" show-overflow-tooltip />
              <el-table-column label="Pagu" width="140" align="right">
                <template #default="{ row: d }">{{ formatRp(d.pagu) }}</template>
              </el-table-column>
              <el-table-column label="SP2D" width="140" align="right">
                <template #default="{ row: d }">{{ formatRp(d.sp2d) }}</template>
              </el-table-column>
              <el-table-column label="Sisa" width="140" align="right">
                <template #default="{ row: d }">
                  <span :style="{ color: d.sisa > 0 ? '#f56c6c' : '#909399', fontWeight: d.sisa > 0 ? 600 : 400 }">
                    {{ formatRp(d.sisa) }}
                  </span>
                </template>
              </el-table-column>
              <el-table-column label="Serapan" width="90" align="right">
                <template #default="{ row: d }">
                  <span :style="{ color: serapanColor(d.serapan), fontWeight: 600 }">{{ pct(d.serapan) }}</span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="Unit SKPD" min-width="220" sortable :sort-by="'namaUnit'" show-overflow-tooltip>
        <template #default="{ row }">
          <div style="font-weight: 600; font-size: 13px; color: #303133;">{{ row.namaUnit }}</div>
          <div v-if="row.namaSkpd && row.namaSkpd !== row.namaUnit" style="font-size: 11px; color: #909399;">{{ row.namaSkpd }}</div>
        </template>
      </el-table-column>

      <el-table-column label="Jenis Belanja" min-width="200" sortable :sort-by="'kodeJenis'" show-overflow-tooltip>
        <template #default="{ row }">
          <div style="font-size: 13px; color: #303133;">{{ row.namaJenis }}</div>
          <div style="font-size: 11px; color: #c0c4cc; font-family: monospace;">{{ row.kodeJenis }}</div>
        </template>
      </el-table-column>

      <el-table-column label="Pagu" prop="pagu" width="150" align="right" sortable>
        <template #default="{ row }">
          <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.pagu) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="SP2D" prop="sp2d" width="150" align="right" sortable>
        <template #default="{ row }">
          <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.sp2d) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Sisa (Pagu − SP2D)" prop="sisa" width="160" align="right" sortable>
        <template #default="{ row }">
          <span :style="{ color: row.sisa > 0 ? '#f56c6c' : '#909399', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }">
            {{ formatRp(row.sisa) }}
          </span>
        </template>
      </el-table-column>

      <el-table-column label="% Serapan" width="160" sortable :sort-by="(row) => row.serapan == null ? -1 : row.serapan">
        <template #default="{ row }">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span :style="{ color: serapanColor(row.serapan), fontWeight: 700, minWidth: '46px', fontVariantNumeric: 'tabular-nums' }">
              {{ pct(row.serapan) }}
            </span>
            <el-progress
              :percentage="serapanBarPct(row.serapan)"
              :color="serapanColor(row.serapan)"
              :show-text="false"
              :stroke-width="8"
              style="flex: 1; min-width: 50px;"
            />
          </div>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
