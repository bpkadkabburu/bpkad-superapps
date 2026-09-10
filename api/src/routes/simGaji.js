import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { ambilSimGaji, bersihkanBaris, simpanSimGaji, simpanBarisSimGaji } from '../utils/simGaji.js'

const router = new Hono()
router.use('*', requireAuth)

async function tahunId(tahun) {
  if (!tahun) return null
  const [rows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  return rows[0]?.id ?? null
}

// Bulan tidak pernah ditanyakan ke pemakai: angka SIM Gaji selalu berasal dari
// bulan realisasi terakhir yang tercetak di file export-nya.
function bulanSah(nilai) {
  const bulan = Number(nilai)
  return Number.isInteger(bulan) && bulan >= 1 && bulan <= 12 ? bulan : null
}

router.get('/', async (c) => {
  const id = await tahunId(c.req.query('tahun'))
  if (!id) return c.json({ bulan: null, updatedAt: null, jumlah: 0, dinas: 0, data: [] })

  const [rows] = await db.query(
    `SELECT bulan, kode_skpd, nama_skpd, kode_rekening, nama_rekening, komponen, nilai, uploaded_at
     FROM sim_gaji WHERE tahun_id = ?
     ORDER BY kode_skpd, kode_rekening, komponen`,
    [id]
  )
  const { bulan, updatedAt, jumlah, dinas } = await ambilSimGaji(id)
  return c.json({
    bulan, updatedAt, jumlah, dinas,
    data: rows.map(r => ({
      bulan: r.bulan,
      kodeSkpd: r.kode_skpd,
      namaSkpd: r.nama_skpd,
      kodeRekening: r.kode_rekening,
      namaRekening: r.nama_rekening,
      komponen: r.komponen,
      nilai: Number(r.nilai) || 0,
      uploadedAt: r.uploaded_at,
    })),
  })
})

/** Unggah massal dari file export yang sudah diisi. */
router.post('/', async (c) => {
  const { tahun, bulan, data } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  const bln = bulanSah(bulan)
  if (!bln) return c.json({ error: 'bulan harus antara 1 dan 12' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const id = await tahunId(tahun)
  if (!id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const rows = bersihkanBaris(data)
  if (!rows.length)
    return c.json({ error: 'Tidak ada nilai Sim Gaji yang terisi di file itu' }, 400)

  const { count, dinas } = await simpanSimGaji(id, bln, rows)
  return c.json({ success: true, count, dinas })
})

/** Simpan satu sel dari tabel di web. */
router.put('/baris', async (c) => {
  const { tahun, bulan, ...row } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  const bln = bulanSah(bulan)
  if (!bln) return c.json({ error: 'bulan harus antara 1 dan 12' }, 400)
  if (!row.kodeSkpd || !row.kodeRekening)
    return c.json({ error: 'kodeSkpd dan kodeRekening diperlukan' }, 400)

  const id = await tahunId(tahun)
  if (!id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const { dihapus } = await simpanBarisSimGaji(id, bln, row)
  return c.json({ success: true, dihapus })
})

router.delete('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  const id = await tahunId(tahun)
  if (!id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const kodeSkpd = c.req.query('kodeSkpd')
  const [hasil] = kodeSkpd
    ? await db.query('DELETE FROM sim_gaji WHERE tahun_id = ? AND kode_skpd = ?', [id, kodeSkpd])
    : await db.query('DELETE FROM sim_gaji WHERE tahun_id = ?', [id])

  return c.json({ success: true, count: hasil.affectedRows })
})

export default router
