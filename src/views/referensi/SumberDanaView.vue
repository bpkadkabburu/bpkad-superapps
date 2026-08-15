<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Search, ArrowRight, Expand, Fold, Lock } from '@element-plus/icons-vue'
import { useAuthStore } from '../../stores/auth'
import api from '../../utils/api.js'

const route = useRoute()
const auth = useAuthStore()

const tahun = route.params.tahun
const loading = ref(false)
const sumberDanaList = ref([])
const deleting = ref(false)
const keyword = ref('')

// Bandingkan kode dana per segmen ("1.1.01" -> [1, 1, 1]) supaya "10" tidak
// jatuh sebelum "2" seperti pada perbandingan string biasa.
function compareKode(a, b) {
  const segA = String(a ?? '').split('.')
  const segB = String(b ?? '').split('.')
  for (let i = 0; i < Math.max(segA.length, segB.length); i++) {
    const na = Number(segA[i] ?? -1)
    const nb = Number(segB[i] ?? -1)
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const cmp = String(segA[i] ?? '').localeCompare(String(segB[i] ?? ''), 'id')
      if (cmp !== 0) return cmp
    } else if (na !== nb) {
      return na - nb
    }
  }
  return 0
}

function levelOf(kode) {
  return String(kode ?? '').split('.').length
}

// Susun hierarki dari kode dana: induk = kode tanpa segmen terakhir.
// Catatan: SIPD bisa mengirim kode_dana kembar dengan id_dana berbeda
// (mis. 2.2.01.09.001.00118 muncul dua kali di TA 2026). Karena itu identitas
// baris memakai `id` dari DB, sementara peta kode->induk cukup memegang entri
// pertama; baris kembar tetap ikut tampil sebagai saudara di induk yang sama.
const tree = computed(() => {
  const byKode = new Map()
  const nodes = []
  for (const row of sumberDanaList.value) {
    const node = { ...row, level: levelOf(row.kode_dana), children: [] }
    nodes.push(node)
    if (!byKode.has(row.kode_dana)) byKode.set(row.kode_dana, node)
  }

  const roots = []
  for (const node of nodes) {
    const kode = String(node.kode_dana ?? '')
    const dot = kode.lastIndexOf('.')
    const parent = dot === -1 ? null : byKode.get(kode.slice(0, dot))
    // Baris yang induknya tidak ada di data tetap tampil sebagai akar,
    // supaya tidak ada data yang hilang diam-diam.
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }

  const sortRec = (list) => {
    list.sort((a, b) => compareKode(a.kode_dana, b.kode_dana))
    for (const n of list) sortRec(n.children)
    return list
  }
  return sortRec(roots)
})

const expanded = ref(new Set())

function toggle(row) {
  if (!row.childCount) return
  const next = new Set(expanded.value)
  next.has(row.id) ? next.delete(row.id) : next.add(row.id)
  expanded.value = next
}

function expandAll() {
  const next = new Set()
  const walk = (list) => {
    for (const n of list) {
      if (n.children.length) { next.add(n.id); walk(n.children) }
    }
  }
  walk(tree.value)
  expanded.value = next
}

function collapseAll() {
  expanded.value = new Set()
}

// Ratakan pohon jadi daftar sesuai simpul yang sedang terbuka. Kedalaman
// dipakai langsung untuk padding, bukan lewat mode tree el-table.
//
// PENTING: `children` sengaja dibuang dari baris hasil. Element Plus memakai
// properti bernama `children` sebagai penanda data pohon begitu `row-key`
// diset (tanpa perlu `tree-props`), jadi kalau ikut terbawa, el-table akan
// menggambar panah expand-nya sendiri di kiri sel dan isi sel terdorong ke
// baris kedua. Jumlah anak cukup dibawa sebagai angka.
const rows = computed(() => {
  const out = []
  const walk = (list, depth) => {
    for (const node of list) {
      const { children, ...rest } = node
      out.push({ ...rest, depth, childCount: children.length })
      if (children.length && expanded.value.has(node.id)) walk(children, depth + 1)
    }
  }
  walk(tree.value, 0)
  return out
})

// Saat mencari, tampilkan hasil datar — lebih mudah dibaca daripada pohon terpotong.
const hasil = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  if (!q) return []
  return sumberDanaList.value
    .filter(row =>
      String(row.kode_dana ?? '').toLowerCase().includes(q) ||
      String(row.nama_dana ?? '').toLowerCase().includes(q) ||
      String(row.sumber_dana ?? '').toLowerCase().includes(q)
    )
    .map(row => ({ ...row, level: levelOf(row.kode_dana) }))
    .sort((a, b) => compareKode(a.kode_dana, b.kode_dana))
})

const kelompokCount = computed(() => tree.value.length)
const maxLevel = computed(() =>
  sumberDanaList.value.reduce((m, r) => Math.max(m, levelOf(r.kode_dana)), 0)
)

onMounted(() => fetchSumberDana())

async function fetchSumberDana() {
  loading.value = true
  try {
    const { data } = await api.get(`/referensi/sumber-dana?tahun=${tahun}`)
    sumberDanaList.value = data.data
    // Buka level teratas supaya tabel tidak tampak kosong saat pertama dibuka.
    expanded.value = new Set(tree.value.filter(n => n.children.length).map(n => n.id))
  } catch {
    ElMessage.error('Gagal memuat data Sumber Dana')
  } finally {
    loading.value = false
  }
}

async function resetSumberDana() {
  try {
    await ElMessageBox.confirm(
      'Semua data Sumber Dana untuk tahun ini akan dihapus. Lanjutkan?',
      'Reset Sumber Dana',
      { confirmButtonText: 'Ya, Reset', cancelButtonText: 'Batal', type: 'warning' }
    )
  } catch {
    return
  }

  deleting.value = true
  try {
    await api.delete(`/referensi/sumber-dana?tahun=${tahun}`)
    sumberDanaList.value = []
    expanded.value = new Set()
    ElMessage.success('Data Sumber Dana berhasil direset')
  } catch {
    ElMessage.error('Gagal mereset data Sumber Dana')
  } finally {
    deleting.value = false
  }
}

const LEVEL_TAG = { 1: 'primary', 2: 'success', 3: 'warning', 4: 'danger', 5: 'info', 6: 'info' }
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; gap: 12px; flex-wrap: wrap;">
      <div>
        <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">
          Referensi Sumber Dana
        </h2>
        <p style="margin: 4px 0 0; color: #909399; font-size: 13px;">
          Tahun Anggaran {{ tahun }}
        </p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <template v-if="sumberDanaList.length > 0">
          <el-input
            v-model="keyword"
            placeholder="Cari kode / nama dana"
            size="small"
            clearable
            :prefix-icon="Search"
            style="width: 240px;"
          />
          <el-button v-if="!keyword.trim()" size="small" :icon="Expand" @click="expandAll">Buka Semua</el-button>
          <el-button v-if="!keyword.trim()" size="small" :icon="Fold" @click="collapseAll">Tutup Semua</el-button>
        </template>
        <el-button
          v-if="auth.isSuperadmin && sumberDanaList.length > 0"
          type="danger"
          plain
          size="small"
          :icon="Delete"
          :loading="deleting"
          @click="resetSumberDana"
        >
          Reset Sumber Dana
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="sumberDanaList.length === 0"
      type="warning"
      :closable="false"
      style="margin-bottom: 20px;"
    >
      <template #title>
        Sumber Dana belum disinkronisasi untuk tahun {{ tahun }}
      </template>
      <template #default>
        <p style="margin: 8px 0 0; font-size: 13px; line-height: 1.6;">
          Gunakan <strong>browser extension SIPD</strong> untuk menarik data Sumber Dana dan kirim ke endpoint berikut:
        </p>
        <el-tag type="info" style="margin-top: 8px; font-family: monospace; font-size: 12px;">
          POST /api/sync/sumber-dana
        </el-tag>
        <p style="margin: 8px 0 0; font-size: 12px; color: #909399;">
          Body: <code>&#123; "tahun": {{ tahun }}, "data": [...] &#125;</code>
          &nbsp;&bull;&nbsp;
          X-API-Key: &lt;api key&gt;
        </p>
      </template>
    </el-alert>

    <el-alert
      v-else
      type="success"
      :closable="false"
      style="margin-bottom: 20px;"
    >
      <template #title>
        Sumber Dana tersinkronisasi — {{ sumberDanaList.length }} baris,
        {{ kelompokCount }} kelompok dana, {{ maxLevel }} level
      </template>
    </el-alert>

    <div v-if="keyword.trim()" v-loading="loading">
      <p style="margin: 0 0 8px; font-size: 12px; color: #909399;">
        {{ hasil.length }} hasil untuk "{{ keyword.trim() }}"
      </p>
      <el-table :data="hasil" row-key="id" size="small" style="width: 100%;">
        <el-table-column label="Level" width="70" align="center">
          <template #default="{ row }">
            <el-tag :type="LEVEL_TAG[row.level] || 'info'" size="small" effect="plain">{{ row.level }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Kode Dana" width="190">
          <template #default="{ row }">
            <span style="font-family: monospace; font-size: 12px;">{{ row.kode_dana }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Nama Dana" min-width="320" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.nama_dana }}</span>
            <el-icon v-if="row.is_locked" style="margin-left: 6px; color: #c0c4cc; vertical-align: -2px;" title="Terkunci">
              <Lock />
            </el-icon>
          </template>
        </el-table-column>
        <el-table-column prop="set_input" label="Set Input" width="100" align="center" />
      </el-table>
    </div>

    <div v-else v-loading="loading">
      <el-table
        :data="rows"
        row-key="id"
        size="small"
        style="width: 100%;"
        @row-click="toggle"
      >
        <el-table-column label="Kode Dana" width="260">
          <template #default="{ row }">
            <div
              style="display: flex; align-items: center; gap: 5px; white-space: nowrap;"
              :style="{ paddingLeft: row.depth * 16 + 'px', cursor: row.childCount ? 'pointer' : 'default' }"
            >
              <el-icon
                v-if="row.childCount"
                :style="{
                  flex: 'none',
                  transition: 'transform .2s',
                  transform: expanded.has(row.id) ? 'rotate(90deg)' : 'none',
                  color: '#c0c4cc',
                  fontSize: '11px',
                }"
              >
                <ArrowRight />
              </el-icon>
              <span v-else style="flex: none; width: 11px;"></span>
              <span style="font-family: monospace; font-size: 12px; color: #606266;">{{ row.kode_dana }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Nama Dana" min-width="320" show-overflow-tooltip>
          <template #default="{ row }">
            <span :style="{ fontWeight: row.depth === 0 ? 700 : row.depth === 1 ? 600 : 400 }">
              {{ row.nama_dana }}
            </span>
            <span v-if="row.childCount" style="margin-left: 8px; font-size: 12px; color: #c0c4cc;">
              {{ row.childCount }}
            </span>
            <el-icon v-if="row.is_locked" style="margin-left: 6px; color: #c0c4cc; vertical-align: -2px;" title="Terkunci">
              <Lock />
            </el-icon>
          </template>
        </el-table-column>
        <el-table-column prop="set_input" label="Set Input" width="100" align="center" />
      </el-table>
    </div>
  </div>
</template>
