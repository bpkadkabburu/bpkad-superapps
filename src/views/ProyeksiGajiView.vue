<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Download, Refresh, WarningFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import api from '../utils/api.js'
import { buatWorkbookProyeksiGaji, namaFileProyeksiGaji } from '../utils/proyeksiGajiExcel.js'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const NAMA_BULAN = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

const KOSONG = {
  skpd: [], rekening: [], bulanList: [], bulanSisa: 0, bulanGajiTerbayarTotal: 0,
  totals: { pagu: 0, spp: 0, sp2d: 0, proyeksi: 0, sisa: 0, selisih: 0 },
}

const loading = ref(false)
const exporting = ref(false)
const prefix = ref('5.1.01.01')
const data = ref(KOSONG)
const tampilkanRekeningKurang = ref(true)

async function load() {
  loading.value = true
  try {
    const res = await api.get('/proyeksi-gaji', {
      params: { tahun: tahun.value, prefix: prefix.value },
    })
    data.value = res.data
  } catch {
    data.value = KOSONG
    ElMessage.error('Gagal memuat data')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const rows = computed(() => data.value.skpd || [])
const totals = computed(() => data.value.totals || KOSONG.totals)

const labelBulanTerakhir = computed(() => {
  const b = data.value.bulanTerakhir
  return b ? `${NAMA_BULAN[b]} ${tahun.value}` : '—'
})
const rentangSisa = computed(() => {
  const b = data.value.bulanTerakhir
  if (!b || b >= 12) return 'sisa tahun'
  return `${NAMA_BULAN[b + 1]}–Desember`
})

const skpdKurang = computed(() =>
  rows.value.filter(r => r.selisih < 0).sort((a, b) => a.selisih - b.selisih))

const totalKekurangan = computed(() =>
  skpdKurang.value.reduce((a, r) => a + r.selisih, 0))

// Rekening yang kurang, dikumpulkan lintas dinas. Kekurangan tiap dinas TIDAK
// disaling-hapuskan dengan dinas yang lebih — kalau dijumlahkan begitu, rekening
// yang kurang di beberapa dinas bisa terlihat aman.
const rekeningKurang = computed(() =>
  (data.value.rekening || [])
    .filter(r => r.dinasKurang > 0)
    .sort((a, b) => a.kekurangan - b.kekurangan))

const totalRekeningKurang = computed(() =>
  rows.value.reduce((a, r) => a + r.rekening.filter(x => x.selisih < 0).length, 0))

function rekeningKurangDi(row) {
  return row.rekening.filter(r => r.selisih < 0).sort((a, b) => a.selisih - b.selisih)
}

function ringkasRekeningKurang(row) {
  const daftar = rekeningKurangDi(row)
  if (!daftar.length) return ''
  return daftar.map(r => `${r.kodeRekening} ${r.namaRekening}: ${formatRp(r.selisih)}`).join('\n')
}

function kelasBaris({ row }) {
  return row.selisih < 0 ? 'baris-kurang' : ''
}

// Dinas yang laju bayarnya menyimpang jauh dari kabupaten — angka proyeksinya
// perlu dicek dulu di sheet PER BULAN (mis. pembayaran tertinggal atau ada rapel).
const skpdMenyimpang = computed(() => rows.value.filter(r =>
  r.pembagiPerkiraan ||
  Math.abs(r.bulanGajiTerbayar - data.value.bulanGajiTerbayarTotal) >= 1
))

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
}
function formatMio(val) {
  const n = Number(val || 0)
  if (Math.abs(n) >= 1e9) return 'Rp' + (n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 }) + ' M'
  if (Math.abs(n) >= 1e6) return 'Rp' + (n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' jt'
  return formatRp(n)
}
function formatBulan(v) {
  return Number(v || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function menyimpang(row) {
  return row.pembagiPerkiraan ||
    Math.abs(row.bulanGajiTerbayar - data.value.bulanGajiTerbayarTotal) >= 1
}

async function exportExcel() {
  if (!rows.value.length) {
    ElMessage.warning('Tidak ada data untuk diekspor')
    return
  }
  exporting.value = true
  try {
    const buf = await buatWorkbookProyeksiGaji(data.value, { tahun: tahun.value })
    const url = URL.createObjectURL(new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }))
    const a = document.createElement('a')
    a.href = url
    a.download = namaFileProyeksiGaji(tahun.value, data.value.prefix, data.value.bulanTerakhir)
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`File diekspor — ${rows.value.length} sheet dinas`)
  } catch (e) {
    ElMessage.error('Gagal membuat file: ' + (e?.message || e))
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Proyeksi Gaji dan Tunjangan</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #909399;">
        Kebutuhan belanja gaji &amp; tunjangan sampai akhir tahun, per SKPD &rarr; per rekening.
        Jumlah bulan-gaji yang sudah dibayar dihitung dari realisasi per bulan, bukan diasumsikan &bull;
        Sumber: Anggaran Rekap (pagu) &amp; Dokumen Realisasi (SP2D).
      </p>
    </div>

    <!-- Kartu ringkasan -->
    <el-card v-loading="loading" style="margin-bottom: 16px;">
      <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px;">
        <div>
          <div style="font-size: 12px; color: #67c23a; font-weight: 600;">Total Anggaran</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totals.pagu) }}</div>
        </div>
        <div>
          <div style="font-size: 12px; color: #e6a23c; font-weight: 600;">Realisasi (SP2D)</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totals.sp2d) }}</div>
          <div style="font-size: 11px; color: #909399;">
            s.d. {{ labelBulanTerakhir }} &bull; {{ formatBulan(data.bulanGajiTerbayarTotal) }} bulan-gaji
          </div>
        </div>
        <div>
          <div style="font-size: 12px; color: #409eff; font-weight: 600;">Sisa Anggaran</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totals.sisa) }}</div>
        </div>
        <div>
          <div style="font-size: 12px; color: #606266; font-weight: 600;">Kebutuhan {{ data.bulanSisa }} Bulan</div>
          <div style="font-size: 20px; font-weight: 700;">{{ formatMio(totals.proyeksi) }}</div>
          <div style="font-size: 11px; color: #909399;">{{ rentangSisa }}</div>
        </div>
        <div>
          <div style="font-size: 12px; font-weight: 600;" :style="{ color: totals.selisih < 0 ? '#f56c6c' : '#67c23a' }">
            {{ totals.selisih < 0 ? 'Kurang' : 'Cukup / Sisa' }}
          </div>
          <div style="font-size: 20px; font-weight: 700;" :style="{ color: totals.selisih < 0 ? '#f56c6c' : '#67c23a' }">
            {{ formatMio(Math.abs(totals.selisih)) }}
          </div>
          <div style="font-size: 11px; color: #909399;">Sisa Anggaran &minus; Kebutuhan</div>
        </div>
      </div>
    </el-card>

    <!-- Aksi -->
    <el-card style="margin-bottom: 16px;">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
        <span style="font-size: 12px; color: #606266;">Kode rekening</span>
        <el-input v-model="prefix" style="width: 130px;" @keyup.enter="load" />
        <el-button :icon="Refresh" :loading="loading" @click="load">Muat</el-button>
        <span style="font-size: 12px; color: #909399;">
          default <strong>5.1.01.01</strong> = Belanja Gaji dan Tunjangan ASN
        </span>
        <el-button type="primary" :icon="Download" :loading="exporting" @click="exportExcel" style="margin-left: auto;">
          Export Excel
        </el-button>
      </div>
      <div style="margin-top: 10px; font-size: 12px; color: #909399;">
        File Excel berisi 1 sheet per dinas (rekening urut kode) + sheet REKAP, PER BULAN, dan REKAP REKENING.
        Kolom <strong>Sim Gaji /Bln</strong> dibiarkan kosong untuk diisi manual — begitu diisi, kolom Kebutuhan,
        Selisih, dan Status ikut terhitung ulang di Excel.
      </div>
    </el-card>

    <!-- Peringatan -->
    <el-alert v-if="skpdKurang.length" type="error" :closable="false" show-icon style="margin-bottom: 12px;">
      <template #title>
        {{ skpdKurang.length }} SKPD dan {{ totalRekeningKurang }} rekening diproyeksikan
        <strong>kurang anggaran</strong> sampai akhir tahun — total kekurangan {{ formatMio(totalKekurangan) }}.
        Terbesar: {{ skpdKurang[0].namaSkpd }} ({{ formatMio(skpdKurang[0].selisih) }}).
      </template>
    </el-alert>

    <!-- Rekening yang kurang, lintas dinas -->
    <el-card v-if="rekeningKurang.length" style="margin-bottom: 16px;">
      <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px;">
        <el-icon :size="18" style="color: #f56c6c;"><WarningFilled /></el-icon>
        <span style="font-size: 14px; font-weight: 700; color: #303133;">Rekening yang Kurang Anggaran</span>
        <el-tag type="danger" size="small" effect="light">{{ rekeningKurang.length }} rekening</el-tag>
        <el-button text size="small" @click="tampilkanRekeningKurang = !tampilkanRekeningKurang" style="margin-left: auto;">
          {{ tampilkanRekeningKurang ? 'Sembunyikan' : 'Tampilkan' }}
        </el-button>
      </div>
      <p style="margin: 0 0 10px; font-size: 12px; color: #909399;">
        Dihitung per dinas lalu dikumpulkan — kekurangan di satu dinas tidak ditutup oleh dinas lain yang anggarannya
        lebih. Klik baris untuk melihat dinas mana saja. Ini juga yang ditandai merah di file Excel.
      </p>
      <el-table
        v-if="tampilkanRekeningKurang"
        :data="rekeningKurang"
        row-key="kodeRekening"
        border
        size="small"
        style="width: 100%;"
        :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }"
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <div style="padding: 8px 16px 12px 48px; background: #fffafa;">
              <el-table :data="row.daftarKurang" size="small" style="width: 100%;">
                <el-table-column prop="namaSkpd" label="SKPD" min-width="240" show-overflow-tooltip />
                <el-table-column label="Anggaran" width="150" align="right">
                  <template #default="{ row: d }">{{ formatRp(d.pagu) }}</template>
                </el-table-column>
                <el-table-column label="Realisasi" width="150" align="right">
                  <template #default="{ row: d }">{{ formatRp(d.sp2d) }}</template>
                </el-table-column>
                <el-table-column label="Sisa" width="150" align="right">
                  <template #default="{ row: d }">{{ formatRp(d.sisa) }}</template>
                </el-table-column>
                <el-table-column :label="`Kebutuhan ${data.bulanSisa} Bln`" width="150" align="right">
                  <template #default="{ row: d }">{{ formatRp(d.proyeksi) }}</template>
                </el-table-column>
                <el-table-column label="Kekurangan" width="150" align="right">
                  <template #default="{ row: d }">
                    <span style="color: #f56c6c; font-weight: 600;">{{ formatRp(d.selisih) }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="Kode Rek" width="185">
          <template #default="{ row }">
            <span style="font-family: monospace; font-size: 11px; color: #606266;">{{ row.kodeRekening }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="namaRekening" label="Nama Rekening" min-width="240" show-overflow-tooltip />
        <el-table-column label="Dinas Kurang" prop="dinasKurang" width="120" align="center" sortable>
          <template #default="{ row }">
            <el-tag type="danger" size="small" effect="light">{{ row.dinasKurang }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Total Kekurangan" prop="kekurangan" width="165" align="right" sortable>
          <template #default="{ row }">
            <span style="color: #f56c6c; font-weight: 700; font-variant-numeric: tabular-nums;">
              {{ formatRp(row.kekurangan) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="Sisa Anggaran (kab.)" prop="sisa" width="165" align="right">
          <template #default="{ row }">
            <span style="font-variant-numeric: tabular-nums; color: #909399;">{{ formatRp(row.sisa) }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-alert v-if="skpdMenyimpang.length" type="warning" :closable="false" show-icon style="margin-bottom: 16px;">
      <template #title>
        {{ skpdMenyimpang.length }} SKPD laju bayarnya menyimpang &ge; 1 bulan-gaji dari kabupaten
        ({{ formatBulan(data.bulanGajiTerbayarTotal) }}) — cek kolom "Bulan-Gaji Dibayar" dan sheet PER BULAN
        sebelum memakai angka proyeksinya.
      </template>
    </el-alert>

    <el-empty
      v-if="!loading && !rows.length"
      description="Belum ada data. Pastikan Anggaran Rekap dan Dokumen Realisasi sudah diimport."
      :image-size="120"
    />

    <el-table
      v-else
      v-loading="loading"
      :data="rows"
      row-key="kodeSkpd"
      border
      size="small"
      style="width: 100%;"
      :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }"
    >
      <el-table-column type="expand">
        <template #default="{ row }">
          <div style="padding: 8px 16px 12px 48px; background: #fafcff;">
            <div style="font-size: 11px; color: #909399; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px;">
              Rincian per rekening — {{ row.namaSkpd }}
              <span v-if="rekeningKurangDi(row).length" style="color: #f56c6c;">
                &bull; {{ rekeningKurangDi(row).length }} rekening kurang (baris merah)
              </span>
            </div>
            <el-table :data="row.rekening" size="small" style="width: 100%;" :row-class-name="kelasBaris">
              <el-table-column label="Kode Rek" width="180">
                <template #default="{ row: d }">
                  <span style="font-family: monospace; font-size: 11px; color: #606266;">{{ d.kodeRekening }}</span>
                </template>
              </el-table-column>
              <el-table-column prop="namaRekening" label="Nama Rekening" min-width="240" show-overflow-tooltip />
              <el-table-column label="Anggaran" width="140" align="right">
                <template #default="{ row: d }">{{ formatRp(d.pagu) }}</template>
              </el-table-column>
              <el-table-column label="Realisasi" width="140" align="right">
                <template #default="{ row: d }">{{ formatRp(d.sp2d) }}</template>
              </el-table-column>
              <el-table-column label="Sisa" width="140" align="right">
                <template #default="{ row: d }">{{ formatRp(d.sisa) }}</template>
              </el-table-column>
              <el-table-column :label="`Kebutuhan ${data.bulanSisa} Bln`" width="150" align="right">
                <template #default="{ row: d }">{{ formatRp(d.proyeksi) }}</template>
              </el-table-column>
              <el-table-column label="Selisih" width="150" align="right">
                <template #default="{ row: d }">
                  <span :style="{ color: d.selisih < 0 ? '#f56c6c' : '#67c23a', fontWeight: 600 }">
                    {{ formatRp(d.selisih) }}
                  </span>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="SKPD" min-width="240" sortable :sort-by="'namaSkpd'" show-overflow-tooltip>
        <template #default="{ row }">
          <div style="font-weight: 600; font-size: 13px; color: #303133;">{{ row.namaSkpd }}</div>
          <div style="font-size: 11px; color: #c0c4cc; font-family: monospace;">{{ row.kodeSkpd }}</div>
        </template>
      </el-table-column>

      <el-table-column label="Anggaran" prop="pagu" width="145" align="right" sortable>
        <template #default="{ row }">
          <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.pagu) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Realisasi (SP2D)" prop="sp2d" width="145" align="right" sortable>
        <template #default="{ row }">
          <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.sp2d) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Sisa Anggaran" prop="sisa" width="145" align="right" sortable>
        <template #default="{ row }">
          <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.sisa) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Rata²/Bln" prop="perBulanRutin" width="140" align="right" sortable>
        <template #default="{ row }">
          <span style="font-variant-numeric: tabular-nums; color: #606266;">{{ formatRp(row.perBulanRutin) }}</span>
        </template>
      </el-table-column>

      <el-table-column :label="`Kebutuhan ${data.bulanSisa} Bln`" prop="proyeksi" width="150" align="right" sortable>
        <template #default="{ row }">
          <span style="font-variant-numeric: tabular-nums;">{{ formatRp(row.proyeksi) }}</span>
        </template>
      </el-table-column>

      <el-table-column label="Selisih" prop="selisih" width="150" align="right" sortable>
        <template #default="{ row }">
          <span :style="{ color: row.selisih < 0 ? '#f56c6c' : '#67c23a', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }">
            {{ formatRp(row.selisih) }}
          </span>
        </template>
      </el-table-column>

      <el-table-column label="Status" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.selisih < 0 ? 'danger' : 'success'" size="small" effect="light">
            {{ row.selisih < 0 ? 'KURANG' : 'CUKUP' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="Rekening Kurang" width="135" align="center"
        :sort-by="(row) => rekeningKurangDi(row).length" sortable>
        <template #default="{ row }">
          <el-tooltip v-if="rekeningKurangDi(row).length" placement="left">
            <template #content>
              <div style="white-space: pre-line; max-width: 420px; font-size: 12px;">{{ ringkasRekeningKurang(row) }}</div>
            </template>
            <el-tag type="danger" size="small" effect="dark">
              {{ rekeningKurangDi(row).length }} rekening
            </el-tag>
          </el-tooltip>
          <span v-else style="color: #c0c4cc;">—</span>
        </template>
      </el-table-column>

      <el-table-column label="Bulan-Gaji Dibayar" width="130" align="center" prop="bulanGajiTerbayar" sortable>
        <template #default="{ row }">
          <span style="font-variant-numeric: tabular-nums;"
            :style="{ color: menyimpang(row) ? '#e6a23c' : '#606266', fontWeight: menyimpang(row) ? 700 : 400 }">
            {{ formatBulan(row.bulanGajiTerbayar) }}
            <el-tooltip
              v-if="menyimpang(row)"
              :content="row.pembagiPerkiraan
                ? 'Realisasi bulanan belum bisa dihitung — dipakai jumlah bulan kalender'
                : 'Laju bayar menyimpang dari kabupaten — cek sheet PER BULAN'"
            >
              <el-icon style="vertical-align: -2px;"><WarningFilled /></el-icon>
            </el-tooltip>
          </span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
/* Rekening yang anggarannya tidak cukup sampai akhir tahun. */
:deep(.el-table .baris-kurang) {
  --el-table-tr-bg-color: #fef0f0;
}
:deep(.el-table .baris-kurang:hover > td) {
  background-color: #fde2e2 !important;
}
:deep(.el-table .baris-kurang td) {
  border-color: #fbc4c4;
}
</style>
