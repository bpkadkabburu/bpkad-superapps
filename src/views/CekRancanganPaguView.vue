<script setup>
import { ref, computed } from 'vue'
import { useRoute } from 'vue-router'
import { Upload } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import RancanganPaguPanel from '../components/RancanganPaguPanel.vue'
import RingkasanKunciPanel from '../components/RingkasanKunciPanel.vue'
import { bacaDanSimpanRancanganGabungan, BerkasTidakDikenal } from '../utils/bandingPagu.js'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const tab = ref('gaji')
const panelGaji = ref(null)
const panelTpp = ref(null)
const panelPppkPw = ref(null)
const PANEL = { gaji: panelGaji, tpp: panelTpp, pppk_pw: panelPppkPw }

const daftarRingkasan = computed(() => [
  { kunci: 'gaji', label: 'Gaji', banding: panelGaji.value?.banding, golongan: true },
  { kunci: 'tpp', label: 'TPP', banding: panelTpp.value?.banding, golongan: true },
  { kunci: 'pppk_pw', label: 'PPPK Paruh Waktu', banding: panelPppkPw.value?.banding, golongan: false },
])

const mengunggah = ref(false)
async function handleUpload(uploadFile) {
  if (!uploadFile?.raw) return false
  mengunggah.value = true
  try {
    const { tersimpan, sheetTakDikenali } = await bacaDanSimpanRancanganGabungan(uploadFile.raw, tahun.value)
    for (const kategori of Object.keys(tersimpan)) {
      await PANEL[kategori]?.value?.reload()
    }
    const ringkasan = Object.values(tersimpan)
      .map(h => `${h.label}: ${h.jumlahRekening} baris/${h.jumlahDinas} OPD`)
      .join(' • ')
    let pesan = `Tersimpan — ${ringkasan}.`
    if (sheetTakDikenali.length) pesan += ` Sheet tidak dikenali (dilewati): ${sheetTakDikenali.join(', ')}.`
    ElMessage.success(pesan)
  } catch (e) {
    if (e instanceof BerkasTidakDikenal) ElMessage.error(e.message)
    else ElMessage.error('Gagal membaca/menyimpan file: ' + (e?.message || e))
  } finally {
    mengunggah.value = false
  }
  return false
}
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Cek Rancangan Pagu</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #909399;">
        Membandingkan pagu yang sudah tersinkron di aplikasi (hasil DPA/SIPD) dengan rancangan pagu yang
        ditetapkan BPKAD — Gaji, TPP, dan PPPK Paruh Waktu. Berbeda dari tab <strong>Cek Inputan</strong> di
        Proyeksi Gaji (itu membandingkan hasil proyeksi, bukan pagu yang sudah diinput).
      </p>
    </div>

    <el-card style="margin-bottom: 16px;">
      <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
        <el-upload :auto-upload="false" :show-file-list="false" accept=".xlsx,.xls" :on-change="handleUpload">
          <el-button type="primary" :icon="Upload" :loading="mengunggah">Unggah Rancangan Pagu</el-button>
        </el-upload>
        <span style="font-size: 12px; color: #909399;">
          Satu berkas Excel, tiap kategori satu sheet (Gaji, TPP, PPPK Paruh Waktu) — dikenali otomatis dari
          header kolomnya, tidak tergantung nama sheet. Disimpan ke aplikasi, jadi tidak perlu diunggah ulang
          tiap buka halaman; unggah ulang akan menimpa rancangan kategori yang sheetnya terbaca.
        </span>
      </div>
    </el-card>

    <el-tabs v-model="tab">
      <el-tab-pane name="gaji">
        <template #label>
          Gaji
          <el-badge v-if="panelGaji?.jumlahSignifikan" :value="panelGaji.jumlahSignifikan" type="danger" />
        </template>
        <RancanganPaguPanel ref="panelGaji" :tahun="tahun" kategori="gaji" label="Gaji"
          deskripsi="Pagu gaji (awalan kode rekening 5.1.01.01) yang sudah tersinkron di Anggaran Rekap,
            dibandingkan dengan rancangan pagu BPKAD." />
      </el-tab-pane>

      <el-tab-pane name="tpp">
        <template #label>
          TPP
          <el-badge v-if="panelTpp?.jumlahSignifikan" :value="panelTpp.jumlahSignifikan" type="danger" />
        </template>
        <RancanganPaguPanel ref="panelTpp" :tahun="tahun" kategori="tpp" label="TPP"
          deskripsi="Pagu TPP (awalan kode rekening 5.1.01.02) yang sudah tersinkron, dibandingkan dengan
            rancangan pagu BPKAD." />
      </el-tab-pane>

      <el-tab-pane name="pppk_pw">
        <template #label>
          PPPK Paruh Waktu
          <el-badge v-if="panelPppkPw?.jumlahSignifikan" :value="panelPppkPw.jumlahSignifikan" type="danger" />
        </template>
        <RancanganPaguPanel ref="panelPppkPw" :tahun="tahun" kategori="pppk_pw" label="PPPK Paruh Waktu"
          deskripsi="Pagu yang nama rekeningnya mengandung 'Paruh Waktu' di Anggaran Rekap, dibandingkan dengan
            rancangan pagu BPKAD." />
      </el-tab-pane>

      <el-tab-pane name="ringkasan" label="Ringkasan">
        <RingkasanKunciPanel :daftar="daftarRingkasan" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>
