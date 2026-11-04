import db from '../db.js'

// Handler sinkron DPA dari penat-extension. Didaftarkan di router /api/sync
// (sync.js), jadi dilindungi API key seperti sync lainnya:
//
//   POST /api/sync/jadwal    { tahun, data: [...item jadwal-pergeseran mentah...] }
//   POST /api/sync/tim-tapd  { tahun, data: [...item tim-tapd/list mentah...] }
//   POST /api/sync/dpa       { tahun, jenis, id_jadwal | id_jadwal_sipd, id_skpd, ..., data }
//   GET  /api/sync/jadwal?tahun=     → jadwal AKTIF, urut seperti SIPD
//   GET  /api/sync/tim-tapd?tahun=   → tim TAPD, nama/nip sudah benar
//   GET  /api/sync/dpa/status?tahun=&jenis=[&id_skpd=]   → kunci + synced_at yang sudah masuk
//
// Extension mengirim respons SIPD apa adanya; isi DPA disimpan mentah di kolom
// JSON. Lihat migration 000015 untuk alasan bentuk tabelnya.

async function resolveTahunId(tahun) {
  const [rows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  return rows[0]?.id ?? null
}

// SIPD kadang mengirim angka sebagai string ("32", "1").
function toInt(val) {
  if (val === null || val === undefined || val === '') return null
  const n = Number(val)
  return Number.isInteger(n) ? n : null
}

function teksAtauNull(val) {
  if (val === null || val === undefined) return null
  const s = String(val).trim()
  return s === '' ? null : s
}

// ---------------------------------------------------------------------------
// Jadwal — dikirim duluan, karena DPA merujuk ke sini.
// ---------------------------------------------------------------------------
// Upsert per (tahun, id_jadwal), bukan hapus-lalu-isi: baris DPA menempel ke
// jadwal lewat FK CASCADE, jadi menghapus jadwal ikut menghapus DPA-nya.
// id_tahap_sipd dan is_locked sengaja tidak disimpan. Kolom `aktif` TIDAK
// ikut di-update: jadwal baru masuk aktif (default kolom), jadwal lama tetap
// mengikuti setelan dari halaman DPA → Jadwal.
export const syncJadwal = async (c) => {
  const { data, tahun } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const rows = data.map((row, i) => ({
    urutan: i + 1,
    id_jadwal: toInt(row.id_jadwal),
    id_jadwal_sipd: toInt(row.id_jadwal_sipd),
    nama: teksAtauNull(row.jadwal_sipd_penatausahaan),
    tahapan: teksAtauNull(row.tahapan),
  }))
  const tanpaId = rows.filter(r => r.id_jadwal === null).length
  if (tanpaId) return c.json({ error: `${tanpaId} item jadwal tidak punya id_jadwal` }, 400)

  const now = new Date()
  await db.query(
    `INSERT INTO sipd_jadwal (id, tahun_id, id_jadwal, id_jadwal_sipd, nama, tahapan, urutan, synced_at)
     VALUES ${rows.map(() => '(UUID(), ?, ?, ?, ?, ?, ?, ?)').join(', ')}
     ON DUPLICATE KEY UPDATE
       id_jadwal_sipd = VALUES(id_jadwal_sipd),
       nama = VALUES(nama),
       tahapan = VALUES(tahapan),
       urutan = VALUES(urutan),
       synced_at = VALUES(synced_at)`,
    rows.flatMap(r => [tahun_id, r.id_jadwal, r.id_jadwal_sipd, r.nama, r.tahapan, r.urutan, now])
  )

  return c.json({ success: true, count: rows.length, synced_at: now.toISOString() })
}

// Daftar jadwal untuk popup/modal extension: hanya yang aktif, urut seperti
// respons SIPD. Jadwal yang belum pernah punya urutan (mis. baris awal dari
// migration) jatuh ke belakang, diurut id_jadwal DESC.
export const daftarJadwal = async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT id_jadwal, id_jadwal_sipd, nama, tahapan
     FROM sipd_jadwal
     WHERE tahun_id = ? AND aktif = TRUE
     ORDER BY urutan IS NULL, urutan, id_jadwal DESC`,
    [tahun_id]
  )
  return c.json({ data: rows })
}

// ---------------------------------------------------------------------------
// Tim TAPD
// ---------------------------------------------------------------------------
// Di data SIPD, nama_tapd berisi NIP dan nip_tapd berisi nama — TERTUKAR
// (terkonfirmasi di data 2024 dan 2025). Ditukar balik di sini. Pengecekannya
// per baris (NIP hanya angka, nama memuat huruf) supaya kalau suatu saat SIPD
// membetulkannya, data yang sudah benar tidak ikut terbalik.
function nipTertukar(row) {
  const nama = String(row.nama_tapd ?? '').trim()
  const nip = String(row.nip_tapd ?? '').trim()
  return /^[\d\s]+$/.test(nama) || /[A-Za-z]/.test(nip)
}

// Hapus semua baris tahun itu lalu isi ulang (bukan upsert per no_urut),
// supaya anggota yang sudah dikeluarkan dari tim tidak tertinggal.
export const syncTimTapd = async (c) => {
  const { data, tahun } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!Array.isArray(data) || data.length === 0)
    return c.json({ error: 'data tidak boleh kosong' }, 400)

  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const now = new Date()
  const values = data.flatMap(row => {
    const tukar = nipTertukar(row)
    return [
      tahun_id,
      toInt(row.no_urut),
      teksAtauNull(tukar ? row.nip_tapd : row.nama_tapd),
      teksAtauNull(tukar ? row.nama_tapd : row.nip_tapd),
      teksAtauNull(row.jabatan_tapd),
      now,
    ]
  })

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('DELETE FROM sipd_tim_tapd WHERE tahun_id = ?', [tahun_id])
    await conn.query(
      `INSERT INTO sipd_tim_tapd (id, tahun_id, no_urut, nama, nip, jabatan, synced_at)
       VALUES ${data.map(() => '(UUID(), ?, ?, ?, ?, ?, ?)').join(', ')}`,
      values
    )
    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  return c.json({ success: true, count: data.length, synced_at: now.toISOString() })
}

// Nama/NIP yang dikembalikan sudah yang benar (ditukar balik saat sinkron).
export const daftarTimTapd = async (c) => {
  const tahun = c.req.query('tahun')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT no_urut, nama, nip, jabatan
     FROM sipd_tim_tapd WHERE tahun_id = ?
     ORDER BY no_urut`,
    [tahun_id]
  )
  return c.json({ data: rows })
}

// ---------------------------------------------------------------------------
// Dokumen DPA — satu endpoint, `jenis` menentukan tabel tujuan.
// ---------------------------------------------------------------------------
// Nama tabel masuk langsung ke SQL, jadi hanya boleh dari daftar ini.
const TABEL_DPA = {
  persetujuan_depan: 'dpa_persetujuan_depan',
  skpd: 'dpa_skpd',
  pendapatan: 'dpa_pendapatan',
  belanja: 'dpa_belanja',
  pembiayaan: 'dpa_pembiayaan',
  rincian_belanja: 'dpa_rincian_belanja',
}

// Halaman DPA merujuk jadwal lewat id_jadwal, rincian belanja lewat
// id_jadwal_sipd. Yang lazim untuk jenisnya dipakai lebih dulu; yang satunya
// hanya cadangan kalau extension cuma mengirim ID itu.
async function cariJadwal(tahun_id, body, rincian) {
  const id_jadwal = toInt(body.id_jadwal)
  const id_jadwal_sipd = toInt(body.id_jadwal_sipd)
  const urutan = [
    ['id_jadwal', id_jadwal],
    ['id_jadwal_sipd', id_jadwal_sipd],
  ]
  if (rincian) urutan.reverse()

  const [kolom, nilai] = urutan.find(([, v]) => v !== null) ?? []
  if (!kolom) return { error: 'id_jadwal atau id_jadwal_sipd diperlukan', status: 400 }

  const [rows] = await db.query(
    `SELECT id FROM sipd_jadwal WHERE tahun_id = ? AND ${kolom} = ?`,
    [tahun_id, nilai]
  )
  if (rows.length === 0)
    return { error: `Jadwal dengan ${kolom}=${nilai} belum ada untuk tahun ini. Sinkron jadwal dulu.`, status: 404 }
  // id_jadwal unik per tahun; id_jadwal_sipd tidak dijamin unik oleh SIPD.
  if (rows.length > 1)
    return { error: `Lebih dari satu jadwal dengan ${kolom}=${nilai}. Kirim id_jadwal.`, status: 409 }
  return { id: rows[0].id }
}

export const syncDpa = async (c) => {
  const body = await c.req.json()
  const { tahun, jenis, data } = body
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  const tabel = TABEL_DPA[jenis]
  if (!tabel)
    return c.json({ error: `jenis tidak dikenal, pilih salah satu: ${Object.keys(TABEL_DPA).join(', ')}` }, 400)
  if (data === null || typeof data !== 'object')
    return c.json({ error: 'data (respons SIPD) diperlukan' }, 400)
  const id_skpd = toInt(body.id_skpd)
  if (id_skpd === null) return c.json({ error: 'id_skpd diperlukan' }, 400)

  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  const rincian = jenis === 'rincian_belanja'
  const jadwal = await cariJadwal(tahun_id, body, rincian)
  if (jadwal.error) return c.json({ error: jadwal.error }, jadwal.status)

  const now = new Date()
  const kolom = ['sipd_jadwal_id', 'id_skpd', 'kode_skpd', 'nama_skpd']
  const nilai = [jadwal.id, id_skpd, teksAtauNull(body.kode_skpd), teksAtauNull(body.nama_skpd)]
  if (rincian) {
    const id_sub_giat = toInt(body.id_sub_giat)
    if (id_sub_giat === null) return c.json({ error: 'id_sub_giat diperlukan untuk rincian_belanja' }, 400)
    kolom.push('id_sub_skpd', 'nama_sub_skpd', 'id_sub_giat', 'kode_sub_giat', 'nama_sub_giat')
    nilai.push(
      toInt(body.id_sub_skpd) ?? 0, teksAtauNull(body.nama_sub_skpd),
      id_sub_giat, teksAtauNull(body.kode_sub_giat), teksAtauNull(body.nama_sub_giat),
    )
  }
  kolom.push('data', 'synced_at')
  nilai.push(JSON.stringify(data), now)

  // Kolom kunci (jadwal, skpd, sub skpd, sub giat) tidak perlu ikut di-update.
  const diperbarui = kolom.filter(k => !['sipd_jadwal_id', 'id_skpd', 'id_sub_skpd', 'id_sub_giat'].includes(k))
  await db.query(
    `INSERT INTO ${tabel} (id, ${kolom.join(', ')})
     VALUES (UUID(), ${kolom.map(() => '?').join(', ')})
     ON DUPLICATE KEY UPDATE ${diperbarui.map(k => `${k} = VALUES(${k})`).join(', ')}`,
    nilai
  )

  return c.json({ success: true, jenis, sipd_jadwal_id: jadwal.id, synced_at: now.toISOString() })
}

// ---------------------------------------------------------------------------
// Status DPA — dibaca extension untuk modal download (pengganti tracker lokal
// di chrome.storage). Tidak ada tabel status: "sudah tersinkron" = barisnya ada.
// ---------------------------------------------------------------------------
// Jadwal dikembalikan dalam id dari SIPD (id_jadwal, id_jadwal_sipd), bukan
// UUID sipd_jadwal, karena extension mencocokkan lewat id SIPD. Kolom `data`
// tidak ikut — cukup kunci dan waktu sinkron.
export const syncDpaStatus = async (c) => {
  const tahun = c.req.query('tahun')
  const jenis = c.req.query('jenis')
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  const tabel = TABEL_DPA[jenis]
  if (!tabel)
    return c.json({ error: `jenis tidak dikenal, pilih salah satu: ${Object.keys(TABEL_DPA).join(', ')}` }, 400)

  const idSkpdRaw = c.req.query('id_skpd')
  const id_skpd = toInt(idSkpdRaw)
  if (idSkpdRaw !== undefined && idSkpdRaw !== '' && id_skpd === null)
    return c.json({ error: 'id_skpd harus angka' }, 400)

  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ data: [] })

  const rincian = jenis === 'rincian_belanja'
  const params = [tahun_id]
  let filterSkpd = ''
  if (id_skpd !== null) {
    filterSkpd = ' AND t.id_skpd = ?'
    params.push(id_skpd)
  }

  const [rows] = await db.query(
    `SELECT j.id_jadwal, j.id_jadwal_sipd, t.id_skpd,
       ${rincian ? 't.id_sub_skpd, t.id_sub_giat,' : ''}
       t.synced_at
     FROM ${tabel} t
     JOIN sipd_jadwal j ON j.id = t.sipd_jadwal_id
     WHERE j.tahun_id = ?${filterSkpd}
     ORDER BY j.id_jadwal, t.id_skpd${rincian ? ', t.id_sub_skpd, t.id_sub_giat' : ''}`,
    params
  )
  return c.json({ data: rows })
}
