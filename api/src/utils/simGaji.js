import db from '../db.js'

// Nilai "satu bulan gaji" versi SIM Gaji, diketik manual lalu disimpan di tabel
// `sim_gaji`. Modul ini satu-satunya tempat yang menyentuh tabel itu, dipakai
// route /api/sim-gaji maupun perhitungan proyeksi gaji.
//
// Perannya PEMBANDING, bukan pengganti: tidak ada satu pun angka proyeksi yang
// berubah karena tabel ini terisi. Yang ditambahkan hanya kolom baru supaya
// kelihatan seberapa jauh tebakan dari realisasi meleset dari angka sebenarnya.

/** Baris induk rekening memakai string kosong; lihat komentar migrasi. */
export const KOMPONEN_INDUK = ''

/**
 * Seluruh nilai SIM Gaji satu tahun anggaran.
 *
 * @returns {Promise<{bulan: number|null, updatedAt: Date|null, jumlah: number,
 *   dinas: number, peta: Map<string, {nilai: number, rincian: Object|null}>}>}
 *   `peta` berkunci `${kode_skpd}|${kode_rekening}`.
 */
export async function ambilSimGaji(tahun_id) {
  const kosong = { bulan: null, updatedAt: null, jumlah: 0, dinas: 0, peta: new Map() }
  if (!tahun_id) return kosong

  const [rows] = await db.query(
    `SELECT bulan, kode_skpd, kode_rekening, komponen, nilai, uploaded_at
     FROM sim_gaji WHERE tahun_id = ?`,
    [tahun_id]
  )
  if (!rows.length) return kosong

  const peta = new Map()
  const dinasSet = new Set()
  let bulan = null
  let updatedAt = null

  for (const row of rows) {
    dinasSet.add(row.kode_skpd)
    // Bulan tercatat per baris tapi satu tahun cuma punya satu set nilai; yang
    // dipakai bulan terbesar, supaya sisa baris lama dari unggahan sebelumnya
    // tidak menarik mundur keterangan bulannya.
    if (row.bulan != null && (bulan == null || row.bulan > bulan)) bulan = Number(row.bulan)
    if (row.uploaded_at && (!updatedAt || row.uploaded_at > updatedAt)) updatedAt = row.uploaded_at

    const kunci = `${row.kode_skpd}|${row.kode_rekening}`
    let entri = peta.get(kunci)
    if (!entri) { entri = { nilai: 0, rincian: null }; peta.set(kunci, entri) }

    const nilai = Number(row.nilai) || 0
    if (row.komponen === KOMPONEN_INDUK) {
      entri.nilai = nilai
    } else {
      if (!entri.rincian) entri.rincian = {}
      entri.rincian[row.komponen] = nilai
    }
  }

  return { bulan, updatedAt, jumlah: rows.length, dinas: dinasSet.size, peta }
}

/**
 * Ubah baris mentah dari klien jadi baris siap simpan. Baris tanpa kode SKPD /
 * kode rekening, atau yang nilainya kosong / nol, dibuang: kolom kosong di
 * Excel berarti "belum diisi", bukan "nol rupiah", dan menyimpannya sebagai 0
 * akan tampil seolah rumusnya meleset 100%.
 */
export function bersihkanBaris(data) {
  const bersih = []
  for (const row of data ?? []) {
    const kodeSkpd = String(row.kodeSkpd ?? row.kode_skpd ?? '').trim()
    const kodeRekening = String(row.kodeRekening ?? row.kode_rekening ?? '').trim()
    if (!kodeSkpd || !kodeRekening) continue

    const nilai = Number(row.nilai)
    if (!Number.isFinite(nilai) || nilai === 0) continue

    bersih.push({
      kodeSkpd,
      namaSkpd: row.namaSkpd ?? row.nama_skpd ?? null,
      kodeRekening,
      namaRekening: row.namaRekening ?? row.nama_rekening ?? null,
      komponen: String(row.komponen ?? KOMPONEN_INDUK).trim().slice(0, 100),
      nilai,
    })
  }
  return bersih
}

/**
 * Simpan satu unggahan. Yang dihapus HANYA dinas yang ada di payload — file
 * yang diunggah bisa saja baru sebagian dinas yang terisi, dan menghapus satu
 * tahun penuh akan membuang pekerjaan yang sudah dikerjakan sebelumnya. Pola
 * yang sama dipakai `syncSubKegiatan` di routes/sync.js.
 *
 * @returns {Promise<{count: number, dinas: number}>}
 */
export async function simpanSimGaji(tahun_id, bulan, rows) {
  const kodeSkpd = [...new Set(rows.map(r => r.kodeSkpd))]

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    if (kodeSkpd.length) {
      await conn.query(
        `DELETE FROM sim_gaji WHERE tahun_id = ? AND kode_skpd IN (${kodeSkpd.map(() => '?').join(', ')})`,
        [tahun_id, ...kodeSkpd]
      )
    }

    const BATCH = 500
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH)
      const placeholders = chunk.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')
      const values = chunk.flatMap(row => [
        tahun_id, bulan,
        row.kodeSkpd, row.namaSkpd,
        row.kodeRekening, row.namaRekening,
        row.komponen, row.nilai,
      ])
      await conn.query(
        `INSERT INTO sim_gaji
           (id, tahun_id, bulan, kode_skpd, nama_skpd, kode_rekening, nama_rekening, komponen, nilai)
         VALUES ${placeholders}`,
        values
      )
    }

    await conn.commit()
    return { count: rows.length, dinas: kodeSkpd.length }
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * Simpan/ubah satu sel dari tabel di web. Nilai 0 atau kosong berarti isiannya
 * dibatalkan, jadi barisnya dihapus — bukan disimpan sebagai nol.
 */
export async function simpanBarisSimGaji(tahun_id, bulan, row) {
  const komponen = String(row.komponen ?? KOMPONEN_INDUK).trim().slice(0, 100)
  const nilai = Number(row.nilai)

  if (!Number.isFinite(nilai) || nilai === 0) {
    await db.query(
      'DELETE FROM sim_gaji WHERE tahun_id = ? AND kode_skpd = ? AND kode_rekening = ? AND komponen = ?',
      [tahun_id, row.kodeSkpd, row.kodeRekening, komponen]
    )
    return { dihapus: true }
  }

  await db.query(
    `INSERT INTO sim_gaji
       (id, tahun_id, bulan, kode_skpd, nama_skpd, kode_rekening, nama_rekening, komponen, nilai)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       bulan = VALUES(bulan),
       nama_skpd = VALUES(nama_skpd),
       nama_rekening = VALUES(nama_rekening),
       nilai = VALUES(nilai)`,
    [
      tahun_id, bulan,
      row.kodeSkpd, row.namaSkpd ?? null,
      row.kodeRekening, row.namaRekening ?? null,
      komponen, nilai,
    ]
  )
  return { dihapus: false }
}
