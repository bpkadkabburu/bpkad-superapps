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
    `SELECT id, id_jadwal, id_jadwal_sipd, nama, tahapan, DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal
     FROM sipd_jadwal WHERE id = ? AND tahun_id = ?`,
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
       DATE_FORMAT(j.tanggal, '%Y-%m-%d') AS tanggal,
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

// Tanggal jadwal, diisi manual (SIPD tidak mengirimkannya). null = kosongkan.
// Sinkron jadwal juga tidak pernah menimpa kolom ini.
router.put('/jadwal/:id/tanggal', async (c) => {
  const { tanggal } = await c.req.json()
  // Bolak-balik lewat Date menolak tanggal yang tidak ada (mis. 2024-02-30).
  const valid = typeof tanggal === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tanggal)
    && new Date(`${tanggal}T00:00:00Z`).toISOString().slice(0, 10) === tanggal
  if (tanggal !== null && !valid) return c.json({ error: 'tanggal harus YYYY-MM-DD atau null' }, 400)
  const [res] = await db.query('UPDATE sipd_jadwal SET tanggal = ? WHERE id = ?', [tanggal, c.req.param('id')])
  if (!res.affectedRows) return c.json({ error: 'Jadwal tidak ditemukan' }, 404)
  return c.json({ success: true, tanggal })
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

// ---- Target rincian belanja: sub kegiatan yang tercantum di DPA Belanja ----
// Rincian belanja diambil per sub kegiatan. Daftar yang SEHARUSNYA ada diambil
// dari dokumen DPA Belanja dinas itu pada jadwal yang sama — bukan dari
// referensi Sub Kegiatan, karena sub kegiatan di referensi belum tentu
// dianggarkan, dan pergeseran bisa menambah/menghapus sub kegiatan.
//
// Isi DPA Belanja berupa baris hierarki: baris unit (sub SKPD, 8 segmen kode)
// diikuti baris urusan … sub kegiatan (6 segmen). Ditentukan dari JUMLAH
// segmen, bukan lebar digit, supaya tetap jalan kalau format kode berubah.
// Sub kegiatan bernilai 0 (sebelum & sesudah) dilewati: SIPD umumnya tidak
// punya rincian untuknya.
function subKegiatanDiDpaBelanja(data) {
  const baris = data?.index?.length ? data.index : (data?.index_pergeseran ?? [])
  const hasil = []
  let unit = null
  for (const b of baris) {
    const kode = String(b.kode_akun ?? b.kode_rekening ?? '').trim()
    const segmen = kode.split('.').length
    if (segmen === 8) unit = { kode, nama: b.uraian }
    else if (segmen === 6) {
      const nilai = [b.jumlah, b.sebelum_jumlah, b.setelah_jumlah].map(Number).filter(n => !Number.isNaN(n))
      if (nilai.every(n => n === 0)) continue
      hasil.push({
        kode_sub_skpd: unit?.kode ?? null, nama_sub_skpd: unit?.nama ?? null,
        kode_sub_giat: kode, nama_sub_giat: b.uraian,
        nilai: Number(b.setelah_jumlah ?? b.jumlah ?? 0),
      })
    }
  }
  return hasil
}

// Pasangkan target dengan rincian yang sudah masuk. Satu kode sub kegiatan
// bisa muncul di beberapa unit dalam satu dinas, jadi dicocokkan dulu lewat
// (nama unit, kode), sisanya lewat kode saja — tiap rincian dipakai sekali.
// Nama unit, bukan kode unit: kode di rincian bisa sudah memakai kode master
// terbaru (kasus dinas yang ganti kode), sedangkan DPA Belanja memakai kode
// saat dokumen dibuat.
// Terakhir lewat (nama unit, nama sub kegiatan): kode sub kegiatan di rincian
// bisa memakai urusan/bidang lain dari yang tercetak di DPA Belanja (mis. TA
// 2024 Setda: DPA 4.01.01.2.11.0004, rincian 2.21.01.2.11.0004).
const normal = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const CARA_COCOK = [
  (a, b) => a.kode_sub_giat === b.kode_sub_giat && normal(a.nama_sub_skpd) === normal(b.nama_sub_skpd),
  (a, b) => a.kode_sub_giat === b.kode_sub_giat,
  (a, b) => normal(a.nama_sub_giat) === normal(b.nama_sub_giat) && normal(a.nama_sub_skpd) === normal(b.nama_sub_skpd),
]
function pasangkan(target, rincian) {
  const sisa = [...rincian]
  const hasil = target.map(t => ({ ...t, rincian: null }))
  for (const cocok of CARA_COCOK)
    for (const t of hasil) {
      if (t.rincian) continue
      const i = sisa.findIndex(r => cocok(r, t))
      if (i >= 0) t.rincian = sisa.splice(i, 1)[0]
    }
  return { hasil, diluarTarget: sisa }
}

// Rincian yang tidak terpasang belum tentu janggal: daftar sub kegiatan SIPD
// untuk satu jadwal ikut memuat sub kegiatan yang dianggarkan di jadwal lain
// (baru masuk saat pergeseran, atau sudah dihapus), dan rinciannya terdownload
// kosong. Jadi rincian sisa dicari di DPA Belanja jadwal lain pada tahun yang
// sama, dari jadwal terakhir turun ke yang pertama — kode + unit dulu, lalu
// kode saja. Yang ketemu diberi nama jadwalnya; yang tidak ketemu di jadwal
// mana pun baru benar-benar di luar DPA Belanja.
// sisaPer: Map id_skpd → rincian sisa. Hasil: Map id_skpd → { jadwalLain, diluar }.
async function cariDiJadwalLain(tahun_id, jadwal_id, sisaPer) {
  const idSkpd = [...sisaPer].filter(([, sisa]) => sisa.length).map(([id]) => id)
  const hasil = new Map([...sisaPer].map(([id, sisa]) => [id, { jadwalLain: [], diluar: sisa }]))
  if (!idSkpd.length) return hasil

  const [rows] = await db.query(
    `SELECT b.id_skpd, b.data, j.id, j.nama, j.urutan, j.id_jadwal
     FROM dpa_belanja b JOIN sipd_jadwal j ON j.id = b.sipd_jadwal_id
     WHERE j.tahun_id = ? AND j.id <> ? AND b.id_skpd IN (?)`,
    [tahun_id, jadwal_id, idSkpd]
  )
  // Urutan sama dengan daftar jadwal. Diurutkan di sini, bukan ORDER BY:
  // mengurutkan baris berkolom JSON besar menghabiskan sort buffer MySQL.
  rows.sort((a, b) => (a.urutan ?? Infinity) - (b.urutan ?? Infinity) || b.id_jadwal - a.id_jadwal)

  for (const id of idSkpd) {
    const lain = rows.filter(r => Number(r.id_skpd) === id)
      .map(r => ({ jadwal: { id: r.id, nama: r.nama }, sub: subKegiatanDiDpaBelanja(r.data) }))
    const cari = (cocok) => {
      for (const l of lain) {
        const t = l.sub.find(cocok)
        if (t) return { jadwal_lain: l.jadwal.nama, nilai_jadwal_lain: t.nilai }
      }
      return null
    }
    const jadwalLain = [], diluar = []
    for (const r of sisaPer.get(id)) {
      let ketemu = null
      for (const cocok of CARA_COCOK) if ((ketemu = cari(t => cocok(r, t)))) break
      if (ketemu) jadwalLain.push({ ...r, ...ketemu })
      else diluar.push(r)
    }
    hasil.set(id, { jadwalLain, diluar })
  }
  return hasil
}

// Matriks dinas × jenis untuk satu jadwal. Sel berisi waktu sinkron terakhir
// (null = belum ada). Sel rincian belanja berisi berapa sub kegiatan di DPA
// Belanja yang rinciannya sudah masuk; target null = DPA Belanja dinas itu
// belum terdownload, jadi belum bisa diketahui.
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
    `SELECT id_skpd, kode_skpd, nama_skpd, nama_sub_skpd, kode_sub_giat, nama_sub_giat, synced_at
     FROM dpa_rincian_belanja WHERE sipd_jadwal_id = ?`,
    [jadwal.id]
  )
  const rincianPer = new Map()
  for (const r of rincian) {
    barisUntuk(r)
    const id = Number(r.id_skpd)
    if (!rincianPer.has(id)) rincianPer.set(id, [])
    rincianPer.get(id).push(r)
  }

  // Hanya kolom data DPA Belanja yang dibaca — satu dokumen per dinas.
  const [belanja] = await db.query(
    'SELECT id_skpd, data FROM dpa_belanja WHERE sipd_jadwal_id = ?', [jadwal.id]
  )
  const targetPer = new Map(belanja.map(b => [Number(b.id_skpd), subKegiatanDiDpaBelanja(b.data)]))

  const pasanganPer = new Map()
  for (const [id, target] of targetPer) pasanganPer.set(id, pasangkan(target, rincianPer.get(id) ?? []))
  const sisaPer = await cariDiJadwalLain(tahun_id, jadwal.id,
    new Map([...pasanganPer].map(([id, p]) => [id, p.diluarTarget])))

  const data = [...baris.values()].map(b => {
    const masuk = rincianPer.get(b.id_skpd) ?? []
    const target = targetPer.get(b.id_skpd)
    const pasangan = pasanganPer.get(b.id_skpd)
    const sisa = sisaPer.get(b.id_skpd)
    return {
      ...b,
      rincian_belanja: {
        jumlah: masuk.length,
        target: target ? target.length : null,
        terpenuhi: pasangan ? pasangan.hasil.filter(t => t.rincian).length : 0,
        jadwal_lain: sisa ? sisa.jadwalLain.length : 0,
        diluar_target: sisa ? sisa.diluar.length : 0,
        synced_at: masuk.reduce((a, r) => (!a || r.synced_at > a ? r.synced_at : a), null),
      },
    }
  })

  return c.json({ jadwal, jenis: JENIS_PER_SKPD.map(([j]) => j), data })
})

// Rincian belanja satu dinas: sub kegiatan di DPA Belanja mana yang sudah dan
// belum punya rincian, plus rincian sisa — yang dianggarkan di jadwal lain dan
// yang tidak tercantum di DPA Belanja jadwal mana pun.
router.get('/kelengkapan/rincian', async (c) => {
  const tahun_id = await idTahun(c.req.query('tahun'))
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)
  const jadwal = await jadwalMilikTahun(tahun_id, c.req.query('jadwal'))
  if (!jadwal) return c.json({ error: 'Jadwal tidak ditemukan' }, 404)
  const id_skpd = Number(c.req.query('idSkpd'))
  if (!Number.isInteger(id_skpd)) return c.json({ error: 'idSkpd diperlukan' }, 400)

  const [[belanja]] = await db.query(
    'SELECT data FROM dpa_belanja WHERE sipd_jadwal_id = ? AND id_skpd = ?', [jadwal.id, id_skpd]
  )
  const [masuk] = await db.query(
    `SELECT nama_sub_skpd, kode_sub_giat, nama_sub_giat, synced_at
     FROM dpa_rincian_belanja WHERE sipd_jadwal_id = ? AND id_skpd = ?
     ORDER BY nama_sub_skpd, kode_sub_giat`,
    [jadwal.id, id_skpd]
  )

  if (!belanja) return c.json({ belanjaAda: false, data: [], jadwalLain: [], diluarTarget: masuk })

  const { hasil, diluarTarget } = pasangkan(subKegiatanDiDpaBelanja(belanja.data), masuk)
  const { jadwalLain, diluar } = (await cariDiJadwalLain(tahun_id, jadwal.id, new Map([[id_skpd, diluarTarget]]))).get(id_skpd)
  const data = hasil.map(({ rincian, ...t }) => ({ ...t, synced_at: rincian?.synced_at ?? null }))
  return c.json({ belanjaAda: true, data, jadwalLain, diluarTarget: diluar })
})

// Satu dinas × semua jadwal tahun itu: dokumen mana yang belum ada di jadwal
// mana. Rincian belanja dipecah per sub kegiatan; tiap jadwal dipasangkan
// dengan DPA Belanja jadwalnya sendiri (sama seperti /kelengkapan). Status sel
// sub kegiatan: 'ada' / 'belum' (tercantum di DPA Belanja jadwal itu),
// 'diluar' (rincian masuk tapi tidak tercantum), 'masuk' (rincian masuk, DPA
// Belanja jadwal itu belum terdownload). Tanpa sel = tidak ada apa-apa.
router.get('/per-dinas', async (c) => {
  const tahun_id = await idTahun(c.req.query('tahun'))
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)
  const id_skpd = Number(c.req.query('idSkpd'))
  if (!Number.isInteger(id_skpd)) return c.json({ error: 'idSkpd diperlukan' }, 400)

  // Urutan SIPD dimulai dari jadwal terbaru; di sini dibalik supaya kolom
  // berjalan dari jadwal pertama ke yang terakhir.
  const [jadwal] = await db.query(
    `SELECT id, nama, tahapan, aktif, DATE_FORMAT(tanggal, '%Y-%m-%d') AS tanggal
     FROM sipd_jadwal WHERE tahun_id = ?
     ORDER BY urutan IS NULL, urutan, id_jadwal DESC`,
    [tahun_id]
  )
  jadwal.reverse()

  const dokumen = {}
  for (const [jenis, tabel] of JENIS_PER_SKPD) {
    const [rows] = await db.query(
      `SELECT t.sipd_jadwal_id, t.synced_at FROM ${tabel} t
       JOIN sipd_jadwal j ON j.id = t.sipd_jadwal_id
       WHERE j.tahun_id = ? AND t.id_skpd = ?`,
      [tahun_id, id_skpd]
    )
    dokumen[jenis] = Object.fromEntries(rows.map(r => [r.sipd_jadwal_id, r.synced_at]))
  }

  const [belanja] = await db.query(
    `SELECT b.sipd_jadwal_id, b.data FROM dpa_belanja b
     JOIN sipd_jadwal j ON j.id = b.sipd_jadwal_id
     WHERE j.tahun_id = ? AND b.id_skpd = ?`,
    [tahun_id, id_skpd]
  )
  const belanjaPer = new Map(belanja.map(b => [b.sipd_jadwal_id, b.data]))

  const [rincian] = await db.query(
    `SELECT r.sipd_jadwal_id, r.nama_sub_skpd, r.kode_sub_giat, r.nama_sub_giat, r.synced_at
     FROM dpa_rincian_belanja r JOIN sipd_jadwal j ON j.id = r.sipd_jadwal_id
     WHERE j.tahun_id = ? AND r.id_skpd = ?`,
    [tahun_id, id_skpd]
  )
  const rincianPer = new Map()
  for (const r of rincian) {
    if (!rincianPer.has(r.sipd_jadwal_id)) rincianPer.set(r.sipd_jadwal_id, [])
    rincianPer.get(r.sipd_jadwal_id).push(r)
  }

  // Satu baris = satu sub kegiatan di satu unit, dikenali dari baris DPA
  // Belanja. Rincian yang tidak terpasang ke target ditaruh ke baris dengan
  // unit sama dan kode atau nama sama; kalau tidak ada, jadi baris sendiri.
  const sub = []
  const sama = (a, b) => normal(a.nama_sub_skpd) === normal(b.nama_sub_skpd) &&
    (a.kode_sub_giat === b.kode_sub_giat || normal(a.nama_sub_giat) === normal(b.nama_sub_giat))
  const barisUntuk = (x) => {
    let b = sub.find(s => normal(s.nama_sub_skpd) === normal(x.nama_sub_skpd) && s.kode_sub_giat === x.kode_sub_giat)
      ?? sub.find(s => sama(s, x))
    if (!b) sub.push(b = { nama_sub_skpd: x.nama_sub_skpd, kode_sub_giat: x.kode_sub_giat, nama_sub_giat: x.nama_sub_giat, sel: {} })
    return b
  }

  for (const j of jadwal) {
    const masuk = rincianPer.get(j.id) ?? []
    if (!belanjaPer.has(j.id)) {
      for (const r of masuk) barisUntuk(r).sel[j.id] = { status: 'masuk', synced_at: r.synced_at }
      continue
    }
    const { hasil, diluarTarget } = pasangkan(subKegiatanDiDpaBelanja(belanjaPer.get(j.id)), masuk)
    for (const t of hasil)
      barisUntuk(t).sel[j.id] = t.rincian
        ? { status: 'ada', synced_at: t.rincian.synced_at, nilai: t.nilai }
        : { status: 'belum', nilai: t.nilai }
    for (const r of diluarTarget) barisUntuk(r).sel[j.id] ??= { status: 'diluar', synced_at: r.synced_at }
  }
  sub.sort((a, b) => String(a.nama_sub_skpd ?? '').localeCompare(String(b.nama_sub_skpd ?? '')) ||
    String(a.kode_sub_giat).localeCompare(String(b.kode_sub_giat)))

  return c.json({
    jadwal: jadwal.map(j => ({ ...j, aktif: !!j.aktif })),
    jenis: JENIS_PER_SKPD.map(([j]) => j),
    dokumen,
    rincian: sub,
  })
})

export default router
