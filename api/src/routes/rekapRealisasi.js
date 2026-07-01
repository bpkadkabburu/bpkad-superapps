import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

const router = new Hono()
router.use('*', requireAuth)

const LEVELS = [
  { key: 'skpd', badge: 'SKPD', kode: 'kode_skpd', nama: 'nama_skpd' },
  { key: 'subSkpd', badge: 'Unit SKPD', kode: 'kode_sub_skpd', nama: 'nama_sub_skpd' },
  { key: 'urusan', badge: 'Urusan', kode: 'kode_urusan', nama: 'nama_urusan' },
  { key: 'bidangUrusan', badge: 'Bidang Urusan', kode: 'kode_bidang_urusan', nama: 'nama_bidang_urusan' },
  { key: 'program', badge: 'Program', kode: 'kode_program', nama: 'nama_program' },
  { key: 'kegiatan', badge: 'Kegiatan', kode: 'kode_kegiatan', nama: 'nama_kegiatan' },
  { key: 'subKegiatan', badge: 'Sub Kegiatan', kode: 'kode_sub_kegiatan', nama: 'nama_sub_kegiatan' },
  { key: 'belanja', badge: 'Belanja', kode: 'kode_rekening', nama: 'nama_rekening' },
]

function emptyTotals() {
  return { pagu: 0, realisasiSpp: 0, realisasiSp2d: 0 }
}

function addTotals(target, source) {
  target.pagu += source.pagu
  target.realisasiSpp += source.realisasiSpp
  target.realisasiSp2d += source.realisasiSp2d
}

router.get('/', async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ data: [] })

  const [taRows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  const tahun_id = taRows[0]?.id
  if (!tahun_id) return c.json({ data: [] })

  const [paguRows] = await db.query(
    `SELECT
       kode_skpd, nama_skpd,
       kode_sub_unit AS kode_sub_skpd, nama_sub_unit AS nama_sub_skpd,
       kode_urusan, nama_urusan,
       kode_bidang_urusan, nama_bidang_urusan,
       kode_program, nama_program,
       kode_kegiatan, nama_kegiatan,
       kode_sub_kegiatan, nama_sub_kegiatan,
       kode_rekening, nama_rekening,
       kode_sumber_dana, nama_sumber_dana,
       SUM(pagu) AS pagu
     FROM anggaran_rekap
     WHERE tahun_id = ?
     GROUP BY kode_skpd, nama_skpd, kode_sub_unit, nama_sub_unit,
       kode_urusan, nama_urusan, kode_bidang_urusan, nama_bidang_urusan,
       kode_program, nama_program, kode_kegiatan, nama_kegiatan,
       kode_sub_kegiatan, nama_sub_kegiatan, kode_rekening, nama_rekening,
       kode_sumber_dana, nama_sumber_dana`,
    [tahun_id]
  )

  // Peta bidang PMK per kode_sub_kegiatan (kalau tabel referensi ada isinya).
  const [pmkRows] = await db.query(
    `SELECT kode_sub_kegiatan, bidang FROM subkegiatan_pmk
     WHERE tahun_id = ?`,
    [tahun_id]
  )
  const bidangBySubKeg = new Map()
  for (const r of pmkRows) {
    if (r.kode_sub_kegiatan) bidangBySubKeg.set(r.kode_sub_kegiatan, r.bidang)
  }

  const [realisasiRows] = await db.query(
    `SELECT
       kode_skpd, nama_skpd,
       kode_sub_skpd, nama_sub_skpd,
       kode_urusan, nama_urusan,
       kode_bidang_urusan, nama_bidang_urusan,
       kode_program, nama_program,
       kode_kegiatan, nama_kegiatan,
       kode_sub_kegiatan, nama_sub_kegiatan,
       kode_rekening, nama_rekening,
       SUM(nilai_realisasi) AS realisasi_spp,
       SUM(CASE WHEN nomor_sp2d IS NOT NULL AND LOWER(TRIM(nomor_sp2d)) NOT IN ('', 'null', '-')
                THEN nilai_realisasi ELSE 0 END) AS realisasi_sp2d
     FROM dokumen_realisasi
     WHERE tahun_id = ?
     GROUP BY kode_skpd, nama_skpd, kode_sub_skpd, nama_sub_skpd,
       kode_urusan, nama_urusan, kode_bidang_urusan, nama_bidang_urusan,
       kode_program, nama_program, kode_kegiatan, nama_kegiatan,
       kode_sub_kegiatan, nama_sub_kegiatan, kode_rekening, nama_rekening`,
    [tahun_id]
  )

  // Kunci gabung: seluruh kode hierarki, karena kode_sub_kegiatan + kode_rekening
  // yang sama bisa muncul di banyak Unit SKPD berbeda (misal tiap Puskesmas).
  const leaves = new Map()

  function leafKey(row) {
    return LEVELS.map(lvl => row[lvl.kode]).join('||')
  }

  // paguRows kini bisa >1 baris per leaf (satu per sumber dana) -> akumulasi
  // pagu dan simpan breakdown sumber dana. Realisasi tidak punya sumber dana,
  // jadi tetap satu total per leaf.
  for (const row of paguRows) {
    const key = leafKey(row)
    let leaf = leaves.get(key)
    if (!leaf) {
      leaf = {
        row,
        totals: { pagu: 0, realisasiSpp: 0, realisasiSp2d: 0 },
        sumberDana: new Map(),
      }
      leaves.set(key, leaf)
    }
    const pagu = Number(row.pagu) || 0
    leaf.totals.pagu += pagu
    const sdKode = row.kode_sumber_dana || '-'
    const sd = leaf.sumberDana.get(sdKode) || {
      kode: sdKode, nama: row.nama_sumber_dana || '-', pagu: 0,
    }
    sd.pagu += pagu
    leaf.sumberDana.set(sdKode, sd)
  }

  for (const row of realisasiRows) {
    const key = leafKey(row)
    const existing = leaves.get(key)
    if (existing) {
      existing.totals.realisasiSpp += Number(row.realisasi_spp) || 0
      existing.totals.realisasiSp2d += Number(row.realisasi_sp2d) || 0
      // Lengkapi nama/kode level di atas kalau baris anggaran tidak punya (mis. sub_skpd)
      for (const lvl of LEVELS) {
        if (!existing.row[lvl.kode]) existing.row[lvl.kode] = row[lvl.kode]
        if (!existing.row[lvl.nama]) existing.row[lvl.nama] = row[lvl.nama]
      }
    } else {
      leaves.set(key, {
        row,
        totals: {
          pagu: 0,
          realisasiSpp: Number(row.realisasi_spp) || 0,
          realisasiSp2d: Number(row.realisasi_sp2d) || 0,
        },
        sumberDana: new Map(),
      })
    }
  }

  // Bangun tree bertingkat dari leaves
  const root = { children: new Map(), totals: emptyTotals() }

  function mergeSumberDana(target, source) {
    for (const sd of source.values()) {
      const cur = target.get(sd.kode) || { kode: sd.kode, nama: sd.nama, pagu: 0 }
      cur.pagu += sd.pagu
      target.set(sd.kode, cur)
    }
  }

  for (const { row, totals, sumberDana } of leaves.values()) {
    let node = root
    for (const lvl of LEVELS) {
      const kode = row[lvl.kode] ?? '-'
      const nama = row[lvl.nama] ?? '-'
      if (!node.children.has(kode)) {
        node.children.set(kode, {
          kode,
          nama,
          badge: lvl.badge,
          children: new Map(),
          totals: emptyTotals(),
          sumberDana: new Map(),
          bidang: lvl.badge === 'Sub Kegiatan' ? (bidangBySubKeg.get(kode) || null) : null,
        })
      }
      node = node.children.get(kode)
      addTotals(node.totals, totals)
      if (sumberDana) mergeSumberDana(node.sumberDana, sumberDana)
    }
    addTotals(root.totals, totals)
  }

  function toArray(node) {
    return Array.from(node.children.values())
      .sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'))
      .map(child => ({
        kode: child.kode,
        nama: child.nama,
        badge: child.badge,
        totals: child.totals,
        bidang: child.bidang,
        // Breakdown pagu per sumber dana (dari sisi anggaran; realisasi tetap agregat).
        sumberDana: Array.from(child.sumberDana.values()).sort((a, b) => b.pagu - a.pagu),
        // Selisih realisasi SPP yang belum cair jadi SP2D pada node ini (agregat).
        belumSp2d: Math.max(child.totals.realisasiSpp - child.totals.realisasiSp2d, 0),
        children: toArray(child),
      }))
  }

  return c.json({ data: toArray(root), totals: root.totals })
})

export default router
