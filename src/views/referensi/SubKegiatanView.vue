<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, ArrowRight } from '@element-plus/icons-vue'
import { useAuthStore } from '../../stores/auth'
import api from '../../utils/api.js'

const route = useRoute()
const auth = useAuthStore()

const tahun = route.params.tahun
const loading = ref(false)
const subKegiatanList = ref([])
const deleting = ref(false)

// Group flat -> dinas (kode_skpd) -> unit SKPD (kode_sub_skpd), tanpa level urusan/program/kegiatan.
const groups = computed(() => {
  const map = new Map()
  for (const row of subKegiatanList.value) {
    const key = row.kode_skpd
    if (!map.has(key)) {
      map.set(key, { kode_skpd: row.kode_skpd, nama_skpd: row.nama_skpd, count: 0, units: new Map() })
    }
    const dinas = map.get(key)
    dinas.count++

    const unitKey = row.kode_sub_skpd
    if (!dinas.units.has(unitKey)) {
      dinas.units.set(unitKey, { kode_sub_skpd: row.kode_sub_skpd, nama_sub_skpd: row.nama_sub_skpd, items: [] })
    }
    dinas.units.get(unitKey).items.push(row)
  }

  return Array.from(map.values())
    .sort((a, b) => String(a.kode_skpd).localeCompare(String(b.kode_skpd), 'id'))
    .map(dinas => ({
      ...dinas,
      units: Array.from(dinas.units.values()).sort((a, b) => String(a.kode_sub_skpd).localeCompare(String(b.kode_sub_skpd), 'id')),
    }))
})

const expandedDinas = ref(new Set())
function toggleDinas(kode_skpd) {
  const next = new Set(expandedDinas.value)
  next.has(kode_skpd) ? next.delete(kode_skpd) : next.add(kode_skpd)
  expandedDinas.value = next
}

const expandedUnit = ref(new Set())
function unitKey(kode_skpd, kode_sub_skpd) {
  return `${kode_skpd}||${kode_sub_skpd}`
}
function toggleUnit(kode_skpd, kode_sub_skpd) {
  const key = unitKey(kode_skpd, kode_sub_skpd)
  const next = new Set(expandedUnit.value)
  next.has(key) ? next.delete(key) : next.add(key)
  expandedUnit.value = next
}

onMounted(() => fetchSubKegiatan())

async function fetchSubKegiatan() {
  loading.value = true
  try {
    const { data } = await api.get(`/referensi/sub-kegiatan?tahun=${tahun}`)
    subKegiatanList.value = data.data
  } catch {
    ElMessage.error('Gagal memuat data Sub Kegiatan')
  } finally {
    loading.value = false
  }
}

async function resetSubKegiatan() {
  try {
    await ElMessageBox.confirm(
      'Semua data Sub Kegiatan untuk tahun ini akan dihapus. Lanjutkan?',
      'Reset Sub Kegiatan',
      { confirmButtonText: 'Ya, Reset', cancelButtonText: 'Batal', type: 'warning' }
    )
  } catch {
    return
  }

  deleting.value = true
  try {
    await api.delete(`/referensi/sub-kegiatan?tahun=${tahun}`)
    subKegiatanList.value = []
    ElMessage.success('Data Sub Kegiatan berhasil direset')
  } catch {
    ElMessage.error('Gagal mereset data Sub Kegiatan')
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div>
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
      <div>
        <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">
          Referensi Sub Kegiatan
        </h2>
        <p style="margin: 4px 0 0; color: #909399; font-size: 13px;">
          Tahun Anggaran {{ tahun }}
        </p>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <el-button
          v-if="auth.isSuperadmin && subKegiatanList.length > 0"
          type="danger"
          plain
          size="small"
          :icon="Delete"
          :loading="deleting"
          @click="resetSubKegiatan"
        >
          Reset Sub Kegiatan
        </el-button>
      </div>
    </div>

    <el-alert
      v-if="subKegiatanList.length === 0"
      type="warning"
      :closable="false"
      style="margin-bottom: 20px;"
    >
      <template #title>
        Sub Kegiatan belum disinkronisasi untuk tahun {{ tahun }}
      </template>
      <template #default>
        <p style="margin: 8px 0 0; font-size: 13px; line-height: 1.6;">
          Gunakan <strong>browser extension SIPD</strong> untuk menarik data Sub Kegiatan dan kirim ke endpoint berikut:
        </p>
        <el-tag type="info" style="margin-top: 8px; font-family: monospace; font-size: 12px;">
          POST /api/sync/sub-kegiatan
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
        Sub Kegiatan tersinkronisasi — {{ subKegiatanList.length }} baris dari {{ groups.length }} dinas
      </template>
    </el-alert>

    <div v-loading="loading">
      <div
        v-for="dinas in groups"
        :key="dinas.kode_skpd"
        style="border: 1px solid #e4e7ed; border-radius: 4px; margin-bottom: 10px; background: #fff;"
      >
        <div
          style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; cursor: pointer; user-select: none;"
          @click="toggleDinas(dinas.kode_skpd)"
        >
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
            <el-icon
              :style="{
                transition: 'transform .2s',
                transform: expandedDinas.has(dinas.kode_skpd) ? 'rotate(90deg)' : 'none',
                color: '#606266',
              }"
            >
              <ArrowRight />
            </el-icon>
            <el-tag type="primary" size="small" effect="dark">Dinas</el-tag>
            <span style="font-weight: 600; font-size: 13px; color: #303133;">{{ dinas.nama_skpd }}</span>
            <span style="font-size: 11px; color: #909399; font-family: monospace;">{{ dinas.kode_skpd }}</span>
          </div>
          <el-tag type="danger" size="small" effect="plain">{{ dinas.count }} Sub Kegiatan</el-tag>
        </div>

        <div v-if="expandedDinas.has(dinas.kode_skpd)" style="border-top: 1px solid #f0f2f5; padding: 8px 12px;">
          <div
            v-for="unit in dinas.units"
            :key="unit.kode_sub_skpd"
            style="border: 1px solid #ebeef5; border-radius: 4px; margin-bottom: 8px;"
          >
            <div
              style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; cursor: pointer; user-select: none;"
              @click="toggleUnit(dinas.kode_skpd, unit.kode_sub_skpd)"
            >
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <el-icon
                  :style="{
                    transition: 'transform .2s',
                    transform: expandedUnit.has(unitKey(dinas.kode_skpd, unit.kode_sub_skpd)) ? 'rotate(90deg)' : 'none',
                    color: '#909399',
                  }"
                >
                  <ArrowRight />
                </el-icon>
                <el-tag type="success" size="small" effect="dark">Unit SKPD</el-tag>
                <span style="font-weight: 600; font-size: 12px; color: #303133;">{{ unit.nama_sub_skpd }}</span>
                <span style="font-size: 11px; color: #909399; font-family: monospace;">{{ unit.kode_sub_skpd }}</span>
              </div>
              <el-tag type="danger" size="small" effect="plain">{{ unit.items.length }} Sub Kegiatan</el-tag>
            </div>

            <div
              v-if="expandedUnit.has(unitKey(dinas.kode_skpd, unit.kode_sub_skpd))"
              style="border-top: 1px solid #f5f7fa; padding: 8px 10px;"
            >
              <el-table :data="unit.items" size="small" style="width: 100%;">
                <el-table-column prop="kode_program" label="Kode Program" width="140" />
                <el-table-column prop="nama_program" label="Nama Program" min-width="200" show-overflow-tooltip />
                <el-table-column prop="kode_giat" label="Kode Kegiatan" width="140" />
                <el-table-column prop="nama_giat" label="Nama Kegiatan" min-width="200" show-overflow-tooltip />
                <el-table-column prop="kode_sub_giat" label="Kode Sub Kegiatan" width="200" />
                <el-table-column prop="nama_sub_giat" label="Nama Sub Kegiatan" min-width="280" show-overflow-tooltip />
              </el-table>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
