import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { syncAnggaran } from './sync.js'
import { klausaAwalanRekening } from '../utils/kodeRekening.js'
import {
  PREFIX_GAJI, PREFIX_TPP, jenisKomponenPppkPw,
  kodeSintetisPppkPw, LABEL_KOMPONEN_PPPK_PW,
} from '../utils/kategoriPegawai.js'

const router = new Hono()
router.use('*', requireAuth)

// Upload manual dari dashboard (JWT). Extension pakai POST /api/sync/anggaran.
router.post('/', syncAnggaran)

router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT ar.*
     FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ta.tahun = ?
     ORDER BY ar.no`,
    [tahun]
  )
  return c.json({ data: rows })
})

// Rekap pagu anggaran per sumber dana (group by), diurut dari terbesar.
router.get('/rekap-sumber-dana', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [], total: 0 })

  const [rows] = await db.query(
    `SELECT
       ar.kode_sumber_dana AS kode,
       COALESCE(NULLIF(TRIM(ar.nama_sumber_dana), ''), '(Tanpa Sumber Dana)') AS nama,
       SUM(ar.pagu) AS pagu,
       COUNT(*) AS jumlah_baris
     FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ta.tahun = ?
     GROUP BY ar.kode_sumber_dana, nama
     ORDER BY pagu DESC`,
    [tahun]
  )

  const total = rows.reduce((sum, r) => sum + Number(r.pagu || 0), 0)
  return c.json({ data: rows, total })
})

// Rekap pagu per sub unit SKPD × rekening untuk satu kategori belanja pegawai
// (gaji, TPP, atau PPPK Paruh Waktu) — dipakai tab "Cek Rancangan Pagu" untuk
// membandingkan pagu yang sudah tersinkron di anggaran_rekap terhadap
// rancangan pagu BPKAD (bukan proyeksi — murni pagu yang sudah diinput).
//
// Dikelompokkan per kode_sub_unit, BUKAN kode_skpd — sama seperti
// proyeksiGaji.js. Satu SKPD induk (mis. Sekretariat Daerah) bisa terbagi jadi
// beberapa sub unit (Bagian Tata Pemerintahan, Bagian Keuangan dan
// Perencanaan, dst), masing-masing punya baris pagu sendiri di anggaran_rekap.
// Mengelompokkan di level kode_skpd akan melebur semua Bagian itu jadi satu
// baris dan menyembunyikan rinciannya.
const KATEGORI_PREFIX = { gaji: PREFIX_GAJI, tpp: PREFIX_TPP }

router.get('/rekap-pegawai', async (c) => {
  const tahun = c.req.query('tahun')
  const kategori = c.req.query('kategori')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!['gaji', 'tpp', 'pppk_pw'].includes(kategori)) {
    return c.json({ error: 'kategori harus gaji, tpp, atau pppk_pw' }, 400)
  }

  if (kategori === 'pppk_pw') {
    const [rows] = await db.query(
      `SELECT ar.kode_sub_unit AS kodeSkpd, ar.nama_sub_unit AS namaSkpd,
              ar.nama_rekening AS namaRekening, ar.pagu AS pagu
       FROM anggaran_rekap ar
       INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
       WHERE ta.tahun = ? AND ar.nama_rekening LIKE ? ESCAPE '\\\\'`,
      [tahun, '%paruh waktu%']
    )
    const peta = new Map()
    for (const r of rows) {
      const komponen = jenisKomponenPppkPw(r.namaRekening)
      if (!komponen) continue
      const kunci = `${r.kodeSkpd}|${komponen}`
      let e = peta.get(kunci)
      if (!e) {
        e = {
          kodeSkpd: r.kodeSkpd, namaSkpd: r.namaSkpd,
          kodeRekening: kodeSintetisPppkPw(komponen),
          namaRekening: LABEL_KOMPONEN_PPPK_PW[komponen],
          pagu: 0,
        }
        peta.set(kunci, e)
      }
      e.pagu += Number(r.pagu || 0)
    }
    return c.json({ data: [...peta.values()] })
  }

  const { sql, params } = klausaAwalanRekening('ar.kode_rekening', KATEGORI_PREFIX[kategori])
  const [rows] = await db.query(
    `SELECT ar.kode_sub_unit AS kodeSkpd, ar.nama_sub_unit AS namaSkpd,
            ar.kode_rekening AS kodeRekening, ar.nama_rekening AS namaRekening,
            SUM(ar.pagu) AS pagu
     FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ta.tahun = ? AND ${sql}
     GROUP BY ar.kode_sub_unit, ar.nama_sub_unit, ar.kode_rekening, ar.nama_rekening`,
    [tahun, ...params]
  )
  return c.json({ data: rows })
})

router.delete('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  await db.query(
    `DELETE ar FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     WHERE ta.tahun = ?`,
    [tahun]
  )
  return c.json({ success: true })
})

export default router
