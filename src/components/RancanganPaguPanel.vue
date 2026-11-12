<script setup>
import { ref, computed, watch } from 'vue'
import { Download } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { bandingkanInputan, matriksBanding } from '../utils/bandingInputan.js'
import { ambilPaguSistem, ambilRancanganTersimpan, hapusRancangan } from '../utils/bandingPagu.js'
import { buatWorkbookMatriksInputan, namaFileMatriksInputan } from '../utils/matriksInputanExcel.js'

const props = defineProps({
  tahun: { type: [String, Number], required: true },
  kategori: { type: String, required: true }, // 'gaji' | 'tpp' | 'pppk_pw'
  label: { type: String, required: true },
  deskripsi: { type: String, default: '' },
})

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
}
function formatSelisih(val) {
  const n = Number(val || 0)
  if (!n) return '—'
  return (n > 0 ? '+' : '−') + formatRp(Math.abs(n))
}
// Beda dari tab Cek Inputan (biru/kuning berdasarkan arah kurang/lebih) — di
// sini kurang ATAU lebih dari rancangan sama-sama ditandai masalah, jadi
// dua-duanya merah supaya langsung kelihatan, bukan cuma warna penanda arah.
function warnaPergeseran(val) {
  return val ? '#f56c6c' : '#909399'
}

const sistem = ref(null)
const memuatSistem = ref(false)
async function muatSistem() {
  memuatSistem.value = true
  try {
    sistem.value = await ambilPaguSistem(props.tahun, props.kategori)
  } catch (e) {
    ElMessage.error(`Gagal memuat pagu sistem (${props.label}): ` + (e?.message || e))
  } finally {
    memuatSistem.value = false
  }
}
muatSistem()
watch(() => [props.tahun, props.kategori], muatSistem)

const inputan = ref(null)
const memuatTersimpan = ref(false)
const toleransi = ref(0)
const toleransiTotal = ref(0)

async function muatTersimpan() {
  memuatTersimpan.value = true
  try {
    inputan.value = await ambilRancanganTersimpan(props.tahun, props.kategori)
  } catch (e) {
    ElMessage.error(`Gagal memuat rancangan tersimpan (${props.label}): ` + (e?.message || e))
  } finally {
    memuatTersimpan.value = false
  }
}
muatTersimpan()
watch(() => [props.tahun, props.kategori], muatTersimpan)

const banding = computed(() => (inputan.value && sistem.value)
  ? bandingkanInputan(sistem.value, inputan.value, { sisi: 'rumus', toleransi: toleransi.value })
  : null)
const matriks = computed(() => banding.value
  ? matriksBanding(banding.value, { toleransiTotal: toleransiTotal.value }) : [])
const golMatriks = ref(null)
const matriksAktif = computed(() => {
  const daftar = matriks.value
  if (!daftar.length) return null
  return daftar.find(m => m.kunci === golMatriks.value) || daftar[0]
})
const jumlahSignifikan = computed(() => matriks.value.reduce((a, m) => a + m.dinasSignifikan, 0))
defineExpose({ jumlahSignifikan, reload: muatTersimpan, banding })

async function lupakanInputan() {
  try {
    await ElMessageBox.confirm(
      `Rancangan pagu ${props.label} yang tersimpan akan dihapus dari aplikasi. Lanjutkan?`,
      'Hapus rancangan tersimpan', { type: 'warning' }
    )
  } catch { return }
  try {
    await hapusRancangan(props.tahun, props.kategori)
    inputan.value = null
    ElMessage.success('Rancangan pagu tersimpan sudah dihapus.')
  } catch (e) {
    ElMessage.error('Gagal menghapus: ' + (e?.message || e))
  }
}

const exporting = ref(false)
async function exportExcel() {
  if (!matriks.value.length) return
  exporting.value = true
  try {
    const buf = await buatWorkbookMatriksInputan(matriks.value, {
      tahun: props.tahun,
      judul: `CEK RANCANGAN PAGU ${props.label.toUpperCase()} {golongan} — TA ${props.tahun}`,
      subjudul: `Pagu Sistem = anggaran_rekap (hasil DPA/SIPD) • Rancangan = ${inputan.value?.namaBerkas || '-'}`,
      toleransi: toleransi.value,
      toleransiTotal: toleransiTotal.value,
      namaBerkas: inputan.value?.namaBerkas || '-',
    })
    const nama = namaFileMatriksInputan(props.tahun, props.label.replace(/\s+/g, '_'))
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = nama; a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('Matriks diekspor')
  } catch (e) {
    ElMessage.error('Gagal membuat file: ' + (e?.message || e))
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div>
    <el-card style="margin-bottom: 16px;">
      <p v-if="deskripsi" style="margin: 0 0 12px; font-size: 12px; color: #606266; line-height: 1.7;">
        {{ deskripsi }}
      </p>
      <div style="display: flex; gap: 20px; align-items: flex-start; flex-wrap: wrap;">
        <div>
          <div style="font-size: 12px; color: #606266; margin-bottom: 6px;">Rancangan pagu {{ label }} tersimpan</div>
          <div v-if="inputan" style="font-size: 11px; color: #909399; max-width: 420px; line-height: 1.6;">
            <strong>{{ inputan.namaBerkas }}</strong> &bull; {{ inputan.jumlahRekening }} baris
            dari {{ inputan.jumlahDinas }} OPD &bull; total pagu rancangan {{ formatRp(inputan.totalPagu) }}
            <template v-if="inputan.uploadedAt">
              <br />tersimpan sejak {{ new Date(inputan.uploadedAt).toLocaleString('id-ID') }}
            </template>
            <br /><el-button link type="danger" size="small" @click="lupakanInputan">Hapus rancangan tersimpan</el-button>
          </div>
          <div v-else style="font-size: 11px; color: #909399;">
            Belum ada — unggah berkas gabungan di bagian atas halaman.
          </div>
        </div>
        <div>
          <div style="font-size: 12px; color: #606266; margin-bottom: 6px;">Toleransi</div>
          <el-input-number v-model="toleransi" :min="0" :step="1000" :precision="0"
            size="small" controls-position="right" style="width: 140px;" />
          <div style="font-size: 11px; color: #909399; margin-top: 6px; max-width: 300px; line-height: 1.6;">
            rupiah &mdash; selisih di bawah ini dihitung <strong>SESUAI</strong>.
          </div>
        </div>
        <div>
          <div style="font-size: 12px; color: #606266; margin-bottom: 6px;">Batas selisih total</div>
          <el-input-number v-model="toleransiTotal" :min="0" :step="100000" :precision="0"
            size="small" controls-position="right" style="width: 160px;" />
          <div style="font-size: 11px; color: #909399; margin-top: 6px; max-width: 320px; line-height: 1.6;">
            rupiah, per OPD per golongan &mdash; di bawah ini dianggap <strong>saling tutup</strong>.
          </div>
        </div>
      </div>
    </el-card>

    <el-empty v-if="memuatSistem || memuatTersimpan" description="Memuat..." />
    <el-empty v-else-if="!inputan" description="Belum ada rancangan pagu tersimpan. Unggah berkas gabungan di bagian atas halaman." />

    <template v-else-if="banding">
      <el-card style="margin-bottom: 16px;">
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px;">
          <div>
            <div style="font-size: 12px; color: #67c23a; font-weight: 600;">Sesuai</div>
            <div style="font-size: 20px; font-weight: 700;">{{ banding.total.sesuai }}</div>
            <div style="font-size: 11px; color: #909399;">dari {{ banding.total.jumlah }} baris</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #f56c6c; font-weight: 600;">Kurang dari rancangan</div>
            <div style="font-size: 20px; font-weight: 700; color: #f56c6c;">{{ banding.total.kurang }}</div>
            <div style="font-size: 11px; color: #909399;">{{ formatRp(banding.total.selisihKurang) }}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #f56c6c; font-weight: 600;">Lebih dari rancangan</div>
            <div style="font-size: 20px; font-weight: 700; color: #f56c6c;">{{ banding.total.lebih }}</div>
            <div style="font-size: 11px; color: #909399;">+{{ formatRp(banding.total.selisihLebih) }}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #909399; font-weight: 600;">Belum diinput</div>
            <div style="font-size: 20px; font-weight: 700;">{{ banding.total.hilang }}</div>
            <div style="font-size: 11px; color: #909399;">ada di rancangan, belum ada pagunya</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #909399; font-weight: 600;">Di luar rancangan</div>
            <div style="font-size: 20px; font-weight: 700;">{{ banding.total.ekstra }}</div>
            <div style="font-size: 11px; color: #909399;">pagu ada, tidak di rancangan</div>
          </div>
        </div>
        <el-divider style="margin: 14px 0;" />
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;">
          <div>
            <div style="font-size: 12px; color: #606266; font-weight: 600;">Total Pagu Sistem</div>
            <div style="font-size: 18px; font-weight: 700;">{{ formatRp(banding.total.usulan) }}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #409eff; font-weight: 600;">Total Rancangan</div>
            <div style="font-size: 18px; font-weight: 700;">{{ formatRp(banding.total.inputan) }}</div>
          </div>
          <div>
            <div style="font-size: 12px; font-weight: 600;" :style="{ color: warnaPergeseran(banding.total.selisih) }">
              Selisih
            </div>
            <div style="font-size: 18px; font-weight: 700;" :style="{ color: warnaPergeseran(banding.total.selisih) }">
              {{ formatSelisih(banding.total.selisih) }}
            </div>
          </div>
        </div>
      </el-card>

      <el-card style="margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px;">
          <span style="font-size: 14px; font-weight: 700; color: #303133;">Matriks Pagu Sistem vs Rancangan</span>
          <el-radio-group v-model="golMatriks" size="small">
            <el-radio-button v-for="m in matriks" :key="m.kunci" :value="m.kunci">
              {{ m.label }}
              <span v-if="m.jumlahSalah" style="color: #f56c6c; font-weight: 700;">&nbsp;{{ m.jumlahSalah }}</span>
            </el-radio-button>
          </el-radio-group>
          <el-button type="success" plain size="small" :icon="Download" :loading="exporting"
            style="margin-left: auto;" @click="exportExcel">
            Ekspor Excel
          </el-button>
        </div>
        <p style="margin: 0 0 10px; font-size: 12px; color: #909399; line-height: 1.6;">
          Tiap sel: baris atas = <strong>Pagu Sistem</strong> (anggaran_rekap), baris bawah = <strong>Rancangan</strong>
          BPKAD. Warna merah/kuning pada baris Rancangan berarti selisihnya lewat toleransi.
        </p>
        <el-table v-if="matriksAktif" :data="matriksAktif.baris" row-key="kodeSkpd" border size="small"
          class="tabel-rapat" style="width: 100%;" max-height="640"
          :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }">
          <el-table-column label="OPD" prop="namaSkpd" min-width="220" fixed show-overflow-tooltip />
          <el-table-column v-for="k in matriksAktif.kolom" :key="k.kode" :label="k.label" min-width="165" align="right">
            <template #default="{ row }">
              <template v-if="row.sel[k.kode]">
                <div style="font-size: 11px; line-height: 1.5; font-variant-numeric: tabular-nums;">
                  <div style="color: #909399;">{{ formatRp(row.sel[k.kode].hitungan) }}</div>
                  <div :class="row.sel[k.kode].cocok ? 'sel-true' : (row.status === 'salingTutup' ? 'sel-tutup' : 'sel-false')">
                    {{ formatRp(row.sel[k.kode].inputan) }}
                  </div>
                </div>
              </template>
              <span v-else style="color: #dcdfe6;">&mdash;</span>
            </template>
          </el-table-column>
          <el-table-column label="Total OPD" min-width="150" align="right" fixed="right">
            <template #default="{ row }">
              <div style="font-size: 11px; line-height: 1.5; font-variant-numeric: tabular-nums;">
                <div style="color: #909399;">{{ formatRp(row.jumlahHitungan) }}</div>
                <div :class="row.status === 'cocok' ? 'sel-true' : row.status === 'salingTutup' ? 'sel-tutup' : 'sel-false'">
                  {{ formatRp(row.jumlahInputan) }}
                </div>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card>
        <div style="font-size: 14px; font-weight: 700; color: #303133; margin-bottom: 4px;">Per OPD</div>
        <el-table :data="banding.dinas" row-key="kodeSkpd" border size="small" class="tabel-rapat" style="width: 100%;"
          :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }">
          <el-table-column label="OPD" prop="namaSkpd" min-width="220" show-overflow-tooltip sortable />
          <el-table-column label="Baris" prop="jumlah" width="60" align="center" />
          <el-table-column label="Sesuai" prop="sesuai" width="75" align="center" sortable />
          <el-table-column label="Kurang" prop="kurang" width="75" align="center" sortable />
          <el-table-column label="Lebih" prop="lebih" width="75" align="center" sortable />
          <el-table-column label="Belum" prop="hilang" width="75" align="center" sortable />
          <el-table-column label="Pagu Sistem" prop="usulan" min-width="140" align="right" sortable>
            <template #default="{ row }">{{ formatRp(row.usulan) }}</template>
          </el-table-column>
          <el-table-column label="Rancangan" prop="inputan" min-width="140" align="right" sortable>
            <template #default="{ row }">{{ formatRp(row.inputan) }}</template>
          </el-table-column>
          <el-table-column label="Selisih" prop="selisih" min-width="140" align="right" sortable>
            <template #default="{ row }">
              <span :style="{ color: warnaPergeseran(row.selisih), fontWeight: 700 }">{{ formatSelisih(row.selisih) }}</span>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.sel-true { color: #67c23a; font-weight: 700; }
.sel-false { color: #f56c6c; font-weight: 700; }
.sel-tutup { color: #e6a23c; font-weight: 700; }
</style>
