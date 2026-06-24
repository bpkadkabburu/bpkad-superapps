<script setup>
import { ref, computed, onMounted } from 'vue'
import { Upload, Delete, Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../utils/api.js'

const rawData = ref([])
const search = ref('')
const expandedDinas = ref(new Set())

onMounted(async () => {
  try {
    const { data } = await api.get('/realisasi')
    rawData.value = data.data
  } catch {
    rawData.value = []
  }
})

function formatRupiah(val) {
  if (!val && val !== 0) return '-'
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val)
}

function persen(pagu, realisasi) {
  if (!pagu || pagu === 0) return 0
  return Math.min(100, Math.round((realisasi / pagu) * 10000) / 100)
}

function progressColor(pct) {
  if (pct >= 75) return '#67c23a'
  if (pct >= 50) return '#e6a23c'
  return '#f56c6c'
}

// Aggregate: group by NAMA SUB UNIT → KODE SUB KEGIATAN
const grouped = computed(() => {
  const map = new Map()

  for (const row of rawData.value) {
    const dinasKey = row['KODE SUB UNIT'] || ''
    const dinasNama = row['NAMA SUB UNIT'] || '(Tanpa Dinas)'
    const kodeSubkeg = row['KODE SUB KEGIATAN'] || ''
    const namaSubkeg = row['NAMA SUB KEGIATAN'] || '-'
    const kodeKegiatan = row['KODE KEGIATAN'] || ''
    const namaKegiatan = row['NAMA KEGIATAN'] || '-'
    const pagu = Number(row['PAGU']) || 0
    const realisasi = Number(row['REALISASI']) || 0
    const tahun = row['TAHUN'] || '-'

    if (!map.has(dinasKey)) {
      map.set(dinasKey, {
        kode: dinasKey,
        nama: dinasNama,
        subkegMap: new Map(),
        totalPagu: 0,
        totalRealisasi: 0,
      })
    }

    const dinas = map.get(dinasKey)
    dinas.totalPagu += pagu
    dinas.totalRealisasi += realisasi

    const kodeRekening = row['KODE REKENING'] || ''
    const namaRekening = row['NAMA REKENING'] || ''

    const subkegId = kodeSubkeg
    if (!dinas.subkegMap.has(subkegId)) {
      dinas.subkegMap.set(subkegId, {
        kodeSubkeg,
        namaSubkeg,
        kodeKegiatan,
        namaKegiatan,
        tahun,
        pagu: 0,
        realisasi: 0,
        rekeningMap: new Map(),
      })
    }
    const sk = dinas.subkegMap.get(subkegId)
    sk.pagu += pagu
    sk.realisasi += realisasi

    if (kodeRekening && namaRekening) {
      if (!sk.rekeningMap.has(kodeRekening)) {
        sk.rekeningMap.set(kodeRekening, { kode: kodeRekening, nama: namaRekening, pagu: 0, realisasi: 0 })
      }
      const rek = sk.rekeningMap.get(kodeRekening)
      rek.pagu += pagu
      rek.realisasi += realisasi
    }
  }

  // Flatten to array
  return Array.from(map.values()).map(d => ({
    ...d,
    subkegiatan: Array.from(d.subkegMap.values()).map(sk => ({
      ...sk,
      rekening: Array.from(sk.rekeningMap.values()),
    })),
  }))
})

const filteredGrouped = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return grouped.value

  return grouped.value
    .map(dinas => ({
      ...dinas,
      subkegiatan: dinas.subkegiatan.filter(sk =>
        sk.kodeSubkeg.toLowerCase().includes(q) ||
        sk.namaSubkeg.toLowerCase().includes(q)
      ),
    }))
    .filter(d => d.subkegiatan.length > 0)
})

function toggleDinas(kode) {
  if (expandedDinas.value.has(kode)) {
    expandedDinas.value.delete(kode)
  } else {
    expandedDinas.value.add(kode)
  }
  expandedDinas.value = new Set(expandedDinas.value)
}

function expandAll() {
  expandedDinas.value = new Set(filteredGrouped.value.map(d => d.kode))
}

function collapseAll() {
  expandedDinas.value = new Set()
}

// Import JSON
function handleFileImport(uploadFile) {
  const file = uploadFile.raw
  if (!file) return

  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const parsed = JSON.parse(e.target.result)
      if (!Array.isArray(parsed)) {
        ElMessage.error('Format JSON harus berupa array.')
        return
      }
      // Merge dengan data existing, hindari duplikat (merge by NO + KODE REKENING)
      const existing = rawData.value
      const existingKeys = new Set(existing.map(r => `${r['NO']}_${r['KODE REKENING']}`))
      const newRows = parsed.filter(r => !existingKeys.has(`${r['NO']}_${r['KODE REKENING']}`))
      rawData.value = [...existing, ...newRows]
      await api.post('/realisasi', { data: rawData.value })
      ElMessage.success(`Berhasil import ${parsed.length} baris (${newRows.length} baris baru).`)
    } catch {
      ElMessage.error('File tidak valid, pastikan format JSON yang benar.')
    }
  }
  reader.readAsText(file)
  return false
}

async function clearData() {
  await ElMessageBox.confirm(
    'Semua data realisasi akan dihapus dari localStorage. Lanjutkan?',
    'Konfirmasi Hapus',
    { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
  )
  await api.delete('/realisasi')
  rawData.value = []
  expandedDinas.value = new Set()
  ElMessage.success('Data berhasil dihapus.')
}

const totalPaguAll = computed(() => rawData.value.reduce((s, r) => s + (Number(r['PAGU']) || 0), 0))
const totalRealisasiAll = computed(() => rawData.value.reduce((s, r) => s + (Number(r['REALISASI']) || 0), 0))
const totalPersenAll = computed(() => persen(totalPaguAll.value, totalRealisasiAll.value))
</script>

<template>
  <div>
    <!-- Header -->
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Realisasi Anggaran</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          {{ rawData.length }} rekening dari {{ grouped.length }} dinas
        </p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".json"
          :on-change="handleFileImport"
        >
          <el-button type="primary" :icon="Upload">Import JSON</el-button>
        </el-upload>
        <el-button type="danger" :icon="Delete" :disabled="rawData.length === 0" @click="clearData">
          Hapus Semua
        </el-button>
      </div>
    </div>

    <!-- Summary card -->
    <el-row :gutter="16" style="margin-bottom:20px;" v-if="rawData.length > 0">
      <el-col :xs="24" :sm="8">
        <el-card shadow="never" style="border-radius:8px;">
          <div style="font-size:12px; color:#909399; margin-bottom:4px;">Total Pagu</div>
          <div style="font-size:16px; font-weight:700; color:#303133;">{{ formatRupiah(totalPaguAll) }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="8">
        <el-card shadow="never" style="border-radius:8px;">
          <div style="font-size:12px; color:#909399; margin-bottom:4px;">Total Realisasi</div>
          <div style="font-size:16px; font-weight:700; color:#67c23a;">{{ formatRupiah(totalRealisasiAll) }}</div>
        </el-card>
      </el-col>
      <el-col :xs="24" :sm="8">
        <el-card shadow="never" style="border-radius:8px;">
          <div style="font-size:12px; color:#909399; margin-bottom:6px;">Persentase Realisasi</div>
          <el-progress
            :percentage="totalPersenAll"
            :color="progressColor(totalPersenAll)"
            :stroke-width="10"
          />
        </el-card>
      </el-col>
    </el-row>

    <!-- Empty state -->
    <el-empty
      v-if="rawData.length === 0"
      description="Belum ada data. Import file JSON untuk memulai."
      :image-size="120"
    />

    <template v-else>
      <!-- Search + expand controls -->
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">
        <el-input
          v-model="search"
          placeholder="Cari kode / nama sub kegiatan..."
          :prefix-icon="Search"
          clearable
          style="max-width:380px;"
        />
        <el-button size="small" @click="expandAll">Buka Semua</el-button>
        <el-button size="small" @click="collapseAll">Tutup Semua</el-button>
        <span style="font-size:12px; color:#909399; margin-left:4px;">
          {{ filteredGrouped.length }} dinas ditampilkan
        </span>
      </div>

      <!-- No result after search -->
      <el-empty
        v-if="filteredGrouped.length === 0"
        description="Tidak ada sub kegiatan yang cocok dengan pencarian."
        :image-size="80"
      />

      <!-- Dinas cards -->
      <div v-for="dinas in filteredGrouped" :key="dinas.kode" style="margin-bottom:12px;">
        <!-- Dinas header (clickable) -->
        <div
          @click="toggleDinas(dinas.kode)"
          style="
            display:flex;
            align-items:center;
            justify-content:space-between;
            background:#fff;
            border:1px solid #e4e7ed;
            border-radius:8px;
            padding:14px 18px;
            cursor:pointer;
            user-select:none;
            transition:box-shadow 0.2s;
          "
          :style="expandedDinas.has(dinas.kode) ? 'border-bottom-left-radius:0;border-bottom-right-radius:0;border-bottom-color:transparent;' : ''"
        >
          <div style="flex:1; min-width:0;">
            <div style="font-size:13px; color:#909399; margin-bottom:2px;">{{ dinas.kode }}</div>
            <div style="font-size:14px; font-weight:600; color:#303133; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              {{ dinas.nama }}
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:24px; flex-shrink:0; margin-left:16px;">
            <div style="text-align:right; display:none;" class="dinas-summary-pagu">
              <div style="font-size:11px; color:#909399;">Pagu</div>
              <div style="font-size:13px; font-weight:600; color:#303133;">{{ formatRupiah(dinas.totalPagu) }}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px; color:#909399;">Pagu</div>
              <div style="font-size:13px; font-weight:600;">{{ formatRupiah(dinas.totalPagu) }}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:11px; color:#909399;">Realisasi</div>
              <div style="font-size:13px; font-weight:600; color:#67c23a;">{{ formatRupiah(dinas.totalRealisasi) }}</div>
            </div>
            <div style="min-width:80px; text-align:right;">
              <el-progress
                :percentage="persen(dinas.totalPagu, dinas.totalRealisasi)"
                :color="progressColor(persen(dinas.totalPagu, dinas.totalRealisasi))"
                :stroke-width="8"
                style="min-width:80px;"
              />
            </div>
            <el-icon style="color:#909399; transition:transform 0.2s;" :style="expandedDinas.has(dinas.kode) ? 'transform:rotate(180deg)' : ''">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
            </el-icon>
          </div>
        </div>

        <!-- Sub kegiatan table -->
        <div
          v-show="expandedDinas.has(dinas.kode)"
          style="
            border:1px solid #e4e7ed;
            border-top:none;
            border-bottom-left-radius:8px;
            border-bottom-right-radius:8px;
            background:#fff;
            overflow:hidden;
          "
        >
          <el-table
            :data="dinas.subkegiatan"
            size="small"
            style="width:100%;"
            :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
            stripe
            row-key="kodeSubkeg"
          >
            <el-table-column type="expand">
              <template #default="{ row }">
                <div style="padding:8px 16px 12px 48px; background:#fafafa;">
                  <div style="font-size:11px; color:#909399; margin-bottom:6px; font-weight:600;">Rincian Rekening:</div>
                  <el-table
                    :data="row.rekening"
                    size="small"
                    :header-cell-style="{ background:'#f0f2f5', color:'#909399', fontSize:'11px' }"
                    style="width:100%;"
                  >
                    <el-table-column label="Kode Rekening" prop="kode" width="220">
                      <template #default="{ row: r }">
                        <span style="font-family:monospace; font-size:11px; color:#606266;">{{ r.kode }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="Nama Rekening" prop="nama" min-width="240">
                      <template #default="{ row: r }">
                        <span style="font-size:11px; color:#303133;">{{ r.nama }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="Pagu" width="160" align="right">
                      <template #default="{ row: r }">
                        <span style="font-size:11px;">{{ formatRupiah(r.pagu) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="Realisasi" width="160" align="right">
                      <template #default="{ row: r }">
                        <span style="font-size:11px; color:#67c23a; font-weight:600;">{{ formatRupiah(r.realisasi) }}</span>
                      </template>
                    </el-table-column>
                    <el-table-column label="%" width="110" align="center">
                      <template #default="{ row: r }">
                        <el-progress
                          :percentage="persen(r.pagu, r.realisasi)"
                          :color="progressColor(persen(r.pagu, r.realisasi))"
                          :stroke-width="5"
                          style="min-width:70px;"
                        />
                      </template>
                    </el-table-column>
                  </el-table>
                </div>
              </template>
            </el-table-column>
            <el-table-column type="index" label="No" width="50" align="center" />
            <el-table-column label="Kode Sub Kegiatan" prop="kodeSubkeg" width="200">
              <template #default="{ row }">
                <span style="font-family:monospace; font-size:12px; color:#606266;">{{ row.kodeSubkeg }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Sub Kegiatan" prop="namaSubkeg" min-width="260">
              <template #default="{ row }">
                <div style="font-size:12px; color:#303133; line-height:1.4;">{{ row.namaSubkeg }}</div>
                <div style="font-size:11px; color:#909399; margin-top:2px;">{{ row.namaKegiatan }}</div>
              </template>
            </el-table-column>
            <el-table-column label="Tahun" prop="tahun" width="70" align="center">
              <template #default="{ row }">
                <el-tag size="small" type="info">{{ row.tahun }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="Pagu" width="180" align="right">
              <template #default="{ row }">
                <span style="font-size:12px;">{{ formatRupiah(row.pagu) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Realisasi" width="180" align="right">
              <template #default="{ row }">
                <span style="font-size:12px; color:#67c23a; font-weight:600;">{{ formatRupiah(row.realisasi) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="%" width="120" align="center">
              <template #default="{ row }">
                <el-progress
                  :percentage="persen(row.pagu, row.realisasi)"
                  :color="progressColor(persen(row.pagu, row.realisasi))"
                  :stroke-width="6"
                  style="min-width:80px;"
                />
              </template>
            </el-table-column>
          </el-table>
        </div>
      </div>
    </template>
  </div>
</template>
