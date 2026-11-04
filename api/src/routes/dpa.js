import { Hono } from 'hono'
import db from '../db.js'
import { requireAuth } from '../middleware/auth.js'

// Pemantauan kelengkapan DPA yang dikirim penat-extension (POST /api/sync/dpa).
// Hanya baca: halaman ini dipakai untuk mengecek dinas mana, di jadwal mana,
// yang DPA-nya belum terdownload. Kolom `data` (JSON mentah) sengaja tidak
// pernah ikut di-SELECT — isinya besar dan tidak dibutuhkan di sini.

const router = new Hono()
router.use('*', requireAuth)

// Urutan = urutan kolom di halaman. Nama tabel masuk langsung ke SQL.
const JENIS_PER_SKPD = [
  ['persetujuan_depan', 'dpa_persetujuan_depan'],
  ['skpd', 'dpa_skpd'],
  ['pendapatan', 'dpa_pendapatan'],
  ['belanja', 'dpa_belanja'],
  ['pembiayaan', 'dpa_pembiayaan'],
]

async function idTahun(tahun) {
  if (!tahun) return null
  const [rows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  return rows[0]?.id || null
}

async function jadwalMilikTahun(tahun_id, id) {
  const [rows] = await db.query(
    'SELECT id, id_jadwal, id_jadwal_sipd, nama, tahapan FROM sipd_jadwal WHERE id = ? AND tahun_id = ?',
    [id, tahun_id]
  )
  return rows[0] || null
}

// Daftar jadwal + berapa dinas yang sudah punya tiap jenis — untuk pilihan
// jadwal di halaman, supaya jadwal yang belum tersentuh langsung kelihatan.
router.get('/jadwal', async (c) => {
  const tahun_id = await idTahun(c.req.query('tahun'))
  if (!tahun_id) return c.json({ data: [], jumlahSkpd: 0 })

  const hitung = [...JENIS_PER_SKPD, ['rincian_belanja', 'dpa_rincian_belanja']]
    .map(([jenis, tabel]) =>
      `(SELECT COUNT(DISTINCT t.id_skpd) FROM ${tabel} t WHERE t.sipd_jadwal_id = j.id) AS ${jenis}`)
    .join(',\n       ')

  const [rows] = await db.query(
    `SELECT j.id, j.id_jadwal, j.id_jadwal_sipd, j.nama, j.tahapan, j.aktif, j.synced_at,
       ${hitung}
     FROM sipd_jadwal j
     WHERE j.tahun_id = ?
     ORDER BY j.urutan IS NULL, j.urutan, j.id_jadwal DESC`,
    [tahun_id]
  )
  const [[{ jumlahSkpd }]] = await db.query(
    'SELECT COUNT(*) AS jumlahSkpd FROM skpd WHERE tahun_id = ? AND is_skpd = 1', [tahun_id]
  )
  return c.json({ data: rows.map(r => ({ ...r, aktif: !!r.aktif })), jumlahSkpd })
})

// Sembunyikan / tampilkan jadwal di pilihan download extension. Sinkron
// jadwal tidak pernah menimpa kolom ini (lihat syncJadwal).
router.put('/jadwal/:id/aktif', async (c) => {
  const { aktif } = await c.req.json()
  if (typeof aktif !== 'boolean') return c.json({ error: 'aktif harus true/false' }, 400)
  const [res] = await db.query('UPDATE sipd_jadwal SET aktif = ? WHERE id = ?', [aktif, c.req.param('id')])
  if (!res.affectedRows) return c.json({ error: 'Jadwal tidak ditemukan' }, 404)
  return c.json({ success: true, aktif })
})

// Tim TAPD — penandatangan dokumen DPA. Nama/NIP sudah ditukar balik saat
// sinkron (lihat syncDpa.js), jadi di sini tinggal dibaca.
router.get('/tim-tapd', async (c) => {
  const tahun_id = await idTahun(c.req.query('tahun'))
  if (!tahun_id) return c.json({ data: [] })

  const [rows] = await db.query(
    `SELECT no_urut, nama, nip, jabatan, synced_at
     FROM sipd_tim_tapd WHERE tahun_id = ?
     ORDER BY no_urut`,
    [tahun_id]
  )
  return c.json({ data: rows })
})

// Matriks dinas × jenis untuk satu jadwal. Sel berisi waktu sinkron terakhir
// (null = belum ada). Rincian belanja diambil per sub kegiatan, jadi selnya
// berisi jumlah yang sudah masuk dibanding jumlah sub kegiatan dinas itu di
// referensi Sub Kegiatan. Referensi itu tidak terikat jadwal, jadi angkanya
// patokan, bukan kepastian — pergeseran bisa menambah/menghapus sub kegiatan.
router.get('/kelengkapan', async (c) => {
  const tahun_id = await idTahun(c.req.query('tahun'))
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)
  const jadwal = await jadwalMilikTahun(tahun_id, c.req.query('jadwal'))
  if (!jadwal) return c.json({ error: 'Jadwal tidak ditemukan' }, 404)

  // Dinas = SKPD induk di referensi, ditambah id_skpd yang muncul di DPA tapi
  // tidak ada di referensi (supaya kiriman yang "nyasar" tetap kelihatan).
  const [skpd] = await db.query(
    `SELECT id_skpd, kode_skpd, nama_skpd, 1 AS di_referensi
     FROM skpd WHERE tahun_id = ? AND is_skpd = 1
     ORDER BY kode_skpd`,
    [tahun_id]
  )
  const baris = new Map(skpd.map(s => [Number(s.id_skpd), { ...s, id_skpd: Number(s.id_skpd) }]))
  const barisUntuk = (r) => {
    const id = Number(r.id_skpd)
    if (!baris.has(id))
      baris.set(id, { id_skpd: id, kode_skpd: r.kode_skpd, nama_skpd: r.nama_skpd, di_referensi: 0 })
    return baris.get(id)
  }

  for (const [jenis, tabel] of JENIS_PER_SKPD) {
    const [rows] = await db.query(
      `SELECT id_skpd, kode_skpd, nama_skpd, synced_at FROM ${tabel} WHERE sipd_jadwal_id = ?`,
      [jadwal.id]
    )
    for (const r of rows) barisUntuk(r)[jenis] = r.synced_at
  }

  const [rincian] = await db.query(
    `SELECT id_skpd, MAX(kode_skpd) AS kode_skpd, MAX(nama_skpd) AS nama_skpd,
       COUNT(*) AS jumlah, MAX(synced_at) AS synced_at
     FROM dpa_rincian_belanja WHERE sipd_jadwal_id = ?
     GROUP BY id_skpd`,
    [jadwal.id]
  )
  for (const r of rincian) {
    barisUntuk(r).rincian_belanja = { jumlah: Number(r.jumlah), synced_at: r.synced_at }
  }

  const [target] = await db.query(
    `SELECT id_skpd, COUNT(DISTINCT id_sub_skpd, id_sub_giat) AS jumlah
     FROM sub_kegiatan WHERE tahun_id = ?
     GROUP BY id_skpd`,
    [tahun_id]
  )
  const targetPer = new Map(target.map(t => [Number(t.id_skpd), Number(t.jumlah)]))

  const data = [...baris.values()].map(b => ({
    ...b,
    rincian_belanja: {
      jumlah: b.rincian_belanja?.jumlah ?? 0,
      target: targetPer.get(b.id_skpd) ?? 0,
      synced_at: b.rincian_belanja?.synced_at ?? null,
    },
  }))

  return c.json({ jadwal, jenis: JENIS_PER_SKPD.map(([j]) => j), data })
})

// Rincian belanja satu dinas: sub kegiatan mana yang sudah dan belum masuk.
// Dicocokkan lewat (id_sub_skpd, id_sub_giat) — sama dengan kunci tabelnya.
router.get('/kelengkapan/rincian', async (c) => {
  const tahun_id = await idTahun(c.req.query('tahun'))
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)
  const jadwal = await jadwalMilikTahun(tahun_id, c.req.query('jadwal'))
  if (!jadwal) return c.json({ error: 'Jadwal tidak ditemukan' }, 404)
  const id_skpd = Number(c.req.query('idSkpd'))
  if (!Number.isInteger(id_skpd)) return c.json({ error: 'idSkpd diperlukan' }, 400)

  const [referensi] = await db.query(
    `SELECT DISTINCT id_sub_skpd, kode_sub_skpd, nama_sub_skpd, id_sub_giat, kode_sub_giat, nama_sub_giat
     FROM sub_kegiatan WHERE tahun_id = ? AND id_skpd = ?`,
    [tahun_id, id_skpd]
  )
  const [masuk] = await db.query(
    `SELECT id_sub_skpd, nama_sub_skpd, id_sub_giat, kode_sub_giat, nama_sub_giat, synced_at
     FROM dpa_rincian_belanja WHERE sipd_jadwal_id = ? AND id_skpd = ?`,
    [jadwal.id, id_skpd]
  )

  const kunci = (r) => `${Number(r.id_sub_skpd)}|${Number(r.id_sub_giat)}`
  const masukPer = new Map(masuk.map(m => [kunci(m), m]))
  const data = referensi.map(r => ({ ...r, synced_at: masukPer.get(kunci(r))?.synced_at ?? null }))

  // Yang masuk tapi tidak ada di referensi — mis. sub kegiatan baru hasil
  // pergeseran, atau referensi Sub Kegiatan yang belum disinkron ulang.
  const diReferensi = new Set(referensi.map(kunci))
  const diluarReferensi = masuk.filter(m => !diReferensi.has(kunci(m)))

  data.sort((a, b) =>
    String(a.kode_sub_skpd).localeCompare(String(b.kode_sub_skpd)) ||
    String(a.kode_sub_giat).localeCompare(String(b.kode_sub_giat)))

  return c.json({ data, diluarReferensi })
})

export default router
