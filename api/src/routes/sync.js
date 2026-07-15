import { Hono } from 'hono'
import db from '../db.js'
import { requireApiKey } from '../middleware/apiKey.js'

// Handler operasi TULIS untuk data SIPD. Dipakai lewat DUA pintu:
//  - /api/sync/*            -> extension, dilindungi API key (router di file ini)
//  - /api/sumber-data/* dsb -> dashboard upload manual, dilindungi JWT
//    (route lama meng-import handler yang sama, lihat ekspor di bawah)
// Data bersifat bersama antar user, jadi tidak ada scoping user_id — cukup tahun_id.

async function resolveTahunId(tahun) {
  const [taRows] = await db.query(
    'SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun]
  )
  return taRows[0]?.id ?? null
}

// ---------------------------------------------------------------------------
// SKPD
// ---------------------------------------------------------------------------
export const syncSkpd = async (c) => {
  const { data, tahun } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM skpd WHERE tahun_id = ?', [tahun_id])

    const BATCH = 500
    for (let i = 0; i < data.length; i += BATCH) {
      const chunk = data.slice(i, i + BATCH)
      const placeholders = chunk.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
      const values = chunk.flatMap(row => [
        tahun_id,
        row.id_skpd ?? null,
        row.id_daerah ?? null,
        row.kode_skpd ?? null,
        row.nama_skpd ?? null,
        row.nip_kepala ?? null,
        row.nama_kepala ?? null,
        row.id_unit ?? null,
        row.is_skpd ?? 0,
        row.status ?? null,
        row.setup_unit ?? 0,
        row.kunci_skpd ?? 0,
        row.posisi ?? null,
      ])
      await conn.query(
        `INSERT INTO skpd
          (id, tahun_id, id_skpd, id_daerah, kode_skpd, nama_skpd, nip_kepala, nama_kepala,
           id_unit, is_skpd, status, setup_unit, kunci_skpd, posisi)
         VALUES ${placeholders}`,
        values
      )
    }

    const now = new Date()
    await conn.query(
      'UPDATE tahun_anggaran SET skpd_synced_at = ? WHERE id = ?',
      [now, tahun_id]
    )

    await conn.commit()
    return c.json({ success: true, count: data.length, synced_at: now.toISOString() })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

// ---------------------------------------------------------------------------
// Sub Kegiatan (referensi hierarki urusan/program/kegiatan)
// ---------------------------------------------------------------------------
export const syncSubKegiatan = async (c) => {
  const { data, tahun } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  // Extension login per-unit, jadi satu payload cuma berisi data unit yang
  // sedang login. Hapus hanya baris unit-unit yang ada di payload ini, biar
  // data unit lain yang sudah tersinkron untuk tahun ini tidak ikut terhapus.
  const idUnits = [...new Set(data.map(row => row.id_unit))]

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query(
      `DELETE FROM sub_kegiatan WHERE tahun_id = ? AND id_unit IN (${idUnits.map(() => '?').join(', ')})`,
      [tahun_id, ...idUnits]
    )

    const BATCH = 500
    for (let i = 0; i < data.length; i += BATCH) {
      const chunk = data.slice(i, i + BATCH)
      const placeholders = chunk.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
      const values = chunk.flatMap(row => [
        tahun_id,
        row.id_unit ?? null,
        row.id_skpd ?? null,
        row.kode_skpd ?? null,
        row.nama_skpd ?? null,
        row.id_sub_skpd ?? null,
        row.kode_sub_skpd ?? null,
        row.nama_sub_skpd ?? null,
        row.id_urusan ?? null,
        row.kode_urusan ?? null,
        row.nama_urusan ?? null,
        row.id_bidang_urusan ?? null,
        row.kode_bidang_urusan ?? null,
        row.nama_bidang_urusan ?? null,
        row.id_program ?? null,
        row.kode_program ?? null,
        row.nama_program ?? null,
        row.id_giat ?? null,
        row.kode_giat ?? null,
        row.nama_giat ?? null,
        row.id_sub_giat ?? null,
        row.kode_sub_giat ?? null,
        row.nama_sub_giat ?? null,
      ])
      await conn.query(
        `INSERT INTO sub_kegiatan
          (id, tahun_id, id_unit, id_skpd, kode_skpd, nama_skpd, id_sub_skpd, kode_sub_skpd, nama_sub_skpd,
           id_urusan, kode_urusan, nama_urusan, id_bidang_urusan, kode_bidang_urusan, nama_bidang_urusan,
           id_program, kode_program, nama_program, id_giat, kode_giat, nama_giat,
           id_sub_giat, kode_sub_giat, nama_sub_giat)
         VALUES ${placeholders}`,
        values
      )
    }

    await conn.commit()
    return c.json({ success: true, count: data.length })
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

// ---------------------------------------------------------------------------
// Subkegiatan PMK
// ---------------------------------------------------------------------------
export const syncSubkegiatanPmk = async (c) => {
  const { data, tahun } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  await db.query('DELETE FROM subkegiatan_pmk WHERE tahun_id = ?', [tahun_id])

  const BATCH = 500
  for (let i = 0; i < data.length; i += BATCH) {
    const chunk = data.slice(i, i + BATCH)
    const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ')
    const values = chunk.flatMap(row => [
      tahun_id,
      row.kode_sub_kegiatan ?? row.kode_subkegiatan ?? null,
      row.sub_kegiatan ?? row.subkegiatan ?? null,
      row.bidang ?? null,
    ])
    await db.query(
      `INSERT INTO subkegiatan_pmk (tahun_id, kode_sub_kegiatan, sub_kegiatan, bidang)
       VALUES ${placeholders}`,
      values
    )
  }

  return c.json({ success: true, inserted: data.length })
}

// ---------------------------------------------------------------------------
// Anggaran (rekap pagu)
// ---------------------------------------------------------------------------
const ANGGARAN_FIELD_MAP = {
  'NO':                   'no',
  'TAHUN':                'tahun_file',
  'KODE URUSAN':          'kode_urusan',
  'NAMA URUSAN':          'nama_urusan',
  'KODE SKPD':            'kode_skpd',
  'NAMA SKPD':            'nama_skpd',
  'KODE SUB UNIT':        'kode_sub_unit',
  'NAMA SUB UNIT':        'nama_sub_unit',
  'KODE BIDANG URUSAN':   'kode_bidang_urusan',
  'NAMA BIDANG URUSAN':   'nama_bidang_urusan',
  'KODE PROGRAM':         'kode_program',
  'NAMA PROGRAM':         'nama_program',
  'KODE KEGIATAN':        'kode_kegiatan',
  'NAMA KEGIATAN':        'nama_kegiatan',
  'KODE SUB KEGIATAN':    'kode_sub_kegiatan',
  'NAMA SUB KEGIATAN':    'nama_sub_kegiatan',
  'KODE SUMBER DANA':     'kode_sumber_dana',
  'NAMA SUMBER DANA':     'nama_sumber_dana',
  'KODE REKENING':        'kode_rekening',
  'NAMA REKENING':        'nama_rekening',
  'PAKET/KELOMPOK':       'paket_kelompok',
  'NAMA PAKET/KELOMPOK':  'nama_paket_kelompok',
  'PAGU':                 'pagu',
}
const anggaranCols = Object.values(ANGGARAN_FIELD_MAP)

export const syncAnggaran = async (c) => {
  const { data, tahun } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM anggaran_rekap WHERE tahun_id = ?', [tahun_id])

    const placeholders = anggaranCols.map(() => '?').join(', ')
    const BATCH = 200
    for (let i = 0; i < data.length; i += BATCH) {
      const chunk = data.slice(i, i + BATCH)
      const rowPlaceholders = chunk.map(() => `(?, ${placeholders})`).join(', ')
      const values = chunk.flatMap(row => [
        tahun_id,
        ...Object.keys(ANGGARAN_FIELD_MAP).map(excelKey => {
          const val = row[excelKey] ?? null
          return val === '' ? null : val
        }),
      ])
      await conn.query(
        `INSERT INTO anggaran_rekap (tahun_id, ${anggaranCols.join(', ')}) VALUES ${rowPlaceholders}`,
        values
      )
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  return c.json({ success: true, inserted: data.length })
}

// ---------------------------------------------------------------------------
// Dokumen Realisasi
// ---------------------------------------------------------------------------
const REALISASI_FIELD_MAP = {
  'Kode SKPD':               'kode_skpd',
  'Nama SKPD':               'nama_skpd',
  'Kode Sub SKPD':           'kode_sub_skpd',
  'Nama Sub SKPD':           'nama_sub_skpd',
  'Kode Fungsi':             'kode_fungsi',
  'Nama Fungsi':             'nama_fungsi',
  'Kode Sub Fungsi':         'kode_sub_fungsi',
  'Nama Sub Fungsi':         'nama_sub_fungsi',
  'Kode Urusan':             'kode_urusan',
  'Nama Urusan':             'nama_urusan',
  'Kode Bidang Urusan':      'kode_bidang_urusan',
  'Nama Bidang Urusan':      'nama_bidang_urusan',
  'Kode Program':            'kode_program',
  'Nama Program':            'nama_program',
  'Kode Kegiatan':           'kode_kegiatan',
  'Nama Kegiatan':           'nama_kegiatan',
  'Kode Sub Kegiatan':       'kode_sub_kegiatan',
  'Nama Sub Kegiatan':       'nama_sub_kegiatan',
  'Kode Rekening':           'kode_rekening',
  'Nama Rekening':           'nama_rekening',
  'Nomor Dokumen':           'nomor_dokumen',
  'Jenis Dokumen':           'jenis_dokumen',
  'Jenis Transaksi':         'jenis_transaksi',
  'Nomor DPT':               'nomor_dpt',
  'Tanggal Dokumen':         'tanggal_dokumen',
  'Keterangan Dokumen':      'keterangan_dokumen',
  'Nilai Realisasi':         'nilai_realisasi',
  'Nilai Setoran':           'nilai_setoran',
  'NIP Pegawai':             'nip_pegawai',
  'Nama Pegawai':            'nama_pegawai',
  'Tanggal Simpan':          'tanggal_simpan',
  'Nomor SPD':               'nomor_spd',
  'Periode SPD':             'periode_spd',
  'Nilai SPD':               'nilai_spd',
  'Tahapan SPD':             'tahapan_spd',
  'Nama Sub Tahapan Jadwal': 'nama_sub_tahapan_jadwal',
  'Tahapan APBD':            'tahapan_apbd',
  'Nomor SPP':               'nomor_spp',
  'Tanggal SPP':             'tanggal_spp',
  'Nomor SPM':               'nomor_spm',
  'Tanggal SPM':             'tanggal_spm',
  'Nomor SP2D':              'nomor_sp2d',
  'Tanggal SP2D':            'tanggal_sp2d',
  'Tanggal Transfer':        'tanggal_transfer',
  'Nilai SP2D':              'nilai_sp2d',
}
const realisasiCols = Object.values(REALISASI_FIELD_MAP)

// Field JSON dari API SIPD Penatausahaan -> kolom DB. Mayoritas sudah sama
// dengan nama kolom; yang di bawah ini ejaan/aliasnya berbeda di sisi SIPD.
const SIPD_ALIAS = {
  kode_giat:             'kode_kegiatan',
  nama_giat:             'nama_kegiatan',
  kode_sub_giat:         'kode_sub_kegiatan',
  nama_sub_giat:         'nama_sub_kegiatan',
  nilai_spd_detail:      'nilai_spd',
  tahap_spd:             'tahapan_spd',
  nama_sub_tahap_jadwal: 'nama_sub_tahapan_jadwal',
  status_tahap_apbd:     'tahapan_apbd',
  tanggal_sp2d_transfer: 'tanggal_transfer',
}
const dbCols = new Set(realisasiCols)

// Kolom bertipe DATETIME(6). SIPD mengirim ISO 8601 ("2026-01-07T00:00:00Z"
// atau "...T00:17:33.988876Z") yang tidak diterima MySQL apa adanya -> ubah
// jadi "2026-01-07 00:00:00.988876" (buang 'T'/'Z', konversi ke waktu lokal
// tidak dilakukan; offset 'Z'/'+hh:mm' cukup dibuang karena data SIPD zona lokal).
const DATETIME_COLS = new Set([
  'tanggal_dokumen', 'tanggal_simpan', 'tanggal_spp',
  'tanggal_spm', 'tanggal_sp2d', 'tanggal_transfer',
])

function toMysqlDatetime(val) {
  if (val === null || val === undefined) return null
  const s = String(val).trim()
  if (!s) return null
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)/)
  if (!m) return null // format tak dikenal -> NULL, jangan sampai insert gagal
  return `${m[1]} ${m[2]}`
}

// Ubah satu baris (format Excel-header ATAU format API SIPD) menjadi objek
// berkunci nama kolom DB. Deteksi: kalau ada key khas Excel -> pakai FIELD_MAP,
// selain itu diperlakukan sebagai payload SIPD (snake_case + alias).
function toDbRow(row) {
  const out = {}
  if (row && Object.prototype.hasOwnProperty.call(row, 'Kode Sub Kegiatan')) {
    for (const [excelKey, col] of Object.entries(REALISASI_FIELD_MAP)) out[col] = row[excelKey]
  } else {
    for (const [key, val] of Object.entries(row ?? {})) {
      const col = SIPD_ALIAS[key] ?? key
      if (dbCols.has(col)) out[col] = val
    }
  }
  for (const col of DATETIME_COLS) out[col] = toMysqlDatetime(out[col])
  return out
}

// Normalisasi nilai dari Excel: string kosong / "null" / "undefined" / "-"
// harus jadi NULL beneran, bukan tersimpan sebagai teks literal.
function normalizeVal(val) {
  if (val === null || val === undefined) return null
  const s = String(val).trim()
  if (s === '' || s === '-') return null
  const lower = s.toLowerCase()
  if (lower === 'null' || lower === 'undefined') return null
  return val
}

export const syncDokumenRealisasi = async (c) => {
  const { data, tahun, bulan } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  const bulanNum = Number(bulan)
  if (!Number.isInteger(bulanNum) || bulanNum < 1 || bulanNum > 12)
    return c.json({ error: 'bulan wajib diisi (angka 1-12)' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const rows = data.map(toDbRow)

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // Ganti seluruh data untuk tahun+bulan yang dikirim (bukan diturunkan dari tanggal_dokumen).
    await conn.query(
      `DELETE FROM dokumen_realisasi WHERE tahun_id = ? AND bulan = ?`,
      [tahun_id, bulanNum]
    )

    const placeholders = realisasiCols.map(() => '?').join(', ')
    const BATCH = 100
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      const rowPlaceholders = chunk.map(() => `(?, ?, ${placeholders})`).join(', ')
      const values = chunk.flatMap(row => [
        tahun_id,
        bulanNum,
        ...realisasiCols.map(col => normalizeVal(row[col])),
      ])
      await conn.query(
        `INSERT INTO dokumen_realisasi (tahun_id, bulan, ${realisasiCols.join(', ')}) VALUES ${rowPlaceholders}`,
        values
      )
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  return c.json({ success: true, inserted: data.length })
}

// Router extension: semua tulis lewat API key.
const router = new Hono()
router.use('*', requireApiKey)
router.post('/skpd', syncSkpd)
router.post('/sub-kegiatan', syncSubKegiatan)
router.post('/subkegiatan-pmk', syncSubkegiatanPmk)
router.post('/anggaran', syncAnggaran)
router.post('/dokumen-realisasi', syncDokumenRealisasi)

export default router
