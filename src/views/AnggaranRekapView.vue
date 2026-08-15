<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import ExcelJS from 'exceljs'
import { Upload, Delete, Search, Refresh } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import api from '../utils/api.js'

const rawData = ref([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(50)
const route = useRoute()
const tahun = computed(() => route.params.tahun)

// Filter aktif — semuanya dijalankan di sisi klien karena data satu tahun
// memang sudah ditarik sekaligus saat halaman dibuka.
const filter = ref({
  kodeSkpd: '',
  kodeSubKegiatan: '',
  kodeRekening: '',
  sumberDana: '',
  paketKelompok: '',
  q: '',
})

function getCellText(val) {
  if (val == null) return null
  if (typeof val === 'object' && val.richText) return val.richText.map(r => r.text).join('')
  if (typeof val === 'object' && val.text) return val.text
  return String(val)
}

async function load() {
  loading.value = true
  try {
    const { data } = await api.get('/sumber-data/anggaran', { params: { tahun: tahun.value } })
    rawData.value = data.data
  } catch {
    rawData.value = []
  } finally {
    loading.value = false
  }
}

onMounted(load)

// Opsi dropdown diturunkan dari data yang ada, lengkap dengan jumlah barisnya
// supaya kelihatan mana yang isinya banyak (mirip filter Dokumen Realisasi).
function opsiDari(kodeKey, namaKey) {
  const map = new Map()
  for (const r of rawData.value) {
    const kode = (r[kodeKey] || '').trim()
    if (!kode) continue
    const cur = map.get(kode) || { kode, nama: (r[namaKey] || '').trim(), jumlah: 0 }
    cur.jumlah++
    map.set(kode, cur)
  }
  return [...map.values()].sort((a, b) => a.kode.localeCompare(b.kode))
}

const opsi = computed(() => {
  const sumberDana = new Map()
  for (const r of rawData.value) {
    const nama = (r.nama_sumber_dana || '').trim()
    if (!nama) continue
    const cur = sumberDana.get(nama) || { nama, kode: (r.kode_sumber_dana || '').trim(), jumlah: 0 }
    cur.jumlah++
    sumberDana.set(nama, cur)
  }
  return {
    skpd: opsiDari('kode_sub_unit', 'nama_sub_unit'),
    subKegiatan: opsiDari('kode_sub_kegiatan', 'nama_sub_kegiatan'),
    rekening: opsiDari('kode_rekening', 'nama_rekening'),
    paketKelompok: opsiDari('paket_kelompok', 'nama_paket_kelompok'),
    sumberDana: [...sumberDana.values()].sort((a, b) => b.jumlah - a.jumlah),
  }
})

const filtered = computed(() => {
  const f = filter.value
  // Multi-search: beberapa istilah dipisah koma = OR. Baris tampil jika cocok
  // salah satu istilah. mis. "0060, 0059, listrik" -> semua yang cocok muncul.
  const terms = f.q.toLowerCase().split(',').map(t => t.trim()).filter(Boolean)
  return rawData.value.filter(r => {
    if (f.kodeSkpd && (r.kode_sub_unit || '').trim() !== f.kodeSkpd) return false
    if (f.kodeSubKegiatan && (r.kode_sub_kegiatan || '').trim() !== f.kodeSubKegiatan) return false
    if (f.kodeRekening && (r.kode_rekening || '').trim() !== f.kodeRekening) return false
    if (f.paketKelompok && (r.paket_kelompok || '').trim() !== f.paketKelompok) return false
    if (f.sumberDana && (r.nama_sumber_dana || '').trim() !== f.sumberDana) return false
    if (!terms.length) return true
    const hay = [
      r.kode_sub_kegiatan, r.nama_sub_kegiatan, r.kode_sub_unit, r.nama_sub_unit,
      r.kode_rekening, r.nama_rekening, r.paket_kelompok,
      r.nama_paket_kelompok, r.nama_sumber_dana,
    ].join(' ').toLowerCase()
    return terms.some(t => hay.includes(t))
  })
})

const adaFilter = computed(() => {
  const f = filter.value
  return !!(f.kodeSkpd || f.kodeSubKegiatan || f.kodeRekening || f.sumberDana || f.paketKelompok || f.q.trim())
})

function resetFilter() {
  filter.value = { kodeSkpd: '', kodeSubKegiatan: '', kodeRekening: '', sumberDana: '', paketKelompok: '', q: '' }
}

function labelKode(o) {
  return o.nama ? `${o.kode} — ${o.nama}` : o.kode
}

const paginated = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})

// Rincian per sumber dana hanya muncul saat ada filter aktif (mis. sub kegiatan
// tertentu); tanpa filter angkanya sama dengan halaman Rekap Anggaran.
const summary = computed(() => {
  if (!adaFilter.value) return null
  let total = 0
  const map = new Map()
  for (const r of filtered.value) {
    const pagu = Number(r.pagu || 0)
    total += pagu
    const nama = r.nama_sumber_dana?.trim() || '(Tanpa Sumber Dana)'
    const key = (r.kode_sumber_dana || '') + '||' + nama
    const cur = map.get(key) || { kode: r.kode_sumber_dana, nama, pagu: 0 }
    cur.pagu += pagu
    map.set(key, cur)
  }
  const sumberDana = [...map.values()].sort((a, b) => b.pagu - a.pagu)
  return { total, sumberDana }
})

// Total pagu untuk baris yang sedang tampil — selalu ada, tidak menunggu filter.
const totalTampil = computed(() =>
  filtered.value.reduce((sum, r) => sum + Number(r.pagu || 0), 0))

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID')
}

watch(filter, () => { currentPage.value = 1 }, { deep: true })

async function handleFileImport(uploadFile) {
  if (!uploadFile.raw) return false

  const buffer = await uploadFile.raw.arrayBuffer()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) {
    ElMessage.error('Sheet tidak ditemukan dalam file Excel')
    return false
  }

  // Ambil header dari row 1, simpan exact string sebagai key
  const colMap = {}
  ws.getRow(1).eachCell((cell, colNum) => {
    const key = String(cell.value ?? '').trim()
    if (key) colMap[key] = colNum
  })

  if (!colMap['KODE REKENING']) {
    ElMessage.error('Kolom "KODE REKENING" tidak ditemukan. Pastikan file adalah rekap anggaran yang benar.')
    return false
  }

  const rows = []
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    // Skip baris hierarchy (tanpa kode rekening)
    const kodeRek = getCellText(row.getCell(colMap['KODE REKENING']).value)
    if (!kodeRek) return

    const obj = {}
    Object.entries(colMap).forEach(([header, colNum]) => {
      obj[header] = getCellText(row.getCell(colNum).value)
    })
    rows.push(obj)
  })

  if (!rows.length) {
    ElMessage.warning('Tidak ada baris data rekening yang ditemukan')
    return false
  }

  try {
    await api.post('/sumber-data/anggaran', { data: rows, tahun: tahun.value })
    await load()
    ElMessage.success(`${rows.length} baris anggaran berhasil diimport`)
  } catch {
    ElMessage.error('Gagal menyimpan data ke server')
  }

  return false
}

async function clearData() {
  try {
    await ElMessageBox.confirm(
      'Semua data anggaran rekap akan dihapus. Lanjutkan?',
      'Konfirmasi Hapus',
      { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
    )
  } catch {
    return
  }
  await api.delete('/sumber-data/anggaran', { params: { tahun: tahun.value } })
  rawData.value = []
  resetFilter()
  ElMessage.success('Data berhasil dihapus')
}
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Anggaran Rekap</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          {{ rawData.length }} baris &bull; Sumber: file rekap anggaran (rekap4/rekap5)
        </p>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <el-upload
          :auto-upload="false"
          :show-file-list="false"
          accept=".xlsx,.xls"
          :on-change="handleFileImport"
        >
          <el-button type="primary" :icon="Upload">Import Excel</el-button>
        </el-upload>
        <el-button type="danger" :icon="Delete" :disabled="rawData.length === 0" @click="clearData">
          Hapus Semua
        </el-button>
      </div>
    </div>

    <el-empty
      v-if="!loading && rawData.length === 0"
      description="Belum ada data. Import file Excel rekap anggaran untuk memulai."
      :image-size="120"
    />

    <template v-else>
      <!-- Filter -->
      <el-card style="margin-bottom:16px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
          <el-select
            v-model="filter.kodeSkpd"
            placeholder="Semua SKPD"
            clearable filterable
            style="width:250px;"
          >
            <el-option
              v-for="o in opsi.skpd"
              :key="o.kode"
              :label="o.nama || o.kode"
              :value="o.kode"
            >
              <span>{{ o.nama || o.kode }}</span>
              <span style="float:right; color:#c0c4cc; font-size:11px;">{{ o.jumlah }}</span>
            </el-option>
          </el-select>

          <el-select
            v-model="filter.kodeSubKegiatan"
            placeholder="Semua sub kegiatan"
            clearable filterable
            style="width:300px;"
          >
            <el-option
              v-for="o in opsi.subKegiatan"
              :key="o.kode"
              :label="labelKode(o)"
              :value="o.kode"
            />
          </el-select>

          <el-select
            v-model="filter.kodeRekening"
            placeholder="Semua rekening"
            clearable filterable
            style="width:300px;"
          >
            <el-option
              v-for="o in opsi.rekening"
              :key="o.kode"
              :label="labelKode(o)"
              :value="o.kode"
            />
          </el-select>

          <el-select
            v-model="filter.sumberDana"
            placeholder="Semua sumber dana"
            clearable filterable
            style="width:220px;"
          >
            <el-option
              v-for="o in opsi.sumberDana"
              :key="o.nama"
              :label="o.nama"
              :value="o.nama"
            >
              <span>{{ o.nama }}</span>
              <span style="float:right; color:#c0c4cc; font-size:11px;">{{ o.jumlah }}</span>
            </el-option>
          </el-select>

          <el-select
            v-if="opsi.paketKelompok.length"
            v-model="filter.paketKelompok"
            placeholder="Semua paket/kelompok"
            clearable filterable
            style="width:200px;"
          >
            <el-option
              v-for="o in opsi.paketKelompok"
              :key="o.kode"
              :label="labelKode(o)"
              :value="o.kode"
            />
          </el-select>

          <el-input
            v-model="filter.q"
            placeholder="Cari beberapa istilah dipisah koma, mis. 00060, 00059, listrik"
            :prefix-icon="Search"
            clearable
            style="width:320px;"
          />

          <el-button v-if="adaFilter" text type="primary" @click="resetFilter">Reset</el-button>
          <el-button :icon="Refresh" :loading="loading" @click="load" style="margin-left:auto;">
            Muat ulang
          </el-button>
        </div>

        <div style="margin-top:12px; display:flex; gap:22px; flex-wrap:wrap; font-size:12px; color:#606266;">
          <span>Baris: <strong>{{ filtered.length.toLocaleString('id-ID') }}</strong>
            <span v-if="adaFilter" style="color:#909399;"> dari {{ rawData.length.toLocaleString('id-ID') }}</span>
          </span>
          <span>Total pagu: <strong>{{ formatRp(totalTampil) }}</strong></span>
          <span v-if="summary">Sumber dana: <strong>{{ summary.sumberDana.length }}</strong></span>
        </div>
      </el-card>

      <!-- Rincian per sumber dana: hanya muncul saat ada filter aktif -->
      <el-card v-if="summary" shadow="never" style="margin-bottom:16px; border:1px solid #e4e7ed;">
        <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
          <div>
            <div style="font-size:12px; color:#67c23a; font-weight:600;">Total Anggaran (hasil filter)</div>
            <div style="font-size:22px; font-weight:700; font-variant-numeric:tabular-nums;">{{ formatRp(summary.total) }}</div>
          </div>
          <div style="font-size:12px; color:#909399;">{{ summary.sumberDana.length }} sumber dana</div>
        </div>
        <el-divider style="margin:12px 0;" />
        <div style="font-size:11px; color:#909399; font-weight:600; text-transform:uppercase; letter-spacing:.4px; margin-bottom:6px;">
          Per Sumber Dana
        </div>
        <div
          v-for="sd in summary.sumberDana"
          :key="(sd.kode || '') + sd.nama"
          style="display:flex; justify-content:space-between; gap:12px; padding:3px 0; border-bottom:1px dashed #f0f2f5;"
        >
          <span style="font-size:13px; color:#606266;">
            {{ sd.nama }}
            <span v-if="sd.kode" style="font-family:monospace; font-size:11px; color:#c0c4cc;">({{ sd.kode }})</span>
          </span>
          <span style="font-size:13px; font-variant-numeric:tabular-nums;">{{ formatRp(sd.pagu) }}</span>
        </div>
      </el-card>

      <el-table
        v-loading="loading"
        :data="paginated"
        border
        stripe
        size="small"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
      >
        <el-table-column type="index" :index="(currentPage - 1) * pageSize + 1" label="No" width="55" align="center" />
        <el-table-column label="Kode Sub Unit" prop="kode_sub_unit" width="200">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_unit }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Kode Sub Kegiatan" prop="kode_sub_kegiatan" width="170">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_kegiatan }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Sub Kegiatan" prop="nama_sub_kegiatan" min-width="220" show-overflow-tooltip />
        <el-table-column label="Paket/Kelompok" prop="paket_kelompok" width="130">
          <template #default="{ row }">
            <el-tag v-if="row.paket_kelompok" size="small" type="info">{{ row.paket_kelompok }}</el-tag>
            <span v-else style="color:#c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Paket/Kelompok" prop="nama_paket_kelompok" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.nama_paket_kelompok">{{ row.nama_paket_kelompok }}</span>
            <span v-else style="color:#c0c4cc;">—</span>
          </template>
        </el-table-column>
        <el-table-column label="Kode Rekening" prop="kode_rekening" width="170">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_rekening }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Rekening" prop="nama_rekening" min-width="200" show-overflow-tooltip />
        <el-table-column label="Sumber Dana" prop="nama_sumber_dana" width="140" show-overflow-tooltip>
          <template #default="{ row }">
            <span style="font-size:12px;">{{ row.nama_sumber_dana || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Pagu" prop="pagu" width="150" align="right">
          <template #default="{ row }">
            <span style="font-family:monospace; font-size:12px; font-variant-numeric:tabular-nums;">
              {{ Number(row.pagu || 0).toLocaleString('id-ID') }}
            </span>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        v-model:current-page="currentPage"
        v-model:page-size="pageSize"
        :page-sizes="[20, 50, 100, 200]"
        :total="filtered.length"
        layout="total, sizes, prev, pager, next"
        background
        style="margin-top:16px; justify-content:flex-end; display:flex;"
      />
    </template>
  </div>
</template>
