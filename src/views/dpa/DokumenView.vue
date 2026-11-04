<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Refresh, Search, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '../../utils/api.js'

// Halaman pantau saja: dinas mana, di jadwal mana, yang DPA-nya sudah/belum
// terdownload lewat penat-extension. Tidak ada aksi tulis di sini.

const JENIS = [
  { key: 'persetujuan_depan', label: 'Persetujuan' },
  { key: 'skpd', label: 'DPA SKPD' },
  { key: 'pendapatan', label: 'Pendapatan' },
  { key: 'belanja', label: 'Belanja' },
  { key: 'pembiayaan', label: 'Pembiayaan' },
  { key: 'rincian_belanja', label: 'Rincian Belanja' },
]

const route = useRoute()
const router = useRouter()
const tahun = computed(() => route.params.tahun)

const jadwalList = ref([])
const jumlahSkpd = ref(0)
// Jadwal awal bisa dibawa dari halaman Jadwal lewat ?jadwal=<id>.
const jadwalId = ref(route.query.jadwal || null)
const baris = ref([])
const memuat = ref(false)
const search = ref('')
const hanyaBelum = ref(false)

// Tidak semua dinas punya pendapatan/pembiayaan — kalau extension tidak
// mengirim halaman kosong, jenis itu boleh dikeluarkan dari hitungan lengkap.
const KUNCI_JENIS_DICEK = 'dpa-dokumen:jenis'
const jenisDicek = ref(JSON.parse(localStorage.getItem(KUNCI_JENIS_DICEK) || 'null') || JENIS.map(j => j.key))
watch(jenisDicek, v => localStorage.setItem(KUNCI_JENIS_DICEK, JSON.stringify(v)))
const jenisTampil = computed(() => JENIS.filter(j => jenisDicek.value.includes(j.key)))

const jadwalTerpilih = computed(() => jadwalList.value.find(j => j.id === jadwalId.value) || null)

function rincianLengkap(r) {
  const { jumlah, target } = r.rincian_belanja
  return target > 0 ? jumlah >= target : jumlah > 0
}

function adaJenis(r, key) {
  return key === 'rincian_belanja' ? rincianLengkap(r) : !!r[key]
}

function lengkap(r) {
  return jenisDicek.value.every(key => adaJenis(r, key))
}

const ringkasan = computed(() => ({
  lengkap: baris.value.filter(lengkap).length,
  total: baris.value.length,
  perJenis: Object.fromEntries(JENIS.map(j => [j.key, baris.value.filter(r => adaJenis(r, j.key)).length])),
}))

const tampil = computed(() => {
  const q = search.value.trim().toLowerCase()
  return baris.value.filter(r =>
    (!hanyaBelum.value || !lengkap(r)) &&
    (!q || r.nama_skpd?.toLowerCase().includes(q) || r.kode_skpd?.toLowerCase().includes(q))
  )
})

function waktu(val) {
  if (!val) return ''
  return new Date(val).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}

async function muatJadwal() {
  const { data } = await api.get('/dpa/jadwal', { params: { tahun: tahun.value } })
  jadwalList.value = data.data
  jumlahSkpd.value = data.jumlahSkpd
  if (!jadwalList.value.some(j => j.id === jadwalId.value))
    jadwalId.value = (jadwalList.value.find(j => j.aktif) || jadwalList.value[0])?.id ?? null
}

async function muatKelengkapan() {
  if (!jadwalId.value) { baris.value = []; return }
  const { data } = await api.get('/dpa/kelengkapan', { params: { tahun: tahun.value, jadwal: jadwalId.value } })
  baris.value = data.data
}

async function muatUlang() {
  memuat.value = true
  try {
    await muatJadwal()
    await muatKelengkapan()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Gagal memuat data DPA')
  } finally {
    memuat.value = false
  }
}

watch(jadwalId, async (baru, lama) => {
  // Simpan pilihan di URL supaya muat ulang / bagikan tautan tetap di jadwal yang sama.
  if (baru && route.query.jadwal !== baru) router.replace({ query: { ...route.query, jadwal: baru } })
  if (lama === null || baru === lama) return
  memuat.value = true
  try { await muatKelengkapan() } finally { memuat.value = false }
})

onMounted(muatUlang)

// ---- Detail rincian belanja per dinas ----
const detail = ref({ buka: false, memuat: false, skpd: null, data: [], diluarReferensi: [] })

async function bukaRincian(r) {
  detail.value = { buka: true, memuat: true, skpd: r, data: [], diluarReferensi: [] }
  try {
    const { data } = await api.get('/dpa/kelengkapan/rincian', {
      params: { tahun: tahun.value, jadwal: jadwalId.value, idSkpd: r.id_skpd },
    })
    detail.value.data = data.data
    detail.value.diluarReferensi = data.diluarReferensi
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Gagal memuat rincian belanja')
  } finally {
    detail.value.memuat = false
  }
}

const detailBelum = computed(() => detail.value.data.filter(d => !d.synced_at).length)
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Dokumen DPA</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          Cek dokumen DPA tiap dinas per jadwal yang sudah terdownload dari penat-extension
        </p>
      </div>
      <el-button :icon="Refresh" :loading="memuat" @click="muatUlang">Muat Ulang</el-button>
    </div>

    <el-empty
      v-if="!memuat && jadwalList.length === 0"
      :image-size="120"
      description="Belum ada jadwal. Tekan Fetch Jadwal di penat-extension untuk mengirim jadwal dan Tim TAPD."
    />

    <template v-else>
      <el-card shadow="never" style="margin-bottom:16px;">
        <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-start;">
          <div style="flex:1; min-width:320px;">
            <div style="font-size:12px; color:#909399; margin-bottom:6px;">Jadwal</div>
            <el-select v-model="jadwalId" filterable style="width:100%;" placeholder="Pilih jadwal">
              <el-option v-for="j in jadwalList" :key="j.id" :value="j.id" :label="j.nama">
                <div style="display:flex; justify-content:space-between; gap:16px;">
                  <span style="overflow:hidden; text-overflow:ellipsis;" :style="j.aktif ? {} : { color: '#c0c4cc' }">
                    {{ j.nama }}<template v-if="!j.aktif"> (nonaktif)</template>
                  </span>
                  <span style="color:#909399; font-size:12px; white-space:nowrap;">
                    DPA {{ j.belanja }}/{{ jumlahSkpd }} dinas
                  </span>
                </div>
              </el-option>
            </el-select>
            <div v-if="jadwalTerpilih" style="font-size:12px; color:#909399; margin-top:6px;">
              {{ jadwalTerpilih.tahapan }}
            </div>
          </div>
          <div>
            <div style="font-size:12px; color:#909399; margin-bottom:6px;">Jenis yang dicek</div>
            <el-checkbox-group v-model="jenisDicek" size="small">
              <el-checkbox v-for="j in JENIS" :key="j.key" :value="j.key">{{ j.label }}</el-checkbox>
            </el-checkbox-group>
          </div>
        </div>
      </el-card>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
        <el-tag :type="ringkasan.lengkap === ringkasan.total && ringkasan.total ? 'success' : 'warning'" size="large">
          Lengkap {{ ringkasan.lengkap }} / {{ ringkasan.total }} dinas
        </el-tag>
        <el-tag v-for="j in jenisTampil" :key="j.key" type="info">
          {{ j.label }}: {{ ringkasan.perJenis[j.key] }}
        </el-tag>
      </div>

      <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; flex-wrap:wrap;">
        <el-input v-model="search" placeholder="Cari kode / nama dinas..." :prefix-icon="Search" clearable style="max-width:360px;" />
        <el-switch v-model="hanyaBelum" active-text="Hanya yang belum lengkap" />
        <span style="font-size:12px; color:#909399;">{{ tampil.length }} dinas ditampilkan</span>
      </div>

      <el-table
        v-loading="memuat"
        :data="tampil"
        border
        size="small"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
        :row-style="({ row }) => lengkap(row) ? {} : { background: '#fef6f6' }"
      >
        <el-table-column type="index" label="No" width="55" align="center" />
        <el-table-column label="Dinas" min-width="280">
          <template #default="{ row }">
            <div style="font-size:12px; color:#303133;">{{ row.nama_skpd }}</div>
            <div style="font-family:monospace; font-size:11px; color:#909399;">
              {{ row.kode_skpd }}
              <el-tag v-if="!row.di_referensi" type="warning" size="small" style="margin-left:6px;">tidak ada di referensi SKPD</el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column v-for="j in jenisTampil" :key="j.key" :label="j.label" :width="j.key === 'rincian_belanja' ? 140 : 110" align="center">
          <template #default="{ row }">
            <template v-if="j.key === 'rincian_belanja'">
              <el-tooltip :disabled="!row.rincian_belanja.synced_at" :content="`Terakhir: ${waktu(row.rincian_belanja.synced_at)}`">
                <el-button
                  link
                  :type="rincianLengkap(row) ? 'success' : row.rincian_belanja.jumlah ? 'warning' : 'danger'"
                  @click="bukaRincian(row)"
                >
                  {{ row.rincian_belanja.jumlah }} / {{ row.rincian_belanja.target }}
                </el-button>
              </el-tooltip>
            </template>
            <el-tooltip v-else-if="row[j.key]" :content="waktu(row[j.key])">
              <el-icon color="#67c23a" :size="18"><CircleCheckFilled /></el-icon>
            </el-tooltip>
            <el-icon v-else color="#f56c6c" :size="18"><CircleCloseFilled /></el-icon>
          </template>
        </el-table-column>
      </el-table>

      <p style="font-size:12px; color:#909399; margin-top:10px; line-height:1.6;">
        Rincian Belanja = jumlah sub kegiatan yang sudah terdownload / jumlah sub kegiatan dinas itu di
        referensi Sub Kegiatan. Referensi itu tidak terikat jadwal, jadi pada jadwal pergeseran angkanya
        bisa sedikit berbeda. Klik angkanya untuk melihat sub kegiatan mana yang belum.
      </p>
    </template>

    <el-dialog v-model="detail.buka" :title="`Rincian Belanja — ${detail.skpd?.nama_skpd ?? ''}`" width="900px" top="6vh">
      <div v-loading="detail.memuat">
        <p style="margin:0 0 12px; font-size:13px; color:#606266;">
          {{ detail.data.length - detailBelum }} dari {{ detail.data.length }} sub kegiatan sudah terdownload
          <template v-if="detailBelum"> &bull; <strong style="color:#f56c6c;">{{ detailBelum }} belum</strong></template>
        </p>
        <el-table :data="detail.data" border size="small" max-height="55vh"
          :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }">
          <el-table-column label="Sub SKPD" prop="nama_sub_skpd" min-width="180" show-overflow-tooltip />
          <el-table-column label="Kode" prop="kode_sub_giat" width="170">
            <template #default="{ row }">
              <span style="font-family:monospace; font-size:11px;">{{ row.kode_sub_giat }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Sub Kegiatan" prop="nama_sub_giat" min-width="260" show-overflow-tooltip />
          <el-table-column label="Status" width="150" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.synced_at" type="success" size="small">{{ waktu(row.synced_at) }}</el-tag>
              <el-tag v-else type="danger" size="small">Belum</el-tag>
            </template>
          </el-table-column>
        </el-table>

        <template v-if="detail.diluarReferensi.length">
          <p style="margin:16px 0 8px; font-size:13px; color:#606266;">
            Terdownload tapi tidak ada di referensi Sub Kegiatan ({{ detail.diluarReferensi.length }}):
          </p>
          <el-table :data="detail.diluarReferensi" border size="small" max-height="25vh">
            <el-table-column label="Sub SKPD" prop="nama_sub_skpd" min-width="180" show-overflow-tooltip />
            <el-table-column label="Kode" prop="kode_sub_giat" width="170" />
            <el-table-column label="Sub Kegiatan" prop="nama_sub_giat" min-width="260" show-overflow-tooltip />
          </el-table>
        </template>
      </div>
    </el-dialog>
  </div>
</template>
