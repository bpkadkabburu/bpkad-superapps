<script setup>
import { ref, computed } from 'vue'
import { DocumentCopy } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { subRincianRekening } from '../../api/src/utils/kodeRekening.js'

// daftar: [{ kunci, label, banding, golongan }] — `banding` hasil bandingkanInputan
// dari tiap RancanganPaguPanel (gaji/tpp punya golongan PNS/PPPK, PPPK Paruh
// Waktu tidak). Murni dibaca ulang dari state yang sudah dihitung masing-masing
// panel — tidak ada fetch/hitung baru, dan TIDAK ada yang disimpan: "kunci"
// di sini cuma penanda di layar supaya tahu dinas mana yang aman dikunci di
// SIPD-RI, bukan tindakan yang menyentuh SIPD atau database aplikasi ini.
const props = defineProps({
  daftar: { type: Array, required: true },
})

function formatRp(val) {
  return 'Rp' + Number(val || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
}
function formatSelisih(val) {
  const n = Number(val || 0)
  if (!n) return '—'
  return (n > 0 ? '+' : '−') + formatRp(Math.abs(n))
}

const LABEL_GOLONGAN = { '00001': 'PNS', '00002': 'PPPK' }

// Kolom status: kategori yang punya golongan (Gaji, TPP) dipecah jadi dua
// kolom PNS/PPPK sendiri-sendiri — supaya "PNS sudah sesuai tapi PPPK belum"
// kelihatan langsung, bukan tertutup jadi satu status "bermasalah" saja.
const kolomStatus = computed(() => props.daftar.flatMap(({ kunci, label, golongan }) => golongan
  ? [{ kunci: `${kunci}_00001`, label: `${label} PNS` }, { kunci: `${kunci}_00002`, label: `${label} PPPK` }]
  : [{ kunci, label }]))

// ---- Status kunci per OPD: dicek lintas semua kolom sekaligus ----
const statusOpd = computed(() => {
  const peta = new Map() // kodeSkpd -> { kodeSkpd, namaSkpd, status: {kolomKunci: 'ok'|'bermasalah'} }
  for (const { kunci, banding, golongan } of props.daftar) {
    if (!banding) continue
    const bersihPerOpd = new Map() // kodeSkpd -> { namaSkpd, '': bool } atau { namaSkpd, '00001': bool, '00002': bool }
    for (const b of banding.baris) {
      let e = bersihPerOpd.get(b.kodeSkpd)
      if (!e) { e = { namaSkpd: b.namaSkpd, '': true, '00001': true, '00002': true }; bersihPerOpd.set(b.kodeSkpd, e) }
      if (b.status !== 'sesuai') {
        if (!golongan) { e[''] = false; continue }
        const gol = subRincianRekening(b.kodeRekening)
        // Golongan tak dikenal (jarang terjadi) dianggap kena dua-duanya,
        // supaya masalahnya tidak hilang dari radar begitu saja.
        if (gol === '00001' || gol == null) e['00001'] = false
        if (gol === '00002' || gol == null) e['00002'] = false
      }
    }
    for (const [kodeSkpd, info] of bersihPerOpd) {
      let p = peta.get(kodeSkpd)
      if (!p) { p = { kodeSkpd, namaSkpd: info.namaSkpd, status: {} }; peta.set(kodeSkpd, p) }
      p.namaSkpd = info.namaSkpd
      if (golongan) {
        p.status[`${kunci}_00001`] = info['00001'] ? 'ok' : 'bermasalah'
        p.status[`${kunci}_00002`] = info['00002'] ? 'ok' : 'bermasalah'
      } else {
        p.status[kunci] = info[''] ? 'ok' : 'bermasalah'
      }
    }
  }
  return [...peta.values()]
    .map(p => ({ ...p, bisaDikunci: Object.values(p.status).every(s => s !== 'bermasalah') }))
    .sort((a, b) => String(a.kodeSkpd).localeCompare(String(b.kodeSkpd), 'id', { numeric: true }))
})
const jumlahBisaDikunci = computed(() => statusOpd.value.filter(o => o.bisaDikunci).length)

// ---- Ringkasan teks siap-tempel (cuma yang bermasalah) ----
const teksRingkasan = computed(() => {
  const baris = [`*Cek Rancangan Pagu* — dibuat ${new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}`]

  for (const { label, banding, golongan } of props.daftar) {
    baris.push('')
    baris.push(`*${label}*`)
    if (!banding) { baris.push('(belum ada rancangan tersimpan)'); continue }
    const bermasalah = banding.baris.filter(b => b.status !== 'sesuai')
    if (!bermasalah.length) { baris.push('Semua sesuai ✅'); continue }

    const kelompok = new Map() // label grup (golongan atau '') -> Map(namaSkpd -> baris[])
    for (const b of bermasalah) {
      const g = golongan ? (LABEL_GOLONGAN[subRincianRekening(b.kodeRekening)] || 'Lainnya') : ''
      if (!kelompok.has(g)) kelompok.set(g, new Map())
      const perOpd = kelompok.get(g)
      if (!perOpd.has(b.namaSkpd)) perOpd.set(b.namaSkpd, [])
      perOpd.get(b.namaSkpd).push(b)
    }
    for (const [g, perOpd] of kelompok) {
      if (g) baris.push(`_${g}_`)
      for (const [namaSkpd, rows] of perOpd) {
        baris.push(`• ${namaSkpd}`)
        for (const b of rows) {
          baris.push(`   - ${b.namaRekening}: sistem ${formatRp(b.usulan)}, rancangan ${formatRp(b.inputan)} (selisih ${formatSelisih(b.selisih)})`)
        }
      }
    }
  }
  return baris.join('\n')
})

const disalin = ref(false)
async function salinRingkasan() {
  try {
    await navigator.clipboard.writeText(teksRingkasan.value)
    disalin.value = true
    ElMessage.success('Ringkasan disalin ke clipboard')
    setTimeout(() => { disalin.value = false }, 2000)
  } catch {
    ElMessage.error('Gagal menyalin — salin manual dari kotak teks di bawah.')
  }
}
</script>

<template>
  <div>
    <el-card style="margin-bottom: 16px;">
      <div style="font-size: 14px; font-weight: 700; color: #303133; margin-bottom: 4px;">
        Status kunci per OPD
      </div>
      <p style="margin: 0 0 12px; font-size: 12px; color: #909399; line-height: 1.6;">
        Penanda saja — menunjukkan OPD mana yang Gaji, TPP, dan PPPK Paruh Waktu-nya sudah
        <strong>sama-sama sesuai</strong> rancangan, jadi aman dikunci di SIPD-RI. Tidak mengubah apa pun di
        SIPD atau di aplikasi ini.
      </p>
      <el-alert type="success" :closable="false" show-icon style="margin-bottom: 12px;">
        <template #title>
          <span style="font-size: 12px;">{{ jumlahBisaDikunci }} dari {{ statusOpd.length }} OPD bisa dikunci.</span>
        </template>
      </el-alert>
      <el-table :data="statusOpd" row-key="kodeSkpd" border size="small" class="tabel-rapat" style="width: 100%;"
        max-height="500"
        :header-cell-style="{ background: '#f5f7fa', color: '#606266', fontSize: '12px', fontWeight: '600' }">
        <el-table-column label="OPD" prop="namaSkpd" min-width="220" show-overflow-tooltip sortable />
        <el-table-column v-for="{ kunci, label } in kolomStatus" :key="kunci" :label="label" width="110" align="center">
          <template #default="{ row }">
            <span v-if="row.status[kunci] === 'ok'" style="color: #67c23a; font-weight: 700;">OK</span>
            <span v-else-if="row.status[kunci] === 'bermasalah'" style="color: #f56c6c; font-weight: 700;">TIDAK SESUAI</span>
            <span v-else style="color: #c0c4cc;">&mdash;</span>
          </template>
        </el-table-column>
        <el-table-column label="Kesimpulan" min-width="150" align="center" fixed="right">
          <template #default="{ row }">
            <span v-if="row.bisaDikunci" style="color: #67c23a; font-weight: 700;">✅ Bisa dikunci</span>
            <span v-else style="color: #f56c6c; font-weight: 700;">⛔ Belum</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card>
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <span style="font-size: 14px; font-weight: 700; color: #303133;">Ringkasan siap tempel</span>
        <el-button type="primary" plain size="small" :icon="DocumentCopy" @click="salinRingkasan">
          {{ disalin ? 'Tersalin!' : 'Salin' }}
        </el-button>
      </div>
      <p style="margin: 0 0 10px; font-size: 12px; color: #909399; line-height: 1.6;">
        Cuma memuat yang tidak sesuai — OPD yang semua rekeningnya sudah sesuai tidak disebut.
      </p>
      <el-input type="textarea" :model-value="teksRingkasan" readonly :rows="16"
        style="font-family: monospace; font-size: 12px;" />
    </el-card>
  </div>
</template>
