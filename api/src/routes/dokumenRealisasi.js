import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { syncDokumenRealisasi } from './sync.js'
import { klausaAwalanRekening } from '../utils/kodeRekening.js'

const router = new Hono()
router.use('*', requireAuth)

// Upload manual dari dashboard (JWT). Extension pakai POST /api/sync/dokumen-realisasi.
router.post('/', syncDokumenRealisasi)

const SP2D_ADA = `dr.nomor_sp2d IS NOT NULL AND LOWER(TRIM(dr.nomor_sp2d)) NOT IN ('', 'null', '-')`

// Kode rekening dipakai sebagai awalan (5.1.01.01 mencakup seluruh rinciannya),
// jadi isinya dibatasi angka dan titik supaya wildcard LIKE tidak bisa disuntik.
function bersihkanKode(raw) {
  return String(raw || '').replace(/[^0-9.]/g, '')
}

function escapeLike(raw) {
  return String(raw).replace(/[\\%_]/g, m => '\\' + m)
}

// Filter yang dipakai bareng oleh daftar dokumen dan matriks kelengkapan.
// abaikanBulan: matriks memakai bulan sebagai kolom, jadi filter bulan tidak
// boleh ikut memotong datanya.
function bangunFilter(c, { abaikanBulan = false } = {}) {
  const klausa = []
  const params = []

  const bulan = Number(c.req.query('bulan'))
  if (!abaikanBulan && bulan >= 1 && bulan <= 12) {
    klausa.push('dr.bulan = ?')
    params.push(bulan)
  }

  const kodeSkpd = c.req.query('kodeSkpd')
  if (kodeSkpd) {
    klausa.push('dr.kode_skpd = ?')
    params.push(kodeSkpd)
  }

  const kodeRekening = bersihkanKode(c.req.query('kodeRekening'))
  if (kodeRekening) {
    // Semua varian lebar digit ikut dicocokkan (format 2026+ vs 2024–2025).
    const awalan = klausaAwalanRekening('dr.kode_rekening', kodeRekening)
    klausa.push(awalan.sql)
    params.push(...awalan.params)
  }

  const jenisDokumen = c.req.query('jenisDokumen')
  if (jenisDokumen) {
    klausa.push('dr.jenis_dokumen = ?')
    params.push(jenisDokumen)
  }

  const sp2d = c.req.query('sp2d')
  if (sp2d === 'ada') klausa.push(`(${SP2D_ADA})`)
  else if (sp2d === 'belum') klausa.push(`NOT (${SP2D_ADA})`)

  const q = String(c.req.query('q') || '').trim()
  if (q) {
    const kolom = [
      'dr.nomor_dokumen', 'dr.nomor_sp2d', 'dr.kode_sub_kegiatan', 'dr.nama_sub_kegiatan',
      'dr.kode_rekening', 'dr.nama_rekening', 'dr.keterangan_dokumen', 'dr.nama_sub_skpd',
    ]
    klausa.push(`(${kolom.map(k => `${k} LIKE ? ESCAPE '\\\\'`).join(' OR ')})`)
    for (let i = 0; i < kolom.length; i++) params.push(`%${escapeLike(q)}%`)
  }

  return { sql: klausa.length ? ' AND ' + klausa.join(' AND ') : '', params }
}

async function idTahun(tahun) {
  if (!tahun) return null
  const [rows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  return rows[0]?.id || null
}

// Daftar dokumen — disaring dan dipaginasi di server, karena satu tahun bisa
// lebih dari 20 ribu baris dan tidak sanggup lagi disaring di browser.
router.get('/', async (c) => {
  const tahun_id = await idTahun(c.req.query('tahun'))
  if (!tahun_id) return c.json({ data: [], total: 0, page: 1, pageSize: 50, ringkasan: null })

  const f = bangunFilter(c)
  const page = Math.max(1, Number(c.req.query('page')) || 1)
  const pageSize = Math.min(500, Math.max(1, Number(c.req.query('pageSize')) || 50))

  const [[agg]] = await db.query(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(dr.nilai_realisasi), 0) AS nilai,
       COALESCE(SUM(CASE WHEN ${SP2D_ADA} THEN dr.nilai_realisasi ELSE 0 END), 0) AS nilai_sp2d,
       COALESCE(SUM(CASE WHEN ${SP2D_ADA} THEN 1 ELSE 0 END), 0) AS dokumen_sp2d
     FROM dokumen_realisasi dr
     WHERE dr.tahun_id = ?${f.sql}`,
    [tahun_id, ...f.params]
  )

  const [rows] = await db.query(
    `SELECT dr.*
     FROM dokumen_realisasi dr
     WHERE dr.tahun_id = ?${f.sql}
     ORDER BY dr.bulan, dr.kode_skpd, dr.tanggal_dokumen, dr.id
     LIMIT ? OFFSET ?`,
    [tahun_id, ...f.params, pageSize, (page - 1) * pageSize]
  )

  return c.json({
    data: rows,
    total: Number(agg.total) || 0,
    page,
    pageSize,
    ringkasan: {
      dokumen: Number(agg.total) || 0,
      nilai: Number(agg.nilai) || 0,
      nilaiSp2d: Number(agg.nilai_sp2d) || 0,
      dokumenSp2d: Number(agg.dokumen_sp2d) || 0,
    },
  })
})

// Pilihan isi filter, diambil dari data yang benar-benar ada.
router.get('/opsi', async (c) => {
  const tahun_id = await idTahun(c.req.query('tahun'))
  if (!tahun_id) return c.json({ skpd: [], rekening: [], jenisDokumen: [], bulan: [] })

  const [skpd] = await db.query(
    `SELECT kode_skpd AS kode, MAX(nama_skpd) AS nama, COUNT(*) AS jumlah
     FROM dokumen_realisasi WHERE tahun_id = ? AND kode_skpd IS NOT NULL
     GROUP BY kode_skpd ORDER BY kode_skpd`,
    [tahun_id]
  )
  const [rekening] = await db.query(
    `SELECT kode_rekening AS kode, MAX(nama_rekening) AS nama, COUNT(*) AS jumlah
     FROM dokumen_realisasi WHERE tahun_id = ? AND kode_rekening IS NOT NULL
     GROUP BY kode_rekening ORDER BY kode_rekening`,
    [tahun_id]
  )
  const [jenis] = await db.query(
    `SELECT jenis_dokumen AS kode, COUNT(*) AS jumlah
     FROM dokumen_realisasi WHERE tahun_id = ? AND jenis_dokumen IS NOT NULL
     GROUP BY jenis_dokumen ORDER BY jenis_dokumen`,
    [tahun_id]
  )
  const [bulan] = await db.query(
    `SELECT bulan, COUNT(*) AS jumlah
     FROM dokumen_realisasi WHERE tahun_id = ? AND bulan IS NOT NULL
     GROUP BY bulan ORDER BY bulan`,
    [tahun_id]
  )

  return c.json({
    skpd: skpd.map(r => ({ ...r, jumlah: Number(r.jumlah) })),
    rekening: rekening.map(r => ({ ...r, jumlah: Number(r.jumlah) })),
    jenisDokumen: jenis.map(r => ({ ...r, jumlah: Number(r.jumlah) })),
    bulan: bulan.map(r => ({ bulan: Number(r.bulan), jumlah: Number(r.jumlah) })),
  })
})

// Matriks kelengkapan SKPD x bulan: menjawab "dokumen dinas ini, bulan ini,
// rekening ini sudah masuk atau belum". Daftar barisnya TIDAK diambil dari
// dokumen_realisasi, melainkan dari SKPD yang punya pagu pada rekening yang
// disaring — kalau tidak, dinas yang dokumennya belum masuk sama sekali justru
// hilang dari tabel, padahal itu justru yang mau dicari.
router.get('/kelengkapan', async (c) => {
  const tahun_id = await idTahun(c.req.query('tahun'))
  if (!tahun_id) return c.json({ skpd: [], perBulan: [], bulanAda: [] })

  const kodeRekening = bersihkanKode(c.req.query('kodeRekening'))
  const kodeSkpd = c.req.query('kodeSkpd')

  const paguKlausa = []
  const paguParams = [tahun_id]
  if (kodeRekening) {
    const awalan = klausaAwalanRekening('kode_rekening', kodeRekening)
    paguKlausa.push(awalan.sql)
    paguParams.push(...awalan.params)
  }
  if (kodeSkpd) { paguKlausa.push('kode_skpd = ?'); paguParams.push(kodeSkpd) }

  const [paguRows] = await db.query(
    `SELECT kode_skpd AS kode, MAX(nama_skpd) AS nama, SUM(pagu) AS pagu
     FROM anggaran_rekap
     WHERE tahun_id = ?${paguKlausa.length ? ' AND ' + paguKlausa.join(' AND ') : ''}
     GROUP BY kode_skpd`,
    paguParams
  )

  const f = bangunFilter(c, { abaikanBulan: true })
  const [selRows] = await db.query(
    `SELECT dr.kode_skpd AS kode, MAX(dr.nama_skpd) AS nama, dr.bulan,
       COUNT(*) AS dokumen,
       COALESCE(SUM(dr.nilai_realisasi), 0) AS nilai,
       COALESCE(SUM(CASE WHEN ${SP2D_ADA} THEN 1 ELSE 0 END), 0) AS dokumen_sp2d
     FROM dokumen_realisasi dr
     WHERE dr.tahun_id = ?${f.sql}
     GROUP BY dr.kode_skpd, dr.bulan`,
    [tahun_id, ...f.params]
  )

  const baris = new Map()
  function ambil(kode, nama) {
    let b = baris.get(kode)
    if (!b) {
      b = { kodeSkpd: kode, namaSkpd: nama || kode, pagu: 0, perBulan: {}, dokumen: 0, nilai: 0, dokumenSp2d: 0 }
      baris.set(kode, b)
    } else if ((!b.namaSkpd || b.namaSkpd === kode) && nama) {
      b.namaSkpd = nama
    }
    return b
  }

  for (const r of paguRows) {
    ambil(r.kode, r.nama).pagu = Number(r.pagu) || 0
  }
  for (const r of selRows) {
    // Dokumen tanpa pagu tetap ditampilkan — justru penanda salah kode/rekening.
    const b = ambil(r.kode, r.nama)
    const bulan = Number(r.bulan)
    if (!bulan) continue
    const sel = {
      dokumen: Number(r.dokumen) || 0,
      nilai: Number(r.nilai) || 0,
      dokumenSp2d: Number(r.dokumen_sp2d) || 0,
    }
    b.perBulan[bulan] = sel
    b.dokumen += sel.dokumen
    b.nilai += sel.nilai
    b.dokumenSp2d += sel.dokumenSp2d
  }

  const skpd = Array.from(baris.values())
    .sort((a, b) => String(a.kodeSkpd).localeCompare(String(b.kodeSkpd), 'id', { numeric: true }))

  const perBulan = []
  for (let b = 1; b <= 12; b++) {
    const total = skpd.reduce((a, s) => ({
      dokumen: a.dokumen + (s.perBulan[b]?.dokumen || 0),
      nilai: a.nilai + (s.perBulan[b]?.nilai || 0),
      skpdAda: a.skpdAda + (s.perBulan[b] ? 1 : 0),
    }), { dokumen: 0, nilai: 0, skpdAda: 0 })
    perBulan.push({ bulan: b, ...total })
  }

  return c.json({
    skpd,
    perBulan,
    bulanAda: perBulan.filter(b => b.dokumen > 0).map(b => b.bulan),
    jumlahSkpd: skpd.length,
  })
})

router.delete('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)

  await db.query(
    `DELETE dr FROM dokumen_realisasi dr
     INNER JOIN tahun_anggaran ta ON dr.tahun_id = ta.id
     WHERE ta.tahun = ?`,
    [tahun]
  )
  return c.json({ success: true })
})

export default router
