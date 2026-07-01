import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

const FIELD_MAP = {
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

const cols = Object.values(FIELD_MAP)

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
// Kolom DB yang boleh diisi langsung kalau baris datang dalam format SIPD.
const dbCols = new Set(cols)

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
    for (const [excelKey, col] of Object.entries(FIELD_MAP)) out[col] = row[excelKey]
  } else {
    for (const [key, val] of Object.entries(row ?? {})) {
      const col = SIPD_ALIAS[key] ?? key
      if (dbCols.has(col)) out[col] = val
    }
  }
  for (const col of DATETIME_COLS) out[col] = toMysqlDatetime(out[col])
  return out
}

const BULAN_ID = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6,
  juli: 7, agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
}

// tanggal_dokumen bisa berupa ISO date dari SIPD ("2026-01-07T00:00:00Z")
// atau teks bernama bulan Indonesia dari Excel lama ("7 Januari 2026").
function parseBulan(tanggalDokumen) {
  const s = String(tanggalDokumen ?? '').trim()
  if (!s) return null
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const m = Number(iso[2])
    return m >= 1 && m <= 12 ? m : null
  }
  const match = s.toLowerCase().match(/[a-z]+/)
  if (!match) return null
  return BULAN_ID[match[0]] ?? null
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

router.get('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT dr.*
     FROM dokumen_realisasi dr
     INNER JOIN tahun_anggaran ta ON dr.tahun_id = ta.id
     WHERE dr.user_id = ? AND ta.tahun = ?
     ORDER BY dr.id`,
    [user.id, tahun]
  )
  return c.json({ data: rows })
})

router.post('/', async (c) => {
  const user = c.get('user')
  const { data, tahun } = await c.req.json()

  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const [taRows] = await db.query(
    'SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun]
  )
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const rowsWithBulan = data.map(raw => {
    const row = toDbRow(raw)
    return { row, bulan: parseBulan(row.tanggal_dokumen) }
  })
  const bulanSet = [...new Set(rowsWithBulan.map(r => r.bulan))]

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    if (bulanSet.length) {
      const bulanPlaceholders = bulanSet.map(() => '?').join(', ')
      const bulanClause = bulanSet.includes(null)
        ? `(bulan IS NULL OR bulan IN (${bulanPlaceholders}))`
        : `bulan IN (${bulanPlaceholders})`
      await conn.query(
        `DELETE FROM dokumen_realisasi WHERE user_id = ? AND tahun_id = ? AND ${bulanClause}`,
        [user.id, tahun_id, ...bulanSet.filter(b => b !== null)]
      )
    }

    const placeholders = cols.map(() => '?').join(', ')
    const BATCH = 100
    for (let i = 0; i < rowsWithBulan.length; i += BATCH) {
      const chunk = rowsWithBulan.slice(i, i + BATCH)
      const rowPlaceholders = chunk.map(() => `(?, ?, ?, ${placeholders})`).join(', ')
      const values = chunk.flatMap(({ row, bulan }) => [
        user.id,
        tahun_id,
        bulan,
        ...cols.map(col => normalizeVal(row[col])),
      ])
      await conn.query(
        `INSERT INTO dokumen_realisasi (user_id, tahun_id, bulan, ${cols.join(', ')}) VALUES ${rowPlaceholders}`,
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
})

router.delete('/', async (c) => {
  const user = c.get('user')
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  await db.query(
    `DELETE dr FROM dokumen_realisasi dr
     INNER JOIN tahun_anggaran ta ON dr.tahun_id = ta.id
     WHERE dr.user_id = ? AND ta.tahun = ?`,
    [user.id, tahun]
  )
  return c.json({ success: true })
})

export default router
