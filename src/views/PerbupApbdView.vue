<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, Download, Delete, Document as DocIcon, Search } from '@element-plus/icons-vue'
import ExcelJS from 'exceljs'

import { bacaLampiran } from '../utils/perbupExcel.js'
import {
  buatRegistryDasar, jalankanRantai, bandingPasal, matriksNilai, labelTahap,
  TEMPLATE_AKUN_DEFAULT
} from '../utils/perbupEngine.js'
import { naskahPergeseran, naskahDokumenDasar, blokKeParagraf, gayaPratinjau } from '../utils/perbupNaskah.js'
import { buatDocx, saveAs } from '../utils/docxWriter.js'
import { rupiah } from '../utils/terbilang.js'
import api from '../utils/api.js'

const route = useRoute()
const tahun = computed(() => route.params.tahun)

const memuat = ref(false)
const siapSimpan = ref(false)   // cegah penulisan pengaturan sebelum data awal tiba
const pasalMulai = ref(3)
const dasar = ref(null)          // { nama, rows, reg }
const arsip = ref([])            // [{ nama, rows }]
const pilih = ref(-1)            // -1 = dokumen dasar
const nomorKlausul = ref(false)
const templateAkun = ref({ ...TEMPLATE_AKUN_DEFAULT })
const hanyaSisipan = ref(true)
const cariPasal = ref('')

const meta = ref({
  daerah: 'BURU',
  provinsi: 'MALUKU',
  nomor: '',
  tahun: String(route.params.tahun || ''),
  perbupDasar: '',
  tahunAnggaran: String(route.params.tahun || ''),
  tempatTanggal: '',
  menimbang: '',
  mengingat: '',
  jabatanPenetap: 'BUPATI BURU,',
  namaPenetap: '',
  jabatanPengundang: 'SEKRETARIS DAERAH BURU,',
  namaPengundang: ''
})

const opts = computed(() => ({
  tahunAnggaran: meta.value.tahunAnggaran,
  templateAkun: templateAkun.value,
  pasalMulai: pasalMulai.value
}))

// Registry dasar TIDAK pernah dinomori ulang di sini — hanya saat unggah dokumen
// dasar baru atau saat tombol "nomori ulang" ditekan secara sadar.
const tahapan = computed(() => {
  if (!dasar.value) return []
  return jalankanRantai(dasar.value, arsip.value, opts.value)
})

const aktif = computed(() => (pilih.value >= 0 ? tahapan.value[pilih.value] || null : null))

// Seluruh halaman menampilkan keadaan SAMPAI tahap yang dipilih, bukan keadaan
// terakhir. Pilih MURNI -> hanya dokumen dasar; pilih P1 -> MURNI dan P1; dst.
// Supaya saat menyusun naskah P1 tidak terganggu apa pun yang baru ada di P2.
const tahapanTampil = computed(() => tahapan.value.slice(0, pilih.value + 1))

const stateTampil = computed(() => {
  if (!dasar.value) return null
  const t = tahapanTampil.value
  return t.length ? t[t.length - 1] : dasar.value
})

const labelSampai = computed(() =>
  (pilih.value < 0 ? 'MURNI' : labelTahap(pilih.value))
)

const jumlahPasal = computed(() => (dasar.value ? Object.keys(dasar.value.reg).length : 0))
const rentangPasal = computed(() => {
  if (!dasar.value) return '-'
  const l = Object.values(dasar.value.reg).sort(bandingPasal)
  return l.length ? `${l[0]}–${l[l.length - 1]}` : '-'
})

// ------------------------------------------------------------ riwayat pasal
// Inti dari alat ini: satu tempat untuk tahu pasal sisipan mana yang sudah
// terbit, di pergeseran mana, dan pergeseran mana saja yang pernah mengubahnya.
const riwayat = computed(() => {
  if (!dasar.value) return []

  const lahir = {}
  const diubah = {}
  Object.keys(dasar.value.reg).forEach(k => { lahir[k] = 'MURNI' })

  tahapanTampil.value.forEach((t, i) => {
    t.sisipan.forEach(s => { lahir[s.kode] = labelTahap(i) })
    t.diubah.forEach(k => { (diubah[k] = diubah[k] || []).push(labelTahap(i)) })
  })

  const akhir = stateTampil.value
  const reg = akhir.reg
  const nilai = {}
  const uraian = {}
  akhir.rows.forEach(r => { nilai[r.kode] = r.nilai; uraian[r.kode] = r.uraian })
  dasar.value.rows.forEach(r => { if (!uraian[r.kode]) uraian[r.kode] = r.uraian })

  return Object.keys(reg)
    .map(kode => ({
      kode,
      pasal: reg[kode],
      uraian: uraian[kode] || '-',
      nilai: nilai[kode],
      hilang: nilai[kode] === undefined,
      lahir: lahir[kode] || '-',
      sisipan: lahir[kode] !== 'MURNI',
      diubah: diubah[kode] || []
    }))
    .sort((a, b) => bandingPasal(a.pasal, b.pasal))
})

const riwayatTampil = computed(() => {
  const q = cariPasal.value.trim().toLowerCase()
  return riwayat.value.filter(r => {
    if (hanyaSisipan.value && !r.sisipan) return false
    if (!q) return true
    return r.pasal.toLowerCase() === q
      || r.kode.toLowerCase().startsWith(q)
      || r.uraian.toLowerCase().includes(q)
  })
})

// ------------------------------------------------------------ riwayat nilai
// Matriks kode x tahap. Ini yang menggantikan "percaya saja pada peringatan":
// selisih tiap tahap bisa dilihat langsung, kolom per kolom.
const matriks = computed(() => {
  if (!dasar.value) return { labels: [], baris: [] }
  return matriksNilai(dasar.value, tahapanTampil.value)
})

const cariRiwayat = ref('')
const hanyaBerubah = ref(true)

const matriksTampil = computed(() => {
  const q = cariRiwayat.value.trim().toLowerCase()
  const reg = stateTampil.value?.reg || {}
  // Saat MURNI dipilih hanya ada satu kolom, jadi tidak ada yang bisa "berubah".
  // Filternya diabaikan supaya tabelnya tidak tampil kosong.
  const bisaBanding = matriks.value.labels.length > 1
  return matriks.value.baris
    .filter(b => {
      if (bisaBanding && hanyaBerubah.value && !b.berubah) return false
      if (!q) return true
      return b.kode.toLowerCase().startsWith(q)
        || (b.uraian || '').toLowerCase().includes(q)
        || String(reg[b.kode] || '').toLowerCase() === q
    })
    .map(b => ({ ...b, pasal: reg[b.kode] || '—' }))
})

// ------------------------------------------------------------ peringatan
const semuaPeringatan = computed(() =>
  tahapanTampil.value.flatMap((t, i) => t.peringatan.map(w => ({ ...w, tahap: labelTahap(i) })))
)

// Yang cuma soal baseline penyusunan dipisahkan dari yang benar-benar perlu
// diperiksa, supaya 39 baris "wajar" tidak menenggelamkan 1 baris yang gawat.
const peringatanBaseline = computed(() => semuaPeringatan.value.filter(w => w.tipe === 'baseline'))
const peringatanPenting = computed(() => semuaPeringatan.value.filter(w => w.tipe !== 'baseline'))

const ringkasanBaseline = computed(() => {
  const peta = new Map()
  peringatanBaseline.value.forEach(w => {
    const kunci = `${w.tahap}→${w.baseline}`
    if (!peta.has(kunci)) peta.set(kunci, { tahap: w.tahap, baseline: w.baseline, jumlah: 0, contoh: w })
    peta.get(kunci).jumlah++
  })
  return [...peta.values()]
})

const bukaBaseline = ref(false)

// ------------------------------------------------------------ naskah
const blokNaskah = computed(() => {
  if (!dasar.value) return []
  if (!aktif.value) return naskahDokumenDasar(dasar.value.rows, dasar.value.reg, opts.value)
  return naskahPergeseran(aktif.value, meta.value, {
    nomorKlausul: nomorKlausul.value,
    lengkap: true
  })
})

// ------------------------------------------------------------ unggah
async function bacaFile(file) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const ws = wb.worksheets[0]
  if (!ws) throw new Error('Sheet pertama tidak ditemukan.')
  return bacaLampiran(ws)
}

async function unggahDasar(uploadFile) {
  if (!uploadFile.raw) return
  if (dasar.value && arsip.value.length) {
    try {
      await ElMessageBox.confirm(
        `Rantai ${arsip.value.length} pergeseran akan dihapus dan penomoran pasal dimulai ` +
        `ulang dari Pasal ${pasalMulai.value}. Ini yang dilakukan saat Perbup Penjabaran ` +
        `Perubahan APBD — bukan saat pergeseran biasa. Lanjutkan?`,
        'Ganti dokumen dasar',
        { type: 'warning', confirmButtonText: 'Ganti', cancelButtonText: 'Batal' }
      )
    } catch { return }
  }

  try {
    const { rows, kolomNilai } = await bacaFile(uploadFile.raw)
    if (kolomNilai !== 'jumlah') {
      ElMessage.warning(
        `File ini tidak punya kolom "jumlah", jadi kolom "${kolomNilai}" yang dipakai. ` +
        `Pastikan memang dokumen dasar, bukan file pergeseran.`
      )
    }
    const baru = {
      nama: uploadFile.name,
      kolomNilai,
      rows,
      reg: buatRegistryDasar(rows, pasalMulai.value)
    }
    await api.put('/perbup-apbd/dasar', { ...baru, tahun: tahun.value }, { params: { tahun: tahun.value } })
    dasar.value = baru
    arsip.value = []
    pilih.value = -1
    ElMessage.success(`${rows.length} baris rekening tersimpan, ${Object.keys(baru.reg).length} pasal.`)
  } catch (e) {
    ElMessage.error(pesanGagal(e, 'Gagal menyimpan dokumen dasar.'))
  }
}

async function tambahPergeseran(uploadFile) {
  if (!uploadFile.raw || !dasar.value) return
  try {
    const { rows, kolomNilai } = await bacaFile(uploadFile.raw)
    if (kolomNilai === 'jumlah') {
      ElMessage.warning('File ini punya kolom "jumlah" — nilai itu yang dipakai sebagai nilai baru.')
    }
    await api.post('/perbup-apbd/pergeseran',
      { nama: uploadFile.name, kolomNilai, rows },
      { params: { tahun: tahun.value } })

    arsip.value = [...arsip.value, { nama: uploadFile.name, kolomNilai, rows }]
    pilih.value = arsip.value.length - 1
    const t = tahapan.value[pilih.value]
    ElMessage.success(
      `${labelTahap(pilih.value)}: ${t.diubah.length} pasal diubah` +
      (t.sisipan.length ? `, ${t.sisipan.length} pasal disisipkan (${t.sisipan.map(s => s.pasal).join(', ')})` : '')
    )

    // Diagnosis langsung saat unggah: mana yang cuma soal baseline, mana yang gawat.
    const asing = t.peringatan.filter(w => w.tipe === 'nilai')
    const baseline = t.peringatan.filter(w => w.tipe === 'baseline')
    if (asing.length) {
      ElMessage.error(
        `${asing.length} baris punya sebelum_perubahan yang tidak cocok dengan nilai mana pun ` +
        `sepanjang rantai. Periksa di kartu Peringatan sebelum naskah dipakai.`
      )
    } else if (baseline.length) {
      const dari = [...new Set(baseline.map(w => w.baseline))].join(', ')
      ElMessage.warning(
        `${baseline.length} baris memakai ${dari} sebagai baseline, bukan tahap sebelumnya. ` +
        `Naskah tetap benar — kolom itu tidak dipakai menghitung.`
      )
    }
  } catch (e) {
    ElMessage.error(pesanGagal(e, 'Gagal menyimpan pergeseran.'))
  }
}

async function hapusTahap(i) {
  try {
    await ElMessageBox.confirm(
      `Hapus ${labelTahap(i)} dan semua pergeseran sesudahnya? ` +
      `Nomor pasal sisipan yang lahir di tahap itu akan dilepas kembali.`,
      'Hapus pergeseran', { type: 'warning', confirmButtonText: 'Hapus', cancelButtonText: 'Batal' }
    )
  } catch { return }

  try {
    await api.delete(`/perbup-apbd/pergeseran/${i + 1}`, { params: { tahun: tahun.value } })
    arsip.value = arsip.value.slice(0, i)
    pilih.value = Math.min(pilih.value, arsip.value.length - 1)
  } catch (e) {
    ElMessage.error(pesanGagal(e, 'Gagal menghapus pergeseran.'))
  }
}

async function nomoriUlang() {
  if (!dasar.value) return
  if (arsip.value.length) {
    ElMessage.warning('Kosongkan dulu rantai pergeseran. Pasal sisipan yang sudah terbit tidak boleh dinomori ulang.')
    return
  }
  const baru = { ...dasar.value, reg: buatRegistryDasar(dasar.value.rows, pasalMulai.value) }
  try {
    await api.put('/perbup-apbd/dasar', baru, { params: { tahun: tahun.value } })
    dasar.value = baru
    ElMessage.success(`Dinomori ulang mulai Pasal ${pasalMulai.value}.`)
  } catch (e) {
    ElMessage.error(pesanGagal(e, 'Gagal menyimpan penomoran baru.'))
  }
}

// ------------------------------------------------------------ simpan / muat
const pesanGagal = (e, bawaan) => e?.response?.data?.error || e?.message || bawaan

async function muatDariServer() {
  memuat.value = true
  try {
    const { data } = await api.get('/perbup-apbd', { params: { tahun: tahun.value } })
    if (data.pengaturan) {
      pasalMulai.value = data.pengaturan.pasalMulai || 3
      nomorKlausul.value = !!data.pengaturan.nomorKlausul
      if (data.pengaturan.templateAkun) {
        templateAkun.value = { ...TEMPLATE_AKUN_DEFAULT, ...data.pengaturan.templateAkun }
      }
      if (data.pengaturan.meta) meta.value = { ...meta.value, ...data.pengaturan.meta }
    }
    // Registry dipakai apa adanya — tidak pernah dinomori ulang saat memuat.
    dasar.value = data.dasar || null
    arsip.value = data.arsip || []
    pilih.value = arsip.value.length ? arsip.value.length - 1 : -1
    siapSimpan.value = true
  } catch (e) {
    ElMessage.error(pesanGagal(e, 'Gagal memuat data dari server.'))
  } finally {
    memuat.value = false
  }
}

async function simpanPengaturan() {
  if (!siapSimpan.value) return
  try {
    await api.put('/perbup-apbd/pengaturan', {
      pasalMulai: pasalMulai.value,
      nomorKlausul: nomorKlausul.value,
      meta: meta.value,
      templateAkun: templateAkun.value
    }, { params: { tahun: tahun.value } })
  } catch {
    // Identitas dokumen tidak sekritis rantai — jangan mengganggu dengan popup
    // tiap ketukan tombol; percobaan berikutnya akan menyimpan ulang.
  }
}

function unduhState() {
  const paket = {
    versi: 2,
    tahun: tahun.value,
    pasalMulai: pasalMulai.value,
    nomorKlausul: nomorKlausul.value,
    templateAkun: templateAkun.value,
    meta: meta.value,
    dasar: dasar.value,
    arsip: arsip.value
  }
  const blob = new Blob([JSON.stringify(paket, null, 2)], { type: 'application/json' })
  const label = tahapan.value.length ? labelTahap(tahapan.value.length - 1) : 'MURNI'
  saveAs(blob, `state-perbup-${tahun.value}-${label}.json`)
}

/** Pulihkan dari berkas cadangan, lalu tulis balik ke server. */
async function muatState(uploadFile) {
  if (!uploadFile.raw) return
  try {
    const p = JSON.parse(await uploadFile.raw.text())
    if (!p.dasar?.rows?.length) throw new Error('File state tidak berisi dokumen dasar.')

    await ElMessageBox.confirm(
      `Isi server untuk TA ${tahun.value} akan diganti dengan isi berkas ini ` +
      `(${p.arsip?.length || 0} pergeseran). Nomor pasal sisipan diambil dari berkas apa adanya.`,
      'Pulihkan dari berkas',
      { type: 'warning', confirmButtonText: 'Pulihkan', cancelButtonText: 'Batal' }
    )

    await api.put('/perbup-apbd/dasar', p.dasar, { params: { tahun: tahun.value } })
    for (const a of (p.arsip || [])) {
      await api.post('/perbup-apbd/pergeseran', a, { params: { tahun: tahun.value } })
    }
    await api.put('/perbup-apbd/pengaturan', {
      pasalMulai: p.pasalMulai || 3,
      nomorKlausul: !!p.nomorKlausul,
      meta: p.meta || meta.value,
      templateAkun: p.templateAkun || templateAkun.value
    }, { params: { tahun: tahun.value } })

    await muatDariServer()
    ElMessage.success('State dipulihkan ke server.')
  } catch (e) {
    if (e === 'cancel' || e === 'close') return
    ElMessage.error(pesanGagal(e, 'File state tidak bisa dibaca.'))
  }
}

async function resetSemua() {
  try {
    await ElMessageBox.confirm(
      `Hapus dokumen dasar, seluruh rantai pergeseran, dan registry pasal TA ${tahun.value} dari server?`,
      'Reset', { type: 'warning', confirmButtonText: 'Reset', cancelButtonText: 'Batal' }
    )
  } catch { return }
  try {
    await api.delete('/perbup-apbd', { params: { tahun: tahun.value } })
    dasar.value = null
    arsip.value = []
    pilih.value = -1
  } catch (e) {
    ElMessage.error(pesanGagal(e, 'Gagal menghapus data.'))
  }
}

onMounted(muatDariServer)

// Rantai dokumen disimpan saat diunggah. Yang ditunda di sini hanya identitas
// dan preferensi, supaya mengetik tidak memicu satu request per ketukan tombol.
let tundaSimpan = null
watch([meta, templateAkun, pasalMulai, nomorKlausul], () => {
  clearTimeout(tundaSimpan)
  tundaSimpan = setTimeout(simpanPengaturan, 800)
}, { deep: true })

// ------------------------------------------------------------ ekspor
async function unduhDocx() {
  if (!blokNaskah.value.length) return
  try {
    const blob = await buatDocx(blokKeParagraf(blokNaskah.value))
    const nama = aktif.value
      ? `Perbup-Perubahan-${meta.value.nomor || 'draft'}-${meta.value.tahun}-${labelTahap(pilih.value)}.docx`
      : `Naskah-Pasal-Rekening-${meta.value.tahunAnggaran}.docx`
    saveAs(blob, nama)
  } catch (e) {
    ElMessage.error('Gagal menyusun .docx: ' + (e.message || e))
  }
}

async function unduhRiwayat() {
  if (!matriks.value.baris.length) return
  try {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Riwayat Nilai')
    ws.addRow(['pasal', 'kode', 'uraian', ...matriks.value.labels])
    ws.getRow(1).font = { bold: true }
    matriksTampil.value.forEach(b => ws.addRow([
      b.pasal, b.kode, b.uraian,
      ...b.perTahap.map(v => (v === undefined ? null : v))
    ]))
    ws.columns.forEach((c, i) => { c.width = i === 2 ? 46 : i < 2 ? 14 : 20 })
    matriks.value.labels.forEach((_, i) => { ws.getColumn(4 + i).numFmt = '#,##0.00' })
    const buf = await wb.xlsx.writeBuffer()
    saveAs(new Blob([buf]), `riwayat-nilai-perbup-${tahun.value}.xlsx`)
  } catch (e) {
    ElMessage.error('Gagal menyusun Excel: ' + (e.message || e))
  }
}

const tipePeringatan = t => (t === 'nilai' ? 'danger' : t === 'urutan' ? 'danger' : t === 'parsial' ? 'danger' : 'info')
const labelPeringatan = t => ({
  nilai: 'Angka tidak dikenal', baseline: 'Baseline berbeda', urutan: 'Konflik urutan huruf',
  hapus: 'Kode hilang', parsial: 'File mungkin parsial'
}[t] || t)

const selisihRupiah = w => (w.selisih === undefined ? '' : rupiah(w.selisih))
</script>

<template>
  <div>
    <div style="margin-bottom: 20px;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700; color: #303133;">Perbup Penjabaran APBD</h2>
      <p style="margin: 4px 0 0; font-size: 13px; color: #909399;">
        Lampiran I APBD (Excel) &rarr; naskah Perbup Penjabaran &middot; Permendagri 64 Tahun 2020 &middot;
        registry pasal berkelanjutan antar pergeseran
      </p>
    </div>

    <!-- 1. Dokumen dasar -->
    <el-card v-loading="memuat" style="margin-bottom: 16px;">
      <template #header>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-weight:600;">1. Dokumen Dasar</span>
          <span style="font-size:12px;color:#909399;">Penjabaran APBD Murni atau Penjabaran Perubahan APBD</span>
        </div>
      </template>

      <div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">
        <el-upload :auto-upload="false" :show-file-list="false" accept=".xlsx,.xls" :on-change="unggahDasar">
          <el-button type="primary" :icon="Upload">Unggah Excel Dasar</el-button>
        </el-upload>

        <div>
          <div style="font-size:12px;color:#909399;margin-bottom:4px;">Pasal pertama</div>
          <el-input-number v-model="pasalMulai" :min="1" :max="999" size="default" style="width:120px;" />
        </div>
        <el-button :disabled="!dasar || arsip.length > 0" @click="nomoriUlang">Nomori ulang</el-button>

        <div style="flex:1;"></div>

        <el-upload :auto-upload="false" :show-file-list="false" accept=".json" :on-change="muatState">
          <el-button plain>Pulihkan dari Berkas</el-button>
        </el-upload>
        <el-button plain :icon="Download" :disabled="!dasar" @click="unduhState">Cadangkan (JSON)</el-button>
        <el-button type="danger" plain :icon="Delete" :disabled="!dasar" @click="resetSemua">Reset</el-button>
      </div>

      <el-alert
        v-if="!dasar"
        type="info"
        :closable="false"
        style="margin-top:16px;"
        title="Kolom yang dibaca: kode, uraian, dan jumlah (dokumen dasar) atau setelah_perubahan (pergeseran)."
        description="Sub rincian objek (kode 17/19 karakter) dibuang otomatis. Pasal 1–2 Ketentuan Umum ditulis manual, jadi pasal rekening dimulai dari Pasal 3."
      />

      <div v-else style="margin-top:16px;display:flex;gap:32px;flex-wrap:wrap;font-size:13px;">
        <div>
          <div style="color:#909399;font-size:12px;">File</div>
          <div style="font-weight:600;">{{ dasar.nama }}</div>
        </div>
        <div>
          <div style="color:#909399;font-size:12px;">Baris rekening</div>
          <div style="font-weight:600;">{{ dasar.rows.length }}</div>
        </div>
        <div>
          <div style="color:#909399;font-size:12px;">Pasal rekening</div>
          <div style="font-weight:600;">{{ jumlahPasal }} pasal &middot; {{ rentangPasal }}</div>
        </div>
        <div>
          <div style="color:#909399;font-size:12px;">Penyimpanan</div>
          <div style="font-weight:600;color:#67c23a;">Database &middot; TA {{ tahun }}</div>
        </div>
      </div>
    </el-card>

    <!-- 2. Rantai pergeseran -->
    <el-card v-if="dasar" style="margin-bottom: 16px;">
      <template #header>
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span style="font-weight:600;">2. Rantai Pergeseran</span>
          <el-upload :auto-upload="false" :show-file-list="false" accept=".xlsx,.xls" :on-change="tambahPergeseran">
            <el-button size="small" type="primary" :icon="Upload">Tambah Pergeseran</el-button>
          </el-upload>
        </div>
      </template>

      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <el-button
          :type="pilih === -1 ? 'primary' : 'default'"
          size="small"
          @click="pilih = -1"
        >MURNI</el-button>

        <template v-for="(t, i) in tahapan" :key="i">
          <span style="color:#c0c4cc;">&rarr;</span>
          <el-button :type="pilih === i ? 'primary' : 'default'" size="small" @click="pilih = i">
            {{ labelTahap(i) }}
            <el-tag
              v-if="t.sisipan.length"
              size="small"
              type="warning"
              style="margin-left:6px;"
            >+{{ t.sisipan.length }}</el-tag>
          </el-button>
        </template>
      </div>

      <el-table v-if="tahapan.length" :data="tahapan" size="small" style="margin-top:16px;">
        <el-table-column label="#" width="60">
          <template #default="{ $index }">{{ labelTahap($index) }}</template>
        </el-table-column>
        <el-table-column prop="nama" label="File" min-width="240" show-overflow-tooltip />
        <el-table-column label="Pasal diubah" width="120" align="right">
          <template #default="{ row }">{{ row.diubah.length }}</template>
        </el-table-column>
        <el-table-column label="Disisipkan" width="160" align="right">
          <template #default="{ row }">
            <span v-if="!row.sisipan.length" style="color:#c0c4cc;">&mdash;</span>
            <el-tag v-for="s in row.sisipan" :key="s.kode" size="small" type="warning" style="margin-left:4px;">
              {{ s.pasal }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Peringatan" width="110" align="right">
          <template #default="{ row }">
            <el-tag v-if="row.peringatan.length" size="small" type="danger">{{ row.peringatan.length }}</el-tag>
            <span v-else style="color:#c0c4cc;">&mdash;</span>
          </template>
        </el-table-column>
        <el-table-column width="90" align="right">
          <template #default="{ $index }">
            <el-button size="small" text type="danger" @click="hapusTahap($index)">Hapus</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-else description="Belum ada pergeseran. Unggah file P1 untuk mulai." :image-size="60" />
    </el-card>

    <!-- 3. Registry pasal -->
    <el-card v-if="dasar" style="margin-bottom: 16px;">
      <template #header>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <span style="font-weight:600;">3. Registry Pasal</span>
            <el-tag size="small" type="primary" style="margin-left:8px;">sampai {{ labelSampai }}</el-tag>
            <span style="font-size:12px;color:#909399;margin-left:8px;">
              pengganti membuka file Word pergeseran sebelumnya
            </span>
          </div>
          <div style="display:flex;gap:12px;align-items:center;">
            <span style="font-size:12px;color:#606266;">Hanya pasal sisipan</span>
            <el-switch v-model="hanyaSisipan" size="small" />
            <el-input
              v-model="cariPasal"
              size="small"
              placeholder="cari nomor pasal / kode / uraian"
              :prefix-icon="Search"
              clearable
              style="width:260px;"
            />
          </div>
        </div>
      </template>

      <el-table :data="riwayatTampil" size="small" max-height="360">
        <el-table-column label="Pasal" width="90">
          <template #default="{ row }">
            <span :style="row.sisipan ? 'font-weight:700;color:#e6a23c;' : ''">{{ row.pasal }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="kode" label="Kode" width="140" />
        <el-table-column prop="uraian" label="Uraian" min-width="240" show-overflow-tooltip />
        <el-table-column label="Nilai berlaku" width="180" align="right">
          <template #default="{ row }">
            <span v-if="row.hilang" style="color:#f56c6c;">hilang dari file terakhir</span>
            <span v-else>{{ rupiah(row.nilai) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Terbit di" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="row.sisipan ? 'warning' : 'info'">{{ row.lahir }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="Diubah di" min-width="160">
          <template #default="{ row }">
            <span v-if="!row.diubah.length" style="color:#c0c4cc;">belum pernah</span>
            <el-tag v-for="p in row.diubah" :key="p" size="small" style="margin-right:4px;">{{ p }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 4. Riwayat nilai -->
    <el-card v-if="dasar" style="margin-bottom: 16px;">
      <template #header>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <span style="font-weight:600;">4. Riwayat Nilai</span>
            <el-tag size="small" type="primary" style="margin-left:8px;">sampai {{ labelSampai }}</el-tag>
            <span style="font-size:12px;color:#909399;margin-left:8px;">
              angka berwarna berarti berubah dari tahap sebelumnya
            </span>
          </div>
          <div style="display:flex;gap:12px;align-items:center;">
            <span style="font-size:12px;color:#606266;">Hanya yang pernah berubah</span>
            <el-switch v-model="hanyaBerubah" size="small" />
            <el-input
              v-model="cariRiwayat"
              size="small"
              placeholder="cari kode / uraian / nomor pasal"
              :prefix-icon="Search"
              clearable
              style="width:240px;"
            />
            <el-button size="small" :icon="Download" @click="unduhRiwayat">Excel</el-button>
          </div>
        </div>
      </template>

      <el-table :data="matriksTampil" size="small" max-height="420" border>
        <el-table-column label="Pasal" width="80" fixed>
          <template #default="{ row }">{{ row.pasal }}</template>
        </el-table-column>
        <el-table-column prop="kode" label="Kode" width="130" fixed />
        <el-table-column prop="uraian" label="Uraian" min-width="230" show-overflow-tooltip fixed />
        <el-table-column
          v-for="(l, i) in matriks.labels"
          :key="l"
          :label="l"
          width="170"
          align="right"
        >
          <template #default="{ row }">
            <span v-if="row.perTahap[i] === undefined" style="color:#c0c4cc;">&mdash;</span>
            <span v-else :style="row.beda[i] ? 'color:#e6a23c;font-weight:700;' : 'color:#606266;'">
              {{ rupiah(row.perTahap[i]) }}
            </span>
          </template>
        </el-table-column>
      </el-table>

      <div style="margin-top:8px;font-size:12px;color:#909399;">
        {{ matriksTampil.length }} dari {{ matriks.baris.length }} rekening ditampilkan.
        Kolom MURNI selalu nilai dokumen dasar; tanda &mdash; berarti kode itu belum ada
        (atau sudah hilang) pada tahap tersebut.
      </div>
    </el-card>

    <!-- 5. Peringatan -->
    <el-card v-if="semuaPeringatan.length" style="margin-bottom: 16px;">
      <template #header>
        <span style="font-weight:600;">5. Peringatan</span>
        <el-tag size="small" type="primary" style="margin-left:8px;">sampai {{ labelSampai }}</el-tag>
        <span style="font-size:12px;color:#909399;margin-left:8px;">
          hal yang tidak bisa dilihat dari Riwayat Nilai
        </span>
      </template>

      <el-alert
        v-if="peringatanPenting.length"
        type="error"
        :closable="false"
        show-icon
        style="margin-bottom:12px;"
        :title="`${peringatanPenting.length} hal yang perlu diputuskan manusia sebelum naskah dipakai`"
      />
      <el-alert
        v-else
        type="success"
        :closable="false"
        show-icon
        style="margin-bottom:12px;"
        title="Tidak ada yang perlu diputuskan. Semua angka bisa dilacak ke tahap dalam rantai."
      />

      <el-table v-if="peringatanPenting.length" :data="peringatanPenting" size="small" max-height="320">
        <el-table-column label="Tahap" width="70" prop="tahap" />
        <el-table-column label="Jenis" width="160">
          <template #default="{ row }">
            <el-tag size="small" :type="tipePeringatan(row.tipe)">{{ labelPeringatan(row.tipe) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="kode" label="Kode" width="130" />
        <el-table-column prop="uraian" label="Uraian" min-width="180" show-overflow-tooltip />
        <el-table-column label="Selisih" width="150" align="right">
          <template #default="{ row }">{{ selisihRupiah(row) }}</template>
        </el-table-column>
        <el-table-column prop="catatan" label="Catatan" min-width="340" />
      </el-table>

      <!-- Baseline: sudah bisa diperiksa sendiri di Riwayat Nilai, jadi cukup satu baris. -->
      <div v-if="peringatanBaseline.length" style="margin-top:8px;font-size:12px;color:#909399;">
        <span v-for="(g, i) in ringkasanBaseline" :key="g.tahap + g.baseline">
          <span v-if="i"> &middot; </span>
          <strong>{{ g.tahap }}</strong> menulis <code>sebelum_perubahan</code> memakai baseline
          <strong>{{ g.baseline }}</strong> pada {{ g.jumlah }} baris
        </span>
        &mdash; tidak mempengaruhi naskah, karena pembandingnya state, bukan kolom itu.
        <el-button size="small" text @click="bukaBaseline = !bukaBaseline">
          {{ bukaBaseline ? 'sembunyikan rincian' : 'lihat rincian' }}
        </el-button>
        <el-table v-if="bukaBaseline" :data="peringatanBaseline" size="small" max-height="300">
          <el-table-column label="Tahap" width="70" prop="tahap" />
          <el-table-column prop="kode" label="Kode" width="130" />
          <el-table-column prop="uraian" label="Uraian" min-width="200" show-overflow-tooltip />
          <el-table-column label="Tertulis" width="160" align="right">
            <template #default="{ row }">{{ rupiah(row.tertulis) }}</template>
          </el-table-column>
          <el-table-column label="Berlaku" width="160" align="right">
            <template #default="{ row }">{{ rupiah(row.berlaku) }}</template>
          </el-table-column>
          <el-table-column label="Cocok dengan" width="120">
            <template #default="{ row }"><el-tag size="small" type="info">{{ row.baseline }}</el-tag></template>
          </el-table-column>
        </el-table>
      </div>
    </el-card>

    <!-- 6. Naskah -->
    <el-card v-if="dasar" style="margin-bottom: 16px;">
      <template #header>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <span style="font-weight:600;">
            6. Naskah &mdash;
            <template v-if="aktif">{{ labelTahap(pilih) }} &middot; {{ aktif.nama }}</template>
            <template v-else>Dokumen Dasar (pasal rekening, BAB II dst.)</template>
          </span>
          <div style="display:flex;gap:12px;align-items:center;">
            <template v-if="aktif">
              <span style="font-size:12px;color:#606266;">Nomori klausul</span>
              <el-switch v-model="nomorKlausul" size="small" />
            </template>
            <el-button type="primary" :icon="DocIcon" @click="unduhDocx">Unduh .docx</el-button>
          </div>
        </div>
      </template>

      <div v-if="aktif" style="display:flex;gap:24px;margin-bottom:12px;font-size:13px;">
        <div><span style="color:#909399;">Pasal diubah:</span> <strong>{{ aktif.diubah.length }}</strong></div>
        <div>
          <span style="color:#909399;">Disisipkan:</span>
          <strong>{{ aktif.sisipan.length ? aktif.sisipan.map(s => s.pasal).join(', ') : '—' }}</strong>
        </div>
        <div><span style="color:#909399;">Total klausul:</span> <strong>{{ aktif.klausul.length }}</strong></div>
      </div>

      <el-alert
        v-else
        type="info"
        :closable="false"
        style="margin-bottom:12px;"
        title="BAB I Ketentuan Umum, Pasal 1–2, serta pasal penutup (defisit, daftar Lampiran, DPA SKPD) tetap ditulis manual — engine tidak mengarang isinya."
      />

      <div class="naskah">
        <p v-for="(b, i) in blokNaskah" :key="i" :style="gayaPratinjau(b)">{{ b.teks }}</p>
      </div>
    </el-card>

    <!-- 6. Identitas -->
    <el-card v-if="dasar" style="margin-bottom: 16px;">
      <template #header>
        <span style="font-weight:600;">7. Identitas Dokumen</span>
        <span style="font-size:12px;color:#909399;margin-left:8px;">dipakai saat ekspor .docx pergeseran</span>
      </template>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;">
        <div v-for="f in [
          { k: 'daerah', l: 'Daerah' },
          { k: 'provinsi', l: 'Provinsi' },
          { k: 'nomor', l: 'Nomor Perbup ini' },
          { k: 'tahun', l: 'Tahun' },
          { k: 'perbupDasar', l: 'Perbup yang diubah (mis. Nomor 2 Tahun 2026)' },
          { k: 'tahunAnggaran', l: 'Tahun anggaran' },
          { k: 'tempatTanggal', l: 'Tempat & tanggal' },
          { k: 'jabatanPenetap', l: 'Jabatan penetap' },
          { k: 'namaPenetap', l: 'Nama penetap' },
          { k: 'jabatanPengundang', l: 'Jabatan pengundang' },
          { k: 'namaPengundang', l: 'Nama pengundang' }
        ]" :key="f.k">
          <div style="font-size:12px;color:#909399;margin-bottom:4px;">{{ f.l }}</div>
          <el-input v-model="meta[f.k]" size="default" />
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
        <div>
          <div style="font-size:12px;color:#909399;margin-bottom:4px;">Menimbang (satu baris satu huruf)</div>
          <el-input v-model="meta.menimbang" type="textarea" :rows="4" />
        </div>
        <div>
          <div style="font-size:12px;color:#909399;margin-bottom:4px;">Mengingat (satu baris satu angka)</div>
          <el-input v-model="meta.mengingat" type="textarea" :rows="4" />
        </div>
      </div>

      <div style="margin-top:16px;">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px;">Kalimat pasal akun</div>
        <div style="font-size:12px;color:#909399;margin-bottom:8px;">
          Tersedia token <code>{uraian}</code>, <code>{tahun}</code>, <code>{nilai}</code>.
          Pembiayaan sengaja tanpa <code>{nilai}</code> sesuai naskah aslinya.
        </div>
        <div style="display:grid;grid-template-columns:1fr;gap:8px;">
          <div v-for="k in ['4', '5', '6', 'lain']" :key="k" style="display:flex;gap:8px;align-items:center;">
            <el-tag size="small" style="width:64px;justify-content:center;">
              {{ k === '4' ? 'Akun 4' : k === '5' ? 'Akun 5' : k === '6' ? 'Akun 6' : 'lainnya' }}
            </el-tag>
            <el-input v-model="templateAkun[k]" size="small" />
          </div>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.naskah {
  max-height: 32rem;
  overflow-y: auto;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 20px 24px;
  background: #fff;
  font-family: 'Bookman Old Style', Georgia, serif;
  font-size: 13px;
  line-height: 1.7;
}
.naskah p {
  margin: 0 0 8px;
}
</style>
