<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Refresh, CircleCheckFilled, CircleCloseFilled, Remove, QuestionFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '../../utils/api.js'

// Kebalikan halaman Dokumen: satu dinas, semua jadwal tahun itu. Baris =
// jenis dokumen (rincian belanja dipecah per sub kegiatan), kolom = jadwal
// dari yang pertama ke yang terakhir. Hanya baca.

const JENIS = [
  { key: 'persetujuan_depan', label: 'Persetujuan' },
  { key: 'skpd', label: 'DPA SKPD' },
  { key: 'pendapatan', label: 'Pendapatan' },
  { key: 'belanja', label: 'Belanja' },
  { key: 'rincian_belanja', label: 'Rincian Belanja' },
  { key: 'pembiayaan', label: 'Pembiayaan' },
]

const route = useRoute()
const router = useRouter()
const tahun = computed(() => route.params.tahun)

const dinasList = ref([])
// Dinas bisa dibawa dari halaman Dokumen lewat ?skpd=<id_skpd>.
const idSkpd = ref(route.query.skpd ? Number(route.query.skpd) : null)
const hasil = ref(null)
const memuat = ref(false)
const tampilNonaktif = ref(false)
const hanyaKurang = ref(false)

const jadwalTampil = computed(() => {
  const semua = hasil.value?.jadwal ?? []
  const aktif = semua.filter(j => j.aktif)
  return tampilNonaktif.value || !aktif.length ? semua : aktif
})
const adaNonaktif = computed(() => (hasil.value?.jadwal ?? []).some(j => !j.aktif))

const belanjaAda = (jid) => !!hasil.value?.dokumen.belanja[jid]

// Sub kegiatan "kurang" di satu jadwal = tercantum di DPA Belanja jadwal itu
// tapi rinciannya belum masuk.
const kurangDi = (s, jid) => s.sel[jid]?.status === 'belum'

function ringkasRincian(jid) {
  const sub = hasil.value?.rincian ?? []
  if (!belanjaAda(jid)) return { target: null, masuk: sub.filter(s => s.sel[jid]).length }
  const target = sub.filter(s => ['ada', 'belum'].includes(s.sel[jid]?.status))
  return { target: target.length, terpenuhi: target.filter(s => s.sel[jid].status === 'ada').length }
}

const baris = computed(() => {
  if (!hasil.value) return []
  const sub = hasil.value.rincian
    .filter(s => !hanyaKurang.value || jadwalTampil.value.some(j => kurangDi(s, j.id)))
    .map(s => ({ ...s, key: `sub:${s.nama_sub_skpd}:${s.kode_sub_giat}`, tipe: 'sub' }))
  return JENIS.map((j, i) => j.key === 'rincian_belanja'
    ? { key: j.key, no: i + 1, label: j.label, tipe: 'rincian', children: sub }
    : { key: j.key, no: i + 1, label: j.label, tipe: 'dokumen' })
})

// Tidak ada hitungan "dokumen belum ada": pendapatan/pembiayaan memang tidak
// dimiliki semua dinas, jadi hitungannya menyesatkan. Yang dihitung hanya sub
// kegiatan yang tercantum di DPA Belanja tapi rinciannya belum masuk.
const kurangSub = computed(() =>
  (hasil.value?.rincian ?? []).filter(s => jadwalTampil.value.some(j => kurangDi(s, j.id))).length)

function waktu(val) {
  if (!val) return ''
  return new Date(val).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}
const rupiah = (n) => Number(n || 0).toLocaleString('id-ID')
// 'YYYY-MM-DD' dibaca sebagai tanggal lokal, bukan UTC, supaya tidak bergeser hari.
const tanggalPendek = (t) => new Date(`${t}T00:00:00`).toLocaleDateString('id-ID', { dateStyle: 'medium' })

function tipeRincian(r) {
  if (r.target === null) return 'info'
  if (r.terpenuhi >= r.target) return 'success'
  return r.terpenuhi ? 'warning' : 'danger'
}

function tooltipSub(s, jid) {
  const sel = s.sel[jid]
  if (!sel) return belanjaAda(jid)
    ? 'Tidak tercantum (bernilai) di DPA Belanja jadwal ini'
    : 'DPA Belanja jadwal ini belum terdownload'
  const nilai = sel.nilai !== undefined ? ` · Nilai DPA ${rupiah(sel.nilai)}` : ''
  if (sel.status === 'ada') return `Rincian masuk ${waktu(sel.synced_at)}${nilai}`
  if (sel.status === 'belum') return `Tercantum di DPA Belanja, rincian belum terdownload${nilai}`
  if (sel.status === 'diluar') return `Rincian masuk ${waktu(sel.synced_at)}, tapi sub kegiatan ini tidak tercantum (bernilai) di DPA Belanja jadwal ini`
  return `Rincian masuk ${waktu(sel.synced_at)} · DPA Belanja jadwal ini belum terdownload, jadi belum bisa dicocokkan`
}

async function muatDinas() {
  const { data } = await api.get('/referensi/skpd',{ params: { tahun: tahun.value } })
  dinasList.value = data.data.filter(s => s.is_skpd)
  if (!dinasList.value.some(s => Number(s.id_skpd) === idSkpd.value)) idSkpd.value = null
}

async function muatPerDinas() {
  if (!idSkpd.value) { hasil.value = null; return }
  const { data } = await api.get('/dpa/per-dinas', { params: { tahun: tahun.value, idSkpd: idSkpd.value } })
  hasil.value = data
}

async function muatUlang() {
  memuat.value = true
  try {
    await muatDinas()
    await muatPerDinas()
  } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Gagal memuat data DPA')
  } finally {
    memuat.value = false
  }
}

watch(idSkpd, async (baru) => {
  if (route.query.skpd !== String(baru ?? ''))
    router.replace({ query: { ...route.query, skpd: baru ?? undefined } })
  memuat.value = true
  try { await muatPerDinas() } catch (err) {
    ElMessage.error(err.response?.data?.error || 'Gagal memuat data DPA')
  } finally { memuat.value = false }
})

onMounted(muatUlang)
</script>

<template>
  <div>
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:700; color:#303133;">Dokumen DPA per Dinas</h2>
        <p style="margin:4px 0 0; font-size:13px; color:#909399;">
          Dokumen mana yang belum terdownload di jadwal mana, untuk satu dinas
        </p>
      </div>
      <el-button :icon="Refresh" :loading="memuat" @click="muatUlang">Muat Ulang</el-button>
    </div>

    <el-card shadow="never" style="margin-bottom:16px;">
      <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end;">
        <div style="flex:1; min-width:320px;">
          <div style="font-size:12px; color:#909399; margin-bottom:6px;">Dinas</div>
          <el-select v-model="idSkpd" filterable style="width:100%;" placeholder="Pilih dinas">
            <el-option v-for="s in dinasList" :key="s.id_skpd" :value="Number(s.id_skpd)" :label="`${s.kode_skpd} ${s.nama_skpd}`" />
          </el-select>
        </div>
        <el-switch v-if="adaNonaktif" v-model="tampilNonaktif" active-text="Tampilkan jadwal nonaktif" />
        <el-switch v-model="hanyaKurang" active-text="Sub kegiatan yang kurang saja" />
      </div>
    </el-card>

    <el-empty v-if="!memuat && !hasil" :image-size="120" description="Pilih dinas untuk melihat dokumennya di tiap jadwal." />

    <template v-else-if="hasil">
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px;">
        <el-tag :type="kurangSub ? 'warning' : 'success'" size="large">
          {{ kurangSub ? `${kurangSub} sub kegiatan rinciannya belum masuk` : 'Semua sub kegiatan di DPA Belanja sudah ada rinciannya' }}
        </el-tag>
        <el-tag type="info">{{ jadwalTampil.length }} jadwal</el-tag>
      </div>

      <el-table
        v-loading="memuat"
        :data="baris"
        row-key="key"
        default-expand-all
        border
        size="small"
        max-height="70vh"
        style="width:100%;"
        :header-cell-style="{ background:'#f5f7fa', color:'#606266', fontSize:'12px', fontWeight:'600' }"
      >
        <el-table-column label="Dokumen" min-width="420" fixed="left" class-name="kolom-dokumen">
          <template #default="{ row }">
            <span v-if="row.tipe !== 'sub'" style="font-weight:600; color:#303133;">{{ row.no }}. {{ row.label }}</span>
            <span v-else style="display:flex; flex-direction:column; flex:1; min-width:0;">
              <span style="font-size:12px; color:#303133;">
                <span style="font-family:monospace; font-size:11px; color:#606266;">{{ row.kode_sub_giat }}</span>
                {{ row.nama_sub_giat }}
              </span>
              <span style="font-size:11px; color:#909399;">{{ row.nama_sub_skpd }}</span>
            </span>
          </template>
        </el-table-column>

        <el-table-column v-for="j in jadwalTampil" :key="j.id" min-width="120" align="center">
          <template #header>
            <el-tooltip :content="j.tahapan || j.nama">
              <span style="font-size:11px; line-height:1.3; white-space:normal; word-break:break-word;" :style="j.aktif ? {} : { color:'#c0c4cc' }">
                {{ j.nama }}
                <span v-if="j.tanggal" style="display:block; font-weight:400; color:#909399;">{{ tanggalPendek(j.tanggal) }}</span>
              </span>
            </el-tooltip>
          </template>
          <template #default="{ row }">
            <template v-if="row.tipe === 'dokumen'">
              <el-tooltip v-if="hasil.dokumen[row.key][j.id]" :content="waktu(hasil.dokumen[row.key][j.id])">
                <el-icon color="#67c23a" :size="18"><CircleCheckFilled /></el-icon>
              </el-tooltip>
              <el-icon v-else color="#f56c6c" :size="18"><CircleCloseFilled /></el-icon>
            </template>

            <template v-else-if="row.tipe === 'rincian'">
              <el-tooltip v-if="ringkasRincian(j.id).target === null"
                :content="`DPA Belanja jadwal ini belum terdownload — ${ringkasRincian(j.id).masuk} sub kegiatan rinciannya sudah masuk`">
                <el-tag type="info" size="small">? · {{ ringkasRincian(j.id).masuk }} masuk</el-tag>
              </el-tooltip>
              <el-tag v-else :type="tipeRincian(ringkasRincian(j.id))" size="small">
                {{ ringkasRincian(j.id).terpenuhi }} / {{ ringkasRincian(j.id).target }}
              </el-tag>
            </template>

            <el-tooltip v-else :content="tooltipSub(row, j.id)">
              <el-icon v-if="row.sel[j.id]?.status === 'ada'" color="#67c23a" :size="16"><CircleCheckFilled /></el-icon>
              <el-icon v-else-if="row.sel[j.id]?.status === 'belum'" color="#f56c6c" :size="16"><CircleCloseFilled /></el-icon>
              <el-icon v-else-if="row.sel[j.id]" color="#b1b3b8" :size="16"><CircleCheckFilled /></el-icon>
              <el-icon v-else-if="belanjaAda(j.id)" color="#dcdfe6" :size="16"><Remove /></el-icon>
              <el-icon v-else color="#dcdfe6" :size="16"><QuestionFilled /></el-icon>
            </el-tooltip>
          </template>
        </el-table-column>
      </el-table>

      <p style="font-size:12px; color:#909399; margin-top:10px; line-height:1.6;">
        Rincian Belanja = sub kegiatan yang rinciannya sudah terdownload / sub kegiatan yang tercantum (bernilai)
        di DPA Belanja dinas itu pada jadwal yang sama. Per sub kegiatan:
        <span style="color:#67c23a;">hijau</span> = rincian masuk,
        <span style="color:#f56c6c;">merah</span> = tercantum di DPA Belanja tapi rinciannya belum,
        abu-abu = rincian masuk tapi sub kegiatannya tidak tercantum di DPA Belanja jadwal itu (atau DPA Belanja-nya belum ada),
        <strong>–</strong> = tidak dianggarkan di jadwal itu, <strong>?</strong> = DPA Belanja jadwal itu belum terdownload.
        Arahkan kursor ke sel untuk keterangan.
      </p>
    </template>
  </div>
</template>

<style scoped>
/* Indentasi pohon el-table dan isi sel sama-sama inline: isi yang panjang
   turun ke baris baru di bawah indentasi. Flex membuat indentasi tetap di
   kiri dan teks membungkus di sebelahnya. */
:deep(.kolom-dokumen .cell) {
  display: flex;
  align-items: flex-start;
}
:deep(.kolom-dokumen .cell > .el-table__indent),
:deep(.kolom-dokumen .cell > .el-table__placeholder),
:deep(.kolom-dokumen .cell > .el-table__expand-icon) {
  flex-shrink: 0;
}
</style>
