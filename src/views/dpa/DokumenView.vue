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

// Kolom jenis yang ditampilkan. Sengaja tidak ada status "lengkap" per dinas:
// tidak semua dinas punya pendapatan/pembiayaan (praktis hanya BPKAD sebagai
// SKPD sekaligus SKPKD), jadi hampir semua akan terbaca tidak lengkap.
const KUNCI_JENIS_DICEK = 'dpa-dokumen:jenis'
const jenisDicek = ref(JSON.parse(localStorage.getItem(KUNCI_JENIS_DICEK) || 'null') || JENIS.map(j => j.key))
watch(jenisDicek, v => localStorage.setItem(KUNCI_JENIS_DICEK, JSON.stringify(v)))
const jenisTampil = computed(() => JENIS.filter(j => jenisDicek.value.includes(j.key)))

const jadwalTerpilih = computed(() => jadwalList.value.find(j => j.id === jadwalId.value) || null)

// Target = sub kegiatan bernilai di DPA Belanja jadwal yang sama. Kalau DPA
// Belanja dinas itu belum terdownload (target null), rincian belum bisa
// dinilai lengkap.
function rincianLengkap(r) {
  const { terpenuhi, target } = r.rincian_belanja
  return target !== null && terpenuhi >= target
}

function adaJenis(r, key) {
  return key === 'rincian_belanja' ? rincianLengkap(r) : !!r[key]
}

const ringkasan = computed(() => ({
  total: baris.value.length,
  perJenis: Object.fromEntries(JENIS.map(j => [j.key, baris.value.filter(r => adaJenis(r, j.key)).length])),
}))

const tampil = computed(() => {
  const q = search.value.trim().toLowerCase()
  return baris.value.filter(r =>
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
const detail = ref({ buka: false, memuat: false, skpd: null, belanjaAda: true, data: [], jadwalLain: [], diluarTarget: [] })

async function bukaRincian(r) {
  detail.value = { buka: true, memuat: true, skpd: r, belanjaAda: true, data: [], jadwalLain: [], diluarTarget: [] }
  try {
    const { data } = await api.get('/dpa/kelengkapan/rincian', {
      params: { tahun: tahun.value, jadwal: jadwalId.value, idSkpd: r.id_skpd },
    })
    detail.value.belanjaAda = data.belanjaAda
    detail.value.data = data.data
    detail.value.jadwalLain = data.jadwalLain
    detail.value.diluarTarget = data.diluarTarget
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Gagal memuat rincian belanja')
  } finally {
    detail.value.memuat = false
  }
}

const detailBelum = computed(() => detail.value.data.filter(d => !d.synced_at).length)

function tipeRincian(r) {
  if (rincianLengkap(r)) return 'success'
  if (r.rincian_belanja.target === null) return 'info'
  return r.rincian_belanja.terpenuhi ? 'warning' : 'danger'
}

function tooltipRincian(r) {
  const rb = r.rincian_belanja
  const baris = []
  if (rb.target === null) baris.push('DPA Belanja jadwal ini belum terdownload — target belum diketahui')
  if (rb.target === null && rb.jumlah) baris.push(`${rb.jumlah} rincian sudah masuk`)
  if (rb.jadwal_lain) baris.push(`${rb.jadwal_lain} rincian kosong dari sub kegiatan jadwal lain`)
  if (rb.diluar_target) baris.push(`${rb.diluar_target} rincian tidak tercantum di DPA Belanja jadwal mana pun`)
  if (rb.synced_at) baris.push(`Terakhir: ${waktu(rb.synced_at)}`)
  return baris.join(' · ')
}

const rupiah = (n) => Number(n || 0).toLocaleString('id-ID')
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
              <template v-if="jadwalTerpilih.tanggal"> &bull; {{ new Date(`${jadwalTerpilih.tanggal}T00:00:00`).toLocaleDateString('id-ID', { dateStyle: 'long' }) }}</template>
            </div>
          </div>
          <div>
            <div style="font-size:12px; color:#909399; margin-bottom:6px;">Kolom yang ditampilkan</div>
            <el-checkbox-group v-model="jenisDicek" size="small">
              <el-checkbox v-for="j in JENIS" :key="j.key" :value="j.key">{{ j.label }}</el-checkbox>
            </el-checkbox-group>
          </div>
        </div>
      </el-card>

      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
        <el-tag v-for="j in jenisTampil" :key="j.key" type="info">
          {{ j.label }}: {{ ringkasan.perJenis[j.key] }} / {{ ringkasan.total }} dinas
        </el-tag>
      </div>

      <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px; flex-wrap:wrap;">
        <el-input v-model="search" placeholder="Cari kode / nama dinas..." :prefix-icon="Search" clearable style="max-width:360px;" />
        <span style="font-size:12px; color:#909399;">{{ tampil.length }} dinas ditampilkan</span>
      </div>

      <el-table
        v-loading="memuat"
        :data="tampil"
        border
        size="small"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
      >
        <el-table-column type="index" label="No" width="55" align="center" />
        <el-table-column label="Dinas" min-width="280">
          <template #default="{ row }">
            <el-tooltip content="Lihat dinas ini di semua jadwal" placement="top-start">
              <router-link
                :to="{ name: 'DpaDinas', params: { tahun }, query: { skpd: row.id_skpd } }"
                style="font-size:12px; color:#303133; text-decoration:none;"
              >{{ row.nama_skpd }}</router-link>
            </el-tooltip>
            <div style="font-family:monospace; font-size:11px; color:#909399;">
              {{ row.kode_skpd }}
              <el-tag v-if="!row.di_referensi" type="warning" size="small" style="margin-left:6px;">tidak ada di referensi SKPD</el-tag>
            </div>
          </template>
        </el-table-column>

        <el-table-column v-for="j in jenisTampil" :key="j.key" :label="j.label" :width="j.key === 'rincian_belanja' ? 140 : 110" align="center">
          <template #default="{ row }">
            <template v-if="j.key === 'rincian_belanja'">
              <el-tooltip :disabled="!tooltipRincian(row)" :content="tooltipRincian(row)">
                <el-button link :type="tipeRincian(row)" @click="bukaRincian(row)">
                  {{ row.rincian_belanja.terpenuhi }} / {{ row.rincian_belanja.target ?? '?' }}
                  <span v-if="row.rincian_belanja.diluar_target" style="font-size:11px; margin-left:2px;">+{{ row.rincian_belanja.diluar_target }}</span>
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
        Rincian Belanja = sub kegiatan yang rinciannya sudah terdownload / sub kegiatan yang tercantum
        (bernilai) di DPA Belanja dinas itu pada jadwal yang sama. <strong>?</strong> = DPA Belanja-nya
        belum terdownload, jadi targetnya belum diketahui. <strong>+n</strong> = rincian yang tidak
        tercantum di DPA Belanja jadwal mana pun pada tahun ini (rincian sub kegiatan yang dianggarkan di
        jadwal lain tidak dihitung). Klik angkanya untuk melihat sub kegiatan mana yang belum.
      </p>
    </template>

    <el-dialog v-model="detail.buka" :title="`Rincian Belanja — ${detail.skpd?.nama_skpd ?? ''}`" width="900px" top="6vh">
      <div v-loading="detail.memuat">
        <el-alert v-if="!detail.memuat && !detail.belanjaAda" type="warning" :closable="false" style="margin-bottom:12px;"
          title="DPA Belanja dinas ini untuk jadwal ini belum terdownload, jadi daftar sub kegiatan yang seharusnya ada belum diketahui." />
        <p v-else style="margin:0 0 12px; font-size:13px; color:#606266;">
          {{ detail.data.length - detailBelum }} dari {{ detail.data.length }} sub kegiatan di DPA Belanja sudah terdownload rinciannya
          <template v-if="detailBelum"> &bull; <strong style="color:#f56c6c;">{{ detailBelum }} belum</strong></template>
        </p>
        <el-table v-if="detail.belanjaAda" :data="detail.data" border size="small" max-height="55vh"
          :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }">
          <el-table-column label="Sub SKPD" prop="nama_sub_skpd" min-width="180" show-overflow-tooltip />
          <el-table-column label="Kode" prop="kode_sub_giat" width="170">
            <template #default="{ row }">
              <span style="font-family:monospace; font-size:11px;">{{ row.kode_sub_giat }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Sub Kegiatan" prop="nama_sub_giat" min-width="260" show-overflow-tooltip />
          <el-table-column label="Nilai DPA" width="130" align="right">
            <template #default="{ row }">
              <span style="font-family:monospace; font-size:11px; font-variant-numeric:tabular-nums;">{{ rupiah(row.nilai) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Status" width="150" align="center">
            <template #default="{ row }">
              <el-tag v-if="row.synced_at" type="success" size="small">{{ waktu(row.synced_at) }}</el-tag>
              <el-tag v-else type="danger" size="small">Belum</el-tag>
            </template>
          </el-table-column>
        </el-table>

        <template v-if="detail.jadwalLain.length">
          <p style="margin:16px 0 8px; font-size:13px; color:#909399;">
            Rincian kosong — sub kegiatannya dianggarkan di jadwal lain, bukan di jadwal ini ({{ detail.jadwalLain.length }}):
          </p>
          <el-table :data="detail.jadwalLain" border size="small" max-height="25vh" style="color:#909399;">
            <el-table-column label="Sub SKPD" prop="nama_sub_skpd" min-width="180" show-overflow-tooltip />
            <el-table-column label="Kode" prop="kode_sub_giat" width="170">
              <template #default="{ row }">
                <span style="font-family:monospace; font-size:11px;">{{ row.kode_sub_giat }}</span>
              </template>
            </el-table-column>
            <el-table-column label="Sub Kegiatan" prop="nama_sub_giat" min-width="220" show-overflow-tooltip />
            <el-table-column label="Dianggarkan di" prop="jadwal_lain" min-width="180" show-overflow-tooltip />
          </el-table>
        </template>

        <template v-if="detail.diluarTarget.length">
          <p style="margin:16px 0 8px; font-size:13px; color:#606266;">
            <template v-if="detail.belanjaAda">Terdownload tapi tidak tercantum di DPA Belanja jadwal mana pun</template>
            <template v-else>Rincian yang sudah terdownload</template>
            ({{ detail.diluarTarget.length }}):
          </p>
          <el-table :data="detail.diluarTarget" border size="small" max-height="25vh">
            <el-table-column label="Sub SKPD" prop="nama_sub_skpd" min-width="180" show-overflow-tooltip />
            <el-table-column label="Kode" prop="kode_sub_giat" width="170" />
            <el-table-column label="Sub Kegiatan" prop="nama_sub_giat" min-width="260" show-overflow-tooltip />
          </el-table>
        </template>
      </div>
    </el-dialog>
  </div>
</template>
