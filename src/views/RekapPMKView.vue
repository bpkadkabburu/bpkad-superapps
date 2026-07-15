<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import ExcelJS from 'exceljs'
import { ElMessage } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import api from '../utils/api.js'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const loading = ref(false)
const results = ref([])
const openBidang = ref([])
// Kata kunci pencarian per bidang: { [namaBidang]: string }
const searchByBidang = reactive({})

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/mapping-pmk', { params: { tahun: tahun.value } })
    results.value = data.results || []
    // Buka semua bidang secara default
    openBidang.value = [...new Set(results.value.map(r => bidangName(r)))]
  } catch {
    results.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

function bidangName(row) {
  return (row.bidang && row.bidang !== '-') ? row.bidang : 'Tidak Terpetakan'
}

// Kelompokkan seluruh baris per bidang (tanpa filter).
const rowsByBidang = computed(() => {
  const map = new Map()
  for (const row of results.value) {
    const b = bidangName(row)
    if (!map.has(b)) map.set(b, [])
    map.get(b).push(row)
  }
  return map
})

// Satu kartu per bidang. Sebaran, breakdown, & total memakai data penuh bidang.
const bidangCards = computed(() => {
  const cards = []
  for (const [bidang, allRows] of rowsByBidang.value) {
    const perSD = new Map()
    const perOPDSD = new Map()
    let total = 0
    for (const row of allRows) {
      total += row.paguIndikatif

      const sdKey = row.kodeSumberDana
      if (!perSD.has(sdKey)) {
        perSD.set(sdKey, { kodeSumberDana: row.kodeSumberDana, sumberDana: row.sumberDana, totalPagu: 0 })
      }
      perSD.get(sdKey).totalPagu += row.paguIndikatif

      const opdSDKey = `${row.namaOPD}||${row.kodeSumberDana}`
      if (!perOPDSD.has(opdSDKey)) {
        perOPDSD.set(opdSDKey, { namaOPD: row.namaOPD, kodeSumberDana: row.kodeSumberDana, sumberDana: row.sumberDana, totalPagu: 0 })
      }
      perOPDSD.get(opdSDKey).totalPagu += row.paguIndikatif
    }

    cards.push({
      bidang,
      total,
      allRows,
      allCount: allRows.length,
      perSDList: Array.from(perSD.values()).sort((a, b) => b.totalPagu - a.totalPagu),
      perOPDSDList: Array.from(perOPDSD.values()).sort((a, b) => {
        const opdCmp = a.namaOPD.localeCompare(b.namaOPD, 'id')
        return opdCmp !== 0 ? opdCmp : b.totalPagu - a.totalPagu
      }),
    })
  }
  return cards.sort((a, b) => a.bidang.localeCompare(b.bidang, 'id'))
})

// Pencarian hanya menyaring tabel Detail per Subkegiatan pada bidang bersangkutan.
function isSearching(info) {
  return !!(searchByBidang[info.bidang] || '').trim()
}
function detailRows(info) {
  const q = (searchByBidang[info.bidang] || '').trim().toLowerCase()
  if (!q) return info.allRows
  return info.allRows.filter(r =>
    r.kode?.toLowerCase().includes(q) ||
    r.subKegiatan?.toLowerCase().includes(q)
  )
}

const grandTotal = computed(() => results.value.reduce((s, r) => s + r.paguIndikatif, 0))

function formatRp(val) {
  if (!val || isNaN(Number(val))) return 'Rp 0'
  return 'Rp ' + Number(val).toLocaleString('id-ID')
}

async function exportExcelBidang(info) {
  const rows = info.allRows || []
  if (!rows.length) {
    ElMessage.warning('Tidak ada data untuk diekspor')
    return
  }
  loading.value = true
  try {
    const workbook = new ExcelJS.Workbook()
    const headerStyle = (row) => {
      row.font = { bold: true, name: 'Calibri', size: 9 }
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
    }

    // Sheet 1: Sebaran per Sumber Dana
    const sheetSD = workbook.addWorksheet('SEBARAN SUMBER DANA')
    sheetSD.columns = [
      { header: 'Kode Sumber Dana', key: 'kodeSumberDana', width: 22 },
      { header: 'Sumber Dana', key: 'sumberDana', width: 35 },
      { header: 'Total Pagu (Rp)', key: 'totalPagu', width: 22 },
    ]
    headerStyle(sheetSD.getRow(1))
    for (const row of info.perSDList) {
      const r = sheetSD.addRow(row)
      r.font = { name: 'Calibri', size: 9 }
      r.getCell('totalPagu').numFmt = '#,##0'
    }

    // Sheet 2: Breakdown per OPD per SD
    const sheetBreakdown = workbook.addWorksheet('BREAKDOWN OPD')
    sheetBreakdown.columns = [
      { header: 'Nama OPD', key: 'namaOPD', width: 32 },
      { header: 'Kode Sumber Dana', key: 'kodeSumberDana', width: 22 },
      { header: 'Sumber Dana', key: 'sumberDana', width: 35 },
      { header: 'Total Pagu (Rp)', key: 'totalPagu', width: 22 },
    ]
    headerStyle(sheetBreakdown.getRow(1))
    for (const row of info.perOPDSDList) {
      const r = sheetBreakdown.addRow(row)
      r.font = { name: 'Calibri', size: 9 }
      r.getCell('totalPagu').numFmt = '#,##0'
    }

    // Sheet 3: Detail per Subkegiatan
    const sheetDetail = workbook.addWorksheet('DETAIL SUBKEGIATAN')
    sheetDetail.columns = [
      { header: 'Nama OPD', key: 'namaOPD', width: 32 },
      { header: 'Kode', key: 'kode', width: 20 },
      { header: 'Sub Kegiatan', key: 'subKegiatan', width: 45 },
      { header: 'Kode Sumber Dana', key: 'kodeSumberDana', width: 22 },
      { header: 'Sumber Dana', key: 'sumberDana', width: 35 },
      { header: 'Pagu (Rp)', key: 'paguIndikatif', width: 22 },
      { header: 'Bidang', key: 'bidang', width: 25 },
    ]
    headerStyle(sheetDetail.getRow(1))
    for (const item of rows) {
      const r = sheetDetail.addRow(item)
      r.font = { name: 'Calibri', size: 9 }
      r.getCell('paguIndikatif').numFmt = '#,##0'
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `REKAP PMK ${tahun.value} - Bidang ${info.bidang}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    ElMessage.success(`Bidang ${info.bidang} berhasil diekspor (3 sheet)`)
  } catch (err) {
    ElMessage.error('Gagal ekspor: ' + err.message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-loading="loading">
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Rekap PMK</h2>
      <p style="margin: 4px 0 0; color: #909399; font-size: 13px;">
        Kompilasi pagu per bidang PMK &bull; sumber: Referensi Subkegiatan PMK &times; Anggaran Rekap
      </p>
    </div>

    <el-card v-if="results.length" shadow="never" style="margin-bottom: 16px; border: 1px solid #e4e7ed;">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
        <div>
          <div style="font-size: 12px; color: #67c23a; font-weight: 600;">Total Pagu Belanja (masuk PMK)</div>
          <div style="font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums;">{{ formatRp(grandTotal) }}</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 12px; color: #909399;">Jumlah Bidang</div>
          <div style="font-size: 22px; font-weight: 700;">{{ bidangCards.length }}</div>
        </div>
      </div>
    </el-card>

    <el-empty
      v-if="!loading && !results.length"
      description="Belum ada data. Pastikan Referensi Subkegiatan PMK dan Anggaran Rekap sudah diisi untuk tahun ini."
      :image-size="120"
    />

    <el-collapse v-else v-model="openBidang" style="border: none; background: transparent;">
      <div
        v-for="info in bidangCards"
        :key="info.bidang"
        style="margin-bottom: 16px; border: 1px solid #e4e7ed; border-radius: 4px; overflow: hidden; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.06);"
      >
        <el-collapse-item :name="info.bidang" style="border: none;">
          <template #title>
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding-right: 12px;">
              <span style="font-size: 15px; font-weight: 700; color: #303133;">
                Bidang {{ info.bidang }}
                <span style="font-size: 13px; font-weight: 500; color: #909399; margin-left: 8px;">{{ formatRp(info.total) }}</span>
              </span>
              <div @click.stop>
                <el-button type="success" size="small" :loading="loading" @click.stop="exportExcelBidang(info)">
                  Export Excel
                </el-button>
              </div>
            </div>
          </template>

          <div style="padding: 0 16px 16px;">
            <!-- Sebaran per Sumber Dana -->
            <div style="margin-bottom: 12px;">
              <div style="font-size: 11px; font-weight: 600; margin-bottom: 5px; color: #606266; text-transform: uppercase; letter-spacing: 0.5px;">Sebaran per Sumber Dana</div>
              <el-table :data="info.perSDList" size="small" border max-height="220" style="width: 100%;">
                <el-table-column prop="kodeSumberDana" label="Kode SD" width="165" show-overflow-tooltip />
                <el-table-column prop="sumberDana" label="Sumber Dana" min-width="200" show-overflow-tooltip />
                <el-table-column label="Pagu (Rp)" width="180" align="right">
                  <template #default="{ row }">{{ formatRp(row.totalPagu) }}</template>
                </el-table-column>
              </el-table>
            </div>

            <!-- Breakdown per OPD per SD -->
            <div style="margin-bottom: 12px;">
              <div style="font-size: 11px; font-weight: 600; margin-bottom: 5px; color: #606266; text-transform: uppercase; letter-spacing: 0.5px;">Breakdown per OPD per Sumber Dana</div>
              <el-table :data="info.perOPDSDList" size="small" border max-height="220" style="width: 100%;">
                <el-table-column prop="namaOPD" label="Nama OPD" min-width="200" show-overflow-tooltip fixed="left" />
                <el-table-column prop="kodeSumberDana" label="Kode SD" width="120" />
                <el-table-column prop="sumberDana" label="Sumber Dana" min-width="180" show-overflow-tooltip />
                <el-table-column label="Pagu (Rp)" width="170" align="right">
                  <template #default="{ row }">{{ formatRp(row.totalPagu) }}</template>
                </el-table-column>
              </el-table>
            </div>

            <!-- Detail per Subkegiatan (dengan pencarian khusus bidang ini) -->
            <div>
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; flex-wrap: wrap;">
                <div style="font-size: 11px; font-weight: 600; color: #606266; text-transform: uppercase; letter-spacing: 0.5px;">
                  Detail per Subkegiatan
                  <span style="font-weight: 400; color: #909399; margin-left: 6px;">
                    <template v-if="isSearching(info)">{{ detailRows(info).length }} dari {{ info.allCount }} baris</template>
                    <template v-else>({{ info.allCount }} baris)</template>
                  </span>
                </div>
                <el-input
                  v-model="searchByBidang[info.bidang]"
                  placeholder="Cari kode / nama sub kegiatan..."
                  :prefix-icon="Search"
                  clearable
                  size="small"
                  style="max-width: 320px;"
                />
              </div>
              <el-table :data="detailRows(info)" size="small" border max-height="360" style="width: 100%;">
                <el-table-column prop="namaOPD" label="Nama OPD" width="200" fixed="left" show-overflow-tooltip />
                <el-table-column prop="kode" label="Kode" width="148" show-overflow-tooltip />
                <el-table-column prop="subKegiatan" label="Sub Kegiatan" min-width="260" show-overflow-tooltip />
                <el-table-column prop="kodeSumberDana" label="Kode SD" width="110" />
                <el-table-column prop="sumberDana" label="Sumber Dana" min-width="180" show-overflow-tooltip />
                <el-table-column label="Pagu (Rp)" width="165" align="right">
                  <template #default="{ row }">{{ formatRp(row.paguIndikatif) }}</template>
                </el-table-column>
                <template #empty>
                  <span style="color: #909399;">Tidak ada sub kegiatan yang cocok.</span>
                </template>
              </el-table>
            </div>
          </div>
        </el-collapse-item>
      </div>
    </el-collapse>
  </div>
</template>

<style scoped>
:deep(.el-collapse-item__content) {
  padding: 0;
}
:deep(.el-collapse-item__header) {
  padding: 0 16px;
  height: 52px;
}
</style>
