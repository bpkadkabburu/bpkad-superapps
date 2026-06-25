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

  await db.query(
    'DELETE FROM dokumen_realisasi WHERE user_id = ? AND tahun_id = ?',
    [user.id, tahun_id]
  )

  const placeholders = cols.map(() => '?').join(', ')
  const BATCH = 100
  for (let i = 0; i < data.length; i += BATCH) {
    const chunk = data.slice(i, i + BATCH)
    const rowPlaceholders = chunk.map(() => `(?, ?, ${placeholders})`).join(', ')
    const values = chunk.flatMap(row => [
      user.id,
      tahun_id,
      ...Object.entries(FIELD_MAP).map(([excelKey]) => {
        const val = row[excelKey] ?? null
        return val === '' ? null : val
      }),
    ])
    await db.query(
      `INSERT INTO dokumen_realisasi (user_id, tahun_id, ${cols.join(', ')}) VALUES ${rowPlaceholders}`,
      values
    )
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
