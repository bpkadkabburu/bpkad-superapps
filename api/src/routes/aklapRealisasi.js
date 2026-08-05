// Helper bersama: realisasi AKLAP untuk digabung ke rekap realisasi
// (Per SKPD, Per Urusan, Per Program). Dokumen AKLAP tidak menyimpan kode_skpd,
// hanya kode_sub_skpd — jadi kode_skpd/nama_skpd diambil dari peta anggaran/realisasi.

// Baris realisasi AKLAP teragregasi per seluruh field hierarki (kecuali SKPD).
export async function getAklapRealisasiRows(db, tahun_id) {
  const [rows] = await db.query(
    `SELECT
       kode_sub_skpd, nama_sub_skpd,
       kode_urusan, nama_urusan,
       kode_bidang_urusan, nama_bidang_urusan,
       kode_program, nama_program,
       kode_kegiatan, nama_kegiatan,
       kode_sub_kegiatan, nama_sub_kegiatan,
       kode_rekening, nama_rekening,
       SUM(nilai_realisasi) AS realisasi_aklap
     FROM dokumen_aklap
     WHERE tahun_id = ?
     GROUP BY kode_sub_skpd, nama_sub_skpd,
       kode_urusan, nama_urusan, kode_bidang_urusan, nama_bidang_urusan,
       kode_program, nama_program, kode_kegiatan, nama_kegiatan,
       kode_sub_kegiatan, nama_sub_kegiatan, kode_rekening, nama_rekening`,
    [tahun_id]
  )
  return rows
}

// Peta kode_sub_skpd -> { kode_skpd, nama_skpd } dari sumber yang punya keduanya.
export async function getSubSkpdToSkpd(db, tahun_id) {
  const [rows] = await db.query(
    `SELECT DISTINCT kode_sub_unit AS kode_sub_skpd, kode_skpd, nama_skpd
       FROM anggaran_rekap WHERE tahun_id = ?
     UNION
     SELECT DISTINCT kode_sub_skpd, kode_skpd, nama_skpd
       FROM dokumen_realisasi WHERE tahun_id = ?`,
    [tahun_id, tahun_id]
  )
  const map = new Map()
  for (const r of rows) {
    if (r.kode_sub_skpd && !map.has(r.kode_sub_skpd)) {
      map.set(r.kode_sub_skpd, { kode_skpd: r.kode_skpd, nama_skpd: r.nama_skpd })
    }
  }
  return map
}

// Gabungkan realisasi AKLAP ke dalam `leaves` yang sudah dibangun dari pagu + realisasi SPP/SP2D.
// leafKey & emptyLeaf disuntik dari route pemanggil karena LEVELS berbeda tiap route.
export function mergeAklapIntoLeaves(leaves, aklapRows, skpdMap, leafKey, makeLeaf) {
  for (const row of aklapRows) {
    const enriched = { ...row }
    const m = skpdMap.get(row.kode_sub_skpd)
    if (m) {
      enriched.kode_skpd = m.kode_skpd
      enriched.nama_skpd = m.nama_skpd
    }
    const val = Number(row.realisasi_aklap) || 0
    const key = leafKey(enriched)
    const existing = leaves.get(key)
    if (existing) {
      existing.totals.realisasiAklap += val
    } else {
      leaves.set(key, makeLeaf(enriched, val))
    }
  }
}
