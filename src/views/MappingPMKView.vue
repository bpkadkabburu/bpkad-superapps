<script setup>
import { ref, computed, reactive, watch, onMounted } from 'vue'
import ExcelJS from 'exceljs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled, ArrowRight } from '@element-plus/icons-vue'
import api from '../utils/api.js'

const fileRekap = ref(null)
const filePMK = ref(null)
const fileRekapName = ref('')
const filePMKName = ref('')
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(100)

const paguPerBidang = reactive({})
const results = ref([])

onMounted(async () => {
  try {
    const { data } = await api.get('/mapping-pmk')
    Object.assign(paguPerBidang, data.pagu_per_bidang || {})
    results.value = data.results || []
  } catch {
    // keep empty defaults
  }
})

function debounce(fn, delay) {
  let timer
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay) }
}

const savePagu = debounce(async (val) => {
  try { await api.put('/mapping-pmk/pagu', { pagu_per_bidang: val }) } catch {}
}, 500)

const saveResults = debounce(async (val) => {
  try { await api.put('/mapping-pmk/results', { results: val }) } catch {}
}, 500)

watch(paguPerBidang, (val) => savePagu({ ...val }), { deep: true })
watch(results, (val) => saveResults([...val]), { deep: true })

// Accordion open state: array of bidang names currently expanded
const openBidang = ref([])

const totalRows = computed(() => results.value.length)
const pagedData = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return results.value.slice(start, start + pageSize.value)
})

// Summary: agregasi per bidang
const summaryPerBidang = computed(() => {
  if (!results.value.length) return []

  const bidangMap = new Map()

  for (const row of results.value) {
    const b = (row.bidang && row.bidang !== '-') ? row.bidang : 'Tidak Terpetakan'

    if (!bidangMap.has(b)) {
      bidangMap.set(b, {
        bidang: b,
        totalPaguBelanja: 0,
        perSD: new Map(),
        perOPDSD: new Map(),
      })
    }

    const entry = bidangMap.get(b)
    entry.totalPaguBelanja += row.paguIndikatif

    // Per sumber dana
    const sdKey = row.kodeSumberDana
    if (!entry.perSD.has(sdKey)) {
      entry.perSD.set(sdKey, {
        kodeSumberDana: row.kodeSumberDana,
        sumberDana: row.sumberDana,
        totalPagu: 0,
      })
    }
    entry.perSD.get(sdKey).totalPagu += row.paguIndikatif

    // Per OPD per sumber dana
    const opdSDKey = `${row.namaOPD}||${row.kodeSumberDana}`
    if (!entry.perOPDSD.has(opdSDKey)) {
      entry.perOPDSD.set(opdSDKey, {
        namaOPD: row.namaOPD,
        kodeSumberDana: row.kodeSumberDana,
        sumberDana: row.sumberDana,
        totalPagu: 0,
      })
    }
    entry.perOPDSD.get(opdSDKey).totalPagu += row.paguIndikatif
  }

  return Array.from(bidangMap.values()).map(data => ({
    bidang: data.bidang,
    totalPaguBelanja: data.totalPaguBelanja,
    perSDList: Array.from(data.perSD.values()).sort((a, b) => b.totalPagu - a.totalPagu),
    perOPDSDList: Array.from(data.perOPDSD.values()).sort((a, b) => {
      const opdCmp = a.namaOPD.localeCompare(b.namaOPD, 'id')
      if (opdCmp !== 0) return opdCmp
      return b.totalPagu - a.totalPagu
    }),
  }))
})

// Detail rows per bidang (for the per-bidang detail table inside each card)
const detailPerBidang = computed(() => {
  const map = new Map()
  for (const row of results.value) {
    const b = (row.bidang && row.bidang !== '-') ? row.bidang : 'Tidak Terpetakan'
    if (!map.has(b)) map.set(b, [])
    map.get(b).push(row)
  }
  return map
})

// Inisialisasi paguPerBidang dan openBidang setiap kali summary berubah
watch(summaryPerBidang, (summary) => {
  for (const { bidang } of summary) {
    if (!(bidang in paguPerBidang)) paguPerBidang[bidang] = { tahunIni: 0, sisaTahunLalu: 0 }
    if (!openBidang.value.includes(bidang)) openBidang.value.push(bidang)
  }
}, { immediate: true })

function getTotalPagu(bidang) {
  const p = paguPerBidang[bidang] || { tahunIni: 0, sisaTahunLalu: 0 }
  return (p.tahunIni || 0) + (p.sisaTahunLalu || 0)
}

function getPersentase(bidangInfo) {
  const total = getTotalPagu(bidangInfo.bidang)
  if (!total) return 0
  return Math.min(Math.round((bidangInfo.totalPaguBelanja / total) * 100), 100)
}

function progressStatus(pct) {
  if (pct >= 100) return 'success'
  if (pct >= 75) return 'warning'
  return 'exception'
}

async function clearResults() {
  await ElMessageBox.confirm(
    'Hasil mapping akan dihapus dari localStorage. File Excel tidak perlu diunggah ulang, tapi kamu perlu proses lagi. Lanjutkan?',
    'Konfirmasi Hapus Hasil',
    { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
  )
  await api.delete('/mapping-pmk')
  results.value = []
  ElMessage.success('Hasil mapping dihapus.')
}

// ─── File Handling ───────────────────────────────────────────────────────────

function handleFileRekapChange(file) {
  fileRekap.value = file.raw
  fileRekapName.value = file.name
}

function handleFilePMKChange(file) {
  filePMK.value = file.raw
  filePMKName.value = file.name
}

async function readExcelRows(file) {
  const buffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]

  const rows = []
  let headers = []

  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) {
      headers = row.values.slice(1).map(h => {
        if (h && typeof h === 'object' && h.richText) return h.richText.map(r => r.text).join('').trim()
        return String(h ?? '').trim()
      })
    } else {
      const obj = {}
      row.values.slice(1).forEach((val, i) => {
        if (i < headers.length && headers[i]) {
          if (val && typeof val === 'object' && val.richText) {
            obj[headers[i]] = val.richText.map(r => r.text).join('')
          } else if (val && typeof val === 'object' && val.formula !== undefined) {
            obj[headers[i]] = val.result
          } else {
            obj[headers[i]] = val
          }
        }
      })
      if (Object.values(obj).some(v => v !== null && v !== undefined && v !== '')) {
        rows.push(obj)
      }
    }
  })

  return rows
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getCol(obj, candidates) {
  for (const c of candidates) {
    const val = obj[c]
    if (val !== null && val !== undefined && val !== '') return String(val).trim()
  }
  return '-'
}

function getNum(obj, candidates) {
  for (const c of candidates) {
    const val = obj[c]
    if (val !== null && val !== undefined && val !== '') {
      const n = Number(val)
      if (!isNaN(n)) return n
    }
  }
  return 0
}

function groupByKey(arr, candidates) {
  return arr.reduce((groups, item) => {
    const k = getCol(item, candidates)
    if (!groups[k]) groups[k] = []
    groups[k].push(item)
    return groups
  }, {})
}

// ─── Mapping Logic ───────────────────────────────────────────────────────────

function processMapping(rekapData, pmkData) {
  // Build PMK lookup: KODE_SUBKEGIATAN → row
  const pmkMap = new Map()
  for (const row of pmkData) {
    const kode = getCol(row, ['KODE_SUBKEGIATAN', 'KODE SUBKEGIATAN', 'KODE SUB KEGIATAN', 'kode_subkegiatan'])
    if (kode && kode !== '-') pmkMap.set(kode, row)
  }

  const output = []
  // File 1: grouping per OPD
  const byOPD = groupByKey(rekapData, ['NAMA SUB UNIT'])

  for (const [namaOPD, opdRows] of Object.entries(byOPD)) {
    // Per subkegiatan dalam OPD ini
    const bySubkegiatan = groupByKey(opdRows, ['KODE SUB KEGIATAN'])

    for (const [kodeSubkegiatan, subRows] of Object.entries(bySubkegiatan)) {
      const pmkMatch = pmkMap.get(kodeSubkegiatan)
      if (!pmkMatch) continue // hanya yang masuk PMK

      const bidang = getCol(pmkMatch, ['bidang', 'BIDANG', 'Bidang'])
      if (
        bidang.toLowerCase().includes('kesehatan') &&
        namaOPD.toLowerCase().includes('puskesmas')
      ) continue

      // Per sumber dana dalam subkegiatan ini
      const bySumberDana = groupByKey(subRows, ['KODE SUMBER DANA', 'KODE_SUMBER_DANA', 'KODE SUMBERDANA'])

      for (const [kodeSumberDana, sdRows] of Object.entries(bySumberDana)) {
        const first = sdRows[0]
        const totalPagu = sdRows.reduce((sum, r) => sum + getNum(r, ['PAGU', 'PAGU INDIKATIF', 'JUMLAH']), 0)

        output.push({
          kode: kodeSubkegiatan,
          subKegiatan: getCol(first, ['NAMA SUB KEGIATAN']),
          kodeSumberDana: kodeSumberDana === '-' ? '-' : kodeSumberDana,
          sumberDana: getCol(first, ['NAMA SUMBER DANA', 'NAMA_SUMBER_DANA', 'SUMBER DANA']),
          paguIndikatif: totalPagu,
          namaOPD,
          kodePMK: getCol(pmkMatch, ['kode_subkegiatan', 'KODE_SUBKEGIATAN']),
          bidang,
        })
      }
    }
  }

  return output
}

// ─── Proses ──────────────────────────────────────────────────────────────────

async function proses() {
  if (!fileRekap.value || !filePMK.value) {
    ElMessage.warning('Pilih kedua file Excel terlebih dahulu')
    return
  }

  loading.value = true
  results.value = []

  try {
    const [rekapData, pmkData] = await Promise.all([
      readExcelRows(fileRekap.value),
      readExcelRows(filePMK.value),
    ])

    results.value = processMapping(rekapData, pmkData)
    currentPage.value = 1

    if (results.value.length === 0) {
      ElMessage.warning('Tidak ada data yang cocok. Pastikan KODE SUB KEGIATAN di File 1 sesuai dengan KODE_SUBKEGIATAN di File 2.')
    } else {
      ElMessage.success(`Berhasil memproses ${results.value.length.toLocaleString('id-ID')} baris data`)
    }
  } catch (err) {
    console.error(err)
    ElMessage.error('Gagal memproses file: ' + err.message)
  } finally {
    loading.value = false
  }
}

// ─── Format & Export ─────────────────────────────────────────────────────────

function formatRp(val) {
  if (!val || isNaN(Number(val))) return 'Rp 0'
  return 'Rp ' + Number(val).toLocaleString('id-ID')
}

async function exportExcelBidang(info) {
  const rows = detailPerBidang.value.get(info.bidang) || []
  if (!rows.length) {
    ElMessage.warning('Tidak ada data untuk diekspor')
    return
  }

  loading.value = true
  try {
    const workbook = new ExcelJS.Workbook()

    // Sheet 1: Summary bidang
    const sheetSummary = workbook.addWorksheet('SUMMARY')
    sheetSummary.columns = [
      { header: 'Bidang', key: 'bidang', width: 25 },
      { header: 'Pagu Bidang Tahun Ini (Rp)', key: 'paguTahunIni', width: 26 },
      { header: 'Pagu Sisa Tahun Sebelumnya (Rp)', key: 'paguSisaTahunLalu', width: 32 },
      { header: 'Total Pagu Bidang (Rp)', key: 'paguTotal', width: 24 },
      { header: 'Total Pagu Belanja (Rp)', key: 'paguBelanja', width: 24 },
      { header: '% Terpakai', key: 'persen', width: 14 },
    ]
    const sumHdr = sheetSummary.getRow(1)
    sumHdr.font = { bold: true, name: 'Calibri', size: 9 }
    sumHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
    const paguObj = paguPerBidang[info.bidang] || { tahunIni: 0, sisaTahunLalu: 0 }
    const paguTahunIni = paguObj.tahunIni || 0
    const paguSisaTahunLalu = paguObj.sisaTahunLalu || 0
    const paguTotal = paguTahunIni + paguSisaTahunLalu
    const rSum = sheetSummary.addRow({
      bidang: info.bidang,
      paguTahunIni,
      paguSisaTahunLalu,
      paguTotal,
      paguBelanja: info.totalPaguBelanja,
      persen: paguTotal ? `${getPersentase(info)}%` : '-',
    })
    rSum.font = { name: 'Calibri', size: 9 }
    rSum.getCell('paguTahunIni').numFmt = '#,##0'
    rSum.getCell('paguSisaTahunLalu').numFmt = '#,##0'
    rSum.getCell('paguTotal').numFmt = '#,##0'
    rSum.getCell('paguBelanja').numFmt = '#,##0'

    // Sheet 2: Sebaran per Sumber Dana
    const sheetSD = workbook.addWorksheet('SEBARAN SUMBER DANA')
    sheetSD.columns = [
      { header: 'Kode Sumber Dana', key: 'kodeSumberDana', width: 22 },
      { header: 'Sumber Dana', key: 'sumberDana', width: 35 },
      { header: 'Total Pagu (Rp)', key: 'totalPagu', width: 22 },
    ]
    const sdHdr = sheetSD.getRow(1)
    sdHdr.font = { bold: true, name: 'Calibri', size: 9 }
    sdHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
    for (const row of info.perSDList) {
      const rSD = sheetSD.addRow(row)
      rSD.font = { name: 'Calibri', size: 9 }
      rSD.getCell('totalPagu').numFmt = '#,##0'
    }

    // Sheet 3: Breakdown per OPD per SD
    const sheetBreakdown = workbook.addWorksheet('BREAKDOWN OPD')
    sheetBreakdown.columns = [
      { header: 'Nama OPD', key: 'namaOPD', width: 32 },
      { header: 'Kode Sumber Dana', key: 'kodeSumberDana', width: 22 },
      { header: 'Sumber Dana', key: 'sumberDana', width: 35 },
      { header: 'Total Pagu (Rp)', key: 'totalPagu', width: 22 },
    ]
    const bdHdr = sheetBreakdown.getRow(1)
    bdHdr.font = { bold: true, name: 'Calibri', size: 9 }
    bdHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
    for (const row of info.perOPDSDList) {
      const rBd = sheetBreakdown.addRow(row)
      rBd.font = { name: 'Calibri', size: 9 }
      rBd.getCell('totalPagu').numFmt = '#,##0'
    }

    // Sheet 4: Detail per Subkegiatan
    const sheetDetail = workbook.addWorksheet('DETAIL SUBKEGIATAN')
    sheetDetail.columns = [
      { header: 'Nama OPD', key: 'namaOPD', width: 32 },
      { header: 'Kode', key: 'kode', width: 20 },
      { header: 'Sub Kegiatan', key: 'subKegiatan', width: 45 },
      { header: 'Kode Sumber Dana', key: 'kodeSumberDana', width: 22 },
      { header: 'Sumber Dana', key: 'sumberDana', width: 35 },
      { header: 'Pagu Indikatif (Rp)', key: 'paguIndikatif', width: 22 },
      { header: 'Kode PMK', key: 'kodePMK', width: 20 },
      { header: 'Bidang', key: 'bidang', width: 25 },
    ]
    const dtHdr = sheetDetail.getRow(1)
    dtHdr.font = { bold: true, name: 'Calibri', size: 9 }
    dtHdr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } }
    for (const item of rows) {
      const rDt = sheetDetail.addRow(item)
      rDt.font = { name: 'Calibri', size: 9 }
      rDt.getCell('paguIndikatif').numFmt = '#,##0'
    }

    const buffer = await workbook.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `MAPPING PMK - Bidang ${info.bidang}.xlsx`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    ElMessage.success(`Bidang ${info.bidang} berhasil diekspor (4 sheet)`)
  } catch (err) {
    console.error(err)
    ElMessage.error('Gagal ekspor: ' + err.message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: #303133;">
        Pemetaan Sumber Dana berdasarkan PMK
      </h2>
      <p style="margin: 4px 0 0; color: #909399; font-size: 13px;">
        Subkegiatan yang masuk referensi PMK beserta sumber dana yang digunakan OPD
      </p>
    </div>

    <!-- ── Upload & Aksi ─────────────────────────────────────────────── -->
    <el-card style="margin-bottom: 16px;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 16px;">
        <div>
          <div style="font-weight: 600; margin-bottom: 8px; font-size: 13px;">File 1: Rekap Inputan SKPD</div>
          <el-upload
            drag :auto-upload="false" :show-file-list="false"
            accept=".xlsx,.xls" @change="handleFileRekapChange"
          >
            <el-icon style="font-size: 36px; color: #c0c4cc;"><UploadFilled /></el-icon>
            <div style="font-size: 13px; color: #606266; margin-top: 6px;">Drag &amp; drop atau klik untuk pilih file</div>
            <div v-if="fileRekapName" style="font-size: 12px; color: #67c23a; margin-top: 6px; font-weight: 500;">
              ✓ {{ fileRekapName }}
            </div>
          </el-upload>
        </div>
        <div>
          <div style="font-weight: 600; margin-bottom: 8px; font-size: 13px;">File 2: Referensi PMK (Subkegiatan)</div>
          <el-upload
            drag :auto-upload="false" :show-file-list="false"
            accept=".xlsx,.xls" @change="handleFilePMKChange"
          >
            <el-icon style="font-size: 36px; color: #c0c4cc;"><UploadFilled /></el-icon>
            <div style="font-size: 13px; color: #606266; margin-top: 6px;">Drag &amp; drop atau klik untuk pilih file</div>
            <div v-if="filePMKName" style="font-size: 12px; color: #67c23a; margin-top: 6px; font-weight: 500;">
              ✓ {{ filePMKName }}
            </div>
          </el-upload>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
        <el-button type="primary" :loading="loading" :disabled="!fileRekap || !filePMK" @click="proses">
          Proses
        </el-button>
        <el-button
          v-if="results.length"
          type="danger"
          plain
          :loading="loading"
          @click="clearResults"
        >
          Hapus Hasil
        </el-button>
        <span v-if="results.length" style="font-size: 13px; color: #606266;">
          Total: <strong>{{ results.length.toLocaleString('id-ID') }}</strong> baris
        </span>
      </div>
    </el-card>

    <template v-if="results.length">

      <!-- ── Card Accordion per Bidang ────────────────────────────────── -->
      <el-collapse v-model="openBidang" style="border: none; background: transparent;">
        <div
          v-for="info in summaryPerBidang"
          :key="info.bidang"
          style="margin-bottom: 16px; border: 1px solid #e4e7ed; border-radius: 4px; overflow: hidden; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.06);"
        >
          <el-collapse-item :name="info.bidang" style="border: none;">
            <template #title>
              <div style="display: flex; align-items: center; justify-content: space-between; width: 100%; padding-right: 12px;">
                <span style="font-size: 15px; font-weight: 700; color: #303133;">
                  Bidang {{ info.bidang }}
                </span>
                <div @click.stop>
                  <el-button
                    type="success" size="small" :loading="loading"
                    :disabled="!(detailPerBidang.get(info.bidang) || []).length"
                    @click.stop="exportExcelBidang(info)"
                  >
                    Export Excel
                  </el-button>
                </div>
              </div>
            </template>

            <div style="padding: 0 16px 16px;">
              <!-- Row 1: Pagu Belanja (+ input pagu) + Sebaran per SD -->
              <div style="display: grid; grid-template-columns: 250px 1fr; gap: 16px; margin-bottom: 12px; align-items: stretch;">
                <!-- Pagu Belanja + Input Pagu Bidang -->
                <div style="background: #f5f7fa; border-radius: 6px; padding: 14px; display: flex; flex-direction: column; gap: 6px;">
                  <div style="font-size: 11px; color: #909399; text-transform: uppercase; letter-spacing: 0.5px;">Pagu Belanja</div>
                  <div style="font-size: 17px; font-weight: 700; color: #303133;">
                    {{ formatRp(info.totalPaguBelanja) }}
                  </div>
                  <div style="border-top: 1px solid #e4e7ed; margin: 4px 0;"></div>
                  <div style="font-size: 11px; color: #909399;">Pagu Bidang Tahun Ini (Rp)</div>
                  <el-input-number
                    v-model="paguPerBidang[info.bidang].tahunIni"
                    :min="0" :step="1000000" :precision="0" :controls="false"
                    style="width: 100%;"
                    placeholder="0"
                  />
                  <div style="font-size: 11px; color: #909399; margin-top: 4px;">Pagu Sisa Tahun Sebelumnya (Rp)</div>
                  <el-input-number
                    v-model="paguPerBidang[info.bidang].sisaTahunLalu"
                    :min="0" :step="1000000" :precision="0" :controls="false"
                    style="width: 100%;"
                    placeholder="0"
                  />
                  <div style="font-size: 11px; color: #909399; margin-top: 4px;">
                    Total: <strong>{{ formatRp(getTotalPagu(info.bidang)) }}</strong>
                  </div>
                  <el-progress
                    :percentage="getPersentase(info)"
                    :status="getTotalPagu(info.bidang) ? progressStatus(getPersentase(info)) : ''"
                    :stroke-width="10"
                  />
                  <div style="font-size: 10px; color: #909399;">
                    {{ getTotalPagu(info.bidang) ? `${getPersentase(info)}% terpakai` : 'Masukkan pagu bidang untuk melihat persentase' }}
                  </div>
                </div>

                <!-- Sebaran per Sumber Dana (scrollable, tinggi sejajar pagu box) -->
                <div style="display: flex; flex-direction: column;">
                  <div style="font-size: 11px; font-weight: 600; margin-bottom: 5px; color: #606266; text-transform: uppercase; letter-spacing: 0.5px;">Sebaran per Sumber Dana</div>
                  <el-table :data="info.perSDList" size="small" border max-height="190" style="width: 100%; flex: 1;">
                    <el-table-column prop="kodeSumberDana" label="Kode SD" width="165" show-overflow-tooltip />
                    <el-table-column prop="sumberDana" label="Sumber Dana" min-width="160" show-overflow-tooltip />
                    <el-table-column label="Pagu (Rp)" width="155" align="right">
                      <template #default="{ row }">{{ formatRp(row.totalPagu) }}</template>
                    </el-table-column>
                  </el-table>
                </div>
              </div>

              <!-- Row 2: Breakdown per OPD per SD (compact) -->
              <div style="margin-bottom: 12px;">
                <div style="font-size: 11px; font-weight: 600; margin-bottom: 5px; color: #606266; text-transform: uppercase; letter-spacing: 0.5px;">Breakdown per OPD per Sumber Dana</div>
                <el-table :data="info.perOPDSDList" size="small" border max-height="190" style="width: 100%;">
                  <el-table-column prop="namaOPD" label="Nama OPD" min-width="200" show-overflow-tooltip fixed="left" />
                  <el-table-column prop="kodeSumberDana" label="Kode SD" width="120" />
                  <el-table-column prop="sumberDana" label="Sumber Dana" min-width="180" show-overflow-tooltip />
                  <el-table-column label="Pagu (Rp)" width="155" align="right">
                    <template #default="{ row }">{{ formatRp(row.totalPagu) }}</template>
                  </el-table-column>
                </el-table>
              </div>

              <!-- Row 3: Detail per Subkegiatan bidang ini -->
              <div>
                <div style="font-size: 11px; font-weight: 600; margin-bottom: 5px; color: #606266; text-transform: uppercase; letter-spacing: 0.5px;">
                  Detail per Subkegiatan
                  <span style="font-weight: 400; color: #909399; margin-left: 6px;">({{ (detailPerBidang.get(info.bidang) || []).length }} baris)</span>
                </div>
                <el-table :data="detailPerBidang.get(info.bidang) || []" size="small" border max-height="360" style="width: 100%;">
                  <el-table-column prop="namaOPD" label="Nama OPD" width="200" fixed="left" show-overflow-tooltip />
                  <el-table-column prop="kode" label="Kode" width="148" show-overflow-tooltip />
                  <el-table-column prop="subKegiatan" label="Sub Kegiatan" min-width="260" show-overflow-tooltip />
                  <el-table-column prop="kodeSumberDana" label="Kode SD" width="110" />
                  <el-table-column prop="sumberDana" label="Sumber Dana" min-width="180" show-overflow-tooltip />
                  <el-table-column label="Pagu Indikatif (Rp)" width="165" align="right">
                    <template #default="{ row }">{{ formatRp(row.paguIndikatif) }}</template>
                  </el-table-column>
                  <el-table-column prop="kodePMK" label="Kode PMK" width="148" show-overflow-tooltip />
                </el-table>
              </div>
            </div>
          </el-collapse-item>
        </div>
      </el-collapse>

    </template>
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
