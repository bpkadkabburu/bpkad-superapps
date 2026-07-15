// api/src/routes/mapping.js
// Rekap PMK: kompilasi (read-only) dari Referensi Subkegiatan PMK (bidang)
// digabung dengan Anggaran Rekap (pagu, sumber dana, OPD). Tidak menyimpan apa pun.
import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ results: [] })

  // Gabung per OPD (sub unit) -> sub kegiatan -> sumber dana, jumlahkan pagu.
  // Hanya sub kegiatan yang masuk referensi PMK (INNER JOIN).
  // Aturan lama dipertahankan: bidang "kesehatan" pada OPD "puskesmas" dikecualikan.
  const [rows] = await db.query(
    `SELECT
       ar.kode_sub_kegiatan            AS kode,
       MAX(ar.nama_sub_kegiatan)       AS subKegiatan,
       ar.kode_sumber_dana             AS kodeSumberDana,
       MAX(ar.nama_sumber_dana)        AS sumberDana,
       SUM(ar.pagu)                    AS paguIndikatif,
       ar.nama_sub_unit                AS namaOPD,
       pmk.kode_sub_kegiatan           AS kodePMK,
       pmk.bidang                      AS bidang
     FROM anggaran_rekap ar
     INNER JOIN tahun_anggaran ta ON ar.tahun_id = ta.id
     INNER JOIN subkegiatan_pmk pmk
       ON pmk.tahun_id = ar.tahun_id
      AND pmk.kode_sub_kegiatan = ar.kode_sub_kegiatan
     WHERE ta.tahun = ?
       AND NOT (LOWER(pmk.bidang) LIKE '%kesehatan%' AND LOWER(ar.nama_sub_unit) LIKE '%puskesmas%')
     GROUP BY ar.nama_sub_unit, ar.kode_sub_kegiatan, ar.kode_sumber_dana, pmk.bidang, pmk.kode_sub_kegiatan
     ORDER BY pmk.bidang, ar.nama_sub_unit, ar.kode_sub_kegiatan`,
    [tahun]
  )

  const results = rows.map(r => ({
    kode: r.kode,
    subKegiatan: r.subKegiatan || '-',
    kodeSumberDana: r.kodeSumberDana || '-',
    sumberDana: r.sumberDana || '-',
    paguIndikatif: Number(r.paguIndikatif || 0),
    namaOPD: r.namaOPD || '-',
    kodePMK: r.kodePMK || '-',
    bidang: r.bidang || '-',
  }))

  return c.json({ results })
})

export default router
