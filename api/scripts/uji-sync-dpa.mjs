// Pengujian handler sinkron DPA (POST /api/sync/jadwal, /tim-tapd, /dpa) terhadap
// database sungguhan. MENULIS ke DB: memakai id_jadwal palsu (9900xx) dan
// menghapusnya lagi di akhir. Tim TAPD hanya diuji kalau tahun itu belum punya
// data, karena sinkronnya menghapus seluruh tim untuk tahun tersebut.
//
//   cd api && npm run uji:sync-dpa [tahun]

import 'dotenv/config'
import { Hono } from 'hono'
import jwt from 'jsonwebtoken'

import db from '../src/db.js'
import { syncJadwal, daftarJadwal, syncTimTapd, daftarTimTapd, syncDpa, syncDpaStatus } from '../src/routes/syncDpa.js'
import dpa from '../src/routes/dpa.js'

const TAHUN = Number(process.argv[2]) || new Date().getFullYear()

// Handler dipasang langsung, tanpa requireApiKey — yang diuji isi handlernya.
const app = new Hono()
app.post('/jadwal', syncJadwal)
app.get('/jadwal', daftarJadwal)
app.get('/tim-tapd', daftarTimTapd)
app.post('/tim-tapd', syncTimTapd)
app.post('/dpa', syncDpa)
app.get('/dpa/status', syncDpaStatus)
// Route baca halaman Kelengkapan DPA — yang ini lewat JWT seperti aslinya.
app.route('/api/dpa', dpa)
const token = jwt.sign({ id: 'uji', username: 'uji', role: 'superadmin' }, process.env.JWT_SECRET)

async function ambil(path, params = {}) {
  const url = new URL(`http://uji/api/dpa${path}`)
  url.searchParams.set('tahun', TAHUN)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await app.request(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`)
  return res.json()
}

async function kirim(path, body) {
  const res = await app.request(`http://uji${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json() }
}

let gagal = 0
function cek(nama, lulus, catatan) {
  if (lulus) console.log(`  ok    ${nama}${catatan ? `  (${catatan})` : ''}`)
  else { gagal++; console.log(`  GAGAL ${nama}${catatan ? `  (${catatan})` : ''}`) }
}

const [[ta]] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [TAHUN])
if (!ta) {
  console.log(`Tahun ${TAHUN} tidak ada di tahun_anggaran.`)
  process.exit(1)
}

console.log(`\nSinkron DPA — TA ${TAHUN}\n`)

try {
  // ---- Jadwal ----
  let r = await kirim('/dpa', { tahun: TAHUN, jenis: 'belanja', id_jadwal: 990063, id_skpd: 1, data: {} })
  cek('DPA sebelum jadwal ada → 404 "sinkron jadwal dulu"', r.status === 404 && /Sinkron jadwal dulu/.test(r.json.error), r.json.error)

  r = await kirim('/jadwal', {
    tahun: TAHUN,
    data: [
      { id_jadwal: 990063, id_jadwal_sipd: 990513, id_tahap_sipd: '32', is_locked: 0, jadwal_sipd_penatausahaan: 'UJI PENYESUAIAN', tahapan: 'Uji Tahap' },
      { id_jadwal: '990064', id_jadwal_sipd: '990514', jadwal_sipd_penatausahaan: 'UJI LAIN', tahapan: 'Uji Tahap 2' },
    ],
  })
  cek('jadwal tersimpan', r.status === 200 && r.json.count === 2, JSON.stringify(r.json))

  r = await kirim('/jadwal', {
    tahun: TAHUN,
    data: [{ id_jadwal: 990063, id_jadwal_sipd: 990513, jadwal_sipd_penatausahaan: 'UJI DIGANTI', tahapan: 'Uji Tahap' }],
  })
  const [jadwal] = await db.query(
    'SELECT id_jadwal, id_jadwal_sipd, nama FROM sipd_jadwal WHERE tahun_id = ? AND id_jadwal IN (990063, 990064) ORDER BY id_jadwal',
    [ta.id]
  )
  cek('upsert jadwal menimpa nama, tidak menggandakan',
    jadwal.length === 2 && jadwal[0].nama === 'UJI DIGANTI' && jadwal[1].id_jadwal_sipd === 990514,
    jadwal.map(j => `${j.id_jadwal}:${j.nama}`).join(', '))

  // ---- Jadwal aktif / nonaktif ----
  const lihat = async (path, tahun = TAHUN) => {
    const res = await app.request(`http://uji${path}${tahun === null ? '' : `?tahun=${tahun}`}`)
    return { status: res.status, json: await res.json() }
  }
  const tokenJ = (await ambil('/jadwal')).data.find(j => j.id_jadwal === 990064)
  const putAktif = await app.request(`http://uji/api/dpa/jadwal/${tokenJ.id}/aktif`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ aktif: false }),
  })
  cek('PUT aktif=false dari dashboard', putAktif.status === 200)
  await kirim('/jadwal', {
    tahun: TAHUN,
    data: [
      { id_jadwal: 990064, id_jadwal_sipd: 990514, jadwal_sipd_penatausahaan: 'UJI LAIN', tahapan: 'Uji Tahap 2' },
      { id_jadwal: 990063, id_jadwal_sipd: 990513, jadwal_sipd_penatausahaan: 'UJI DIGANTI', tahapan: 'Uji Tahap' },
      { id_jadwal: 990065, id_jadwal_sipd: 990515, jadwal_sipd_penatausahaan: 'UJI BARU', tahapan: 'Uji Tahap 3' },
    ],
  })
  const [[aktif64]] = await db.query('SELECT aktif FROM sipd_jadwal WHERE tahun_id = ? AND id_jadwal = 990064', [ta.id])
  cek('sinkron ulang tidak menimpa aktif=false', aktif64?.aktif === 0)
  r = await lihat('/jadwal')
  const uji = r.json.data.filter(j => j.id_jadwal >= 990063 && j.id_jadwal <= 990065)
  cek('GET /sync/jadwal hanya yang aktif, urut seperti SIPD',
    r.status === 200 && uji.map(j => j.id_jadwal).join() === '990063,990065',
    uji.map(j => j.id_jadwal).join(', '))
  cek('GET /sync/jadwal tanpa UUID / kolom internal',
    uji.every(j => Object.keys(j).sort().join() === 'id_jadwal,id_jadwal_sipd,nama,tahapan'), Object.keys(uji[0] ?? {}).join(','))
  r = await lihat('/jadwal', null)
  cek('GET /sync/jadwal tanpa tahun → 400', r.status === 400)
  r = await lihat('/jadwal', 1999)
  cek('GET /sync/jadwal tahun tanpa data → []', r.status === 200 && r.json.data.length === 0)

  r = await kirim('/jadwal', { tahun: TAHUN, data: [{ jadwal_sipd_penatausahaan: 'tanpa id' }] })
  cek('jadwal tanpa id_jadwal ditolak', r.status === 400, r.json.error)

  // ---- DPA per SKPD ----
  r = await kirim('/dpa', { tahun: TAHUN, jenis: 'belanja', id_jadwal: 990063, id_skpd: 416, kode_skpd: 'K', nama_skpd: 'SKPD Uji', data: { tipe_q: 'OLD', versi: 1 } })
  cek('DPA belanja tersimpan', r.status === 200, JSON.stringify(r.json))
  r = await kirim('/dpa', { tahun: TAHUN, jenis: 'belanja', id_jadwal: 990063, id_skpd: 416, kode_skpd: 'K', nama_skpd: 'SKPD Uji', data: { tipe_q: 'NEW', versi: 2 } })
  const [belanja] = await db.query(
    `SELECT b.data FROM dpa_belanja b JOIN sipd_jadwal j ON j.id = b.sipd_jadwal_id
     WHERE j.tahun_id = ? AND j.id_jadwal = 990063 AND b.id_skpd = 416`,
    [ta.id]
  )
  cek('upsert DPA menimpa data, satu baris', belanja.length === 1 && belanja[0].data.versi === 2, JSON.stringify(belanja[0]?.data))

  r = await kirim('/dpa', { tahun: TAHUN, jenis: 'anggaran', id_jadwal: 990063, id_skpd: 416, data: {} })
  cek('jenis tak dikenal ditolak', r.status === 400, r.json.error)

  // ---- Rincian belanja: dirujuk lewat id_jadwal_sipd ----
  const rincian = (id_sub_giat, versi) => ({
    tahun: TAHUN, jenis: 'rincian_belanja', id_jadwal_sipd: 990513,
    id_skpd: 416, kode_skpd: 'K', nama_skpd: 'SKPD Uji',
    id_sub_skpd: 416, nama_sub_skpd: 'Sub Uji', id_sub_giat, kode_sub_giat: `X.${id_sub_giat}`, nama_sub_giat: 'Sub giat uji',
    data: { versi },
  })
  await kirim('/dpa', rincian(1, 1))
  await kirim('/dpa', rincian(2, 1))
  r = await kirim('/dpa', rincian(1, 2))
  const [rb] = await db.query(
    `SELECT rb.id_sub_giat, rb.data FROM dpa_rincian_belanja rb JOIN sipd_jadwal j ON j.id = rb.sipd_jadwal_id
     WHERE j.tahun_id = ? AND j.id_jadwal = 990063 ORDER BY rb.id_sub_giat`,
    [ta.id]
  )
  cek('rincian per sub kegiatan tidak saling menimpa',
    r.status === 200 && rb.length === 2 && rb[0].data.versi === 2 && rb[1].data.versi === 1,
    rb.map(x => `${x.id_sub_giat}:v${x.data.versi}`).join(', '))

  // ---- Halaman Kelengkapan DPA (GET /api/dpa/*) ----
  // Satu sub kegiatan asli dari referensi, supaya pencocokan (id_sub_skpd,
  // id_sub_giat) ikut teruji — dua sub giat uji di atas tidak ada di referensi.
  const [[subAsli]] = await db.query(
    'SELECT id_sub_skpd, nama_sub_skpd, id_sub_giat, kode_sub_giat, nama_sub_giat FROM sub_kegiatan WHERE tahun_id = ? AND id_skpd = 416 LIMIT 1',
    [ta.id]
  )
  if (subAsli) await kirim('/dpa', { ...rincian(subAsli.id_sub_giat, 1), ...subAsli })

  const daftar = await ambil('/jadwal')
  const j63 = daftar.data.find(j => j.id_jadwal === 990063)
  cek('daftar jadwal menghitung dinas per jenis', j63?.belanja === 1 && j63?.rincian_belanja === 1 && j63?.skpd === 0,
    `belanja ${j63?.belanja}, rincian ${j63?.rincian_belanja}, skpd ${j63?.skpd}`)

  const kel = await ambil('/kelengkapan', { jadwal: j63.id })
  const setda = kel.data.find(r => r.id_skpd === 416)
  cek('matriks: belanja ada, skpd belum', !!setda?.belanja && !setda?.skpd, `belanja ${setda?.belanja ? 'ada' : '-'}`)
  cek('matriks: rincian dihitung terhadap referensi',
    setda?.rincian_belanja.jumlah === (subAsli ? 3 : 2) && setda?.rincian_belanja.target > 0,
    `${setda?.rincian_belanja.jumlah} / ${setda?.rincian_belanja.target}`)
  cek('matriks memuat semua dinas induk', kel.data.length >= daftar.jumlahSkpd, `${kel.data.length} baris, ${daftar.jumlahSkpd} induk`)
  cek('kolom data JSON tidak ikut terkirim', !JSON.stringify(kel).includes('"versi"'))

  const det = await ambil('/kelengkapan/rincian', { jadwal: j63.id, idSkpd: 416 })
  const sudah = det.data.filter(d => d.synced_at).length
  cek('detail rincian: sub kegiatan asli tercocok', sudah === (subAsli ? 1 : 0), `${sudah} dari ${det.data.length} sudah`)
  cek('detail rincian: sub giat di luar referensi terdaftar', det.diluarReferensi.length === 2, `${det.diluarReferensi.length}`)

  // ---- Status untuk modal download extension (GET /api/sync/dpa/status) ----
  const status = async (params) => {
    const res = await app.request(`http://uji/dpa/status?${new URLSearchParams(params)}`)
    return { status: res.status, json: await res.json() }
  }
  r = await status({ tahun: TAHUN, jenis: 'belanja' })
  const stBelanja = r.json.data?.find(d => d.id_jadwal === 990063 && d.id_skpd === 416)
  cek('status belanja membawa id_jadwal + id_jadwal_sipd + synced_at',
    stBelanja?.id_jadwal_sipd === 990513 && !!stBelanja?.synced_at && !('data' in stBelanja) && !('id_sub_giat' in stBelanja),
    JSON.stringify(stBelanja))
  r = await status({ tahun: TAHUN, jenis: 'rincian_belanja', id_skpd: 416 })
  const stRincian = r.json.data?.filter(d => d.id_jadwal_sipd === 990513) ?? []
  cek('status rincian per SKPD membawa id_sub_skpd + id_sub_giat',
    stRincian.length === (subAsli ? 3 : 2) && stRincian.every(d => 'id_sub_skpd' in d && 'id_sub_giat' in d && !('data' in d)),
    `${stRincian.length} item`)
  r = await status({ tahun: TAHUN, jenis: 'rincian_belanja', id_skpd: 999999 })
  cek('status difilter id_skpd', r.status === 200 && r.json.data.length === 0)
  r = await status({ tahun: TAHUN, jenis: 'anggaran' })
  cek('status jenis tidak valid → 400', r.status === 400, r.json.error)
  r = await status({ tahun: 1999, jenis: 'belanja' })
  cek('status tahun tanpa data → data []', r.status === 200 && Array.isArray(r.json.data) && r.json.data.length === 0)

  // ---- Tim TAPD ----
  const [[{ ada }]] = await db.query('SELECT COUNT(*) AS ada FROM sipd_tim_tapd WHERE tahun_id = ?', [ta.id])
  if (ada) {
    console.log(`  lewat Tim TAPD: tahun ${TAHUN} sudah punya ${ada} anggota, tidak ditimpa`)
  } else {
    await kirim('/tim-tapd', { tahun: TAHUN, data: [
      { jabatan_tapd: 'Ketua', nama_tapd: '196702071998031015', nip_tapd: 'Drs. Uji Satu, M.M.', no_urut: '1', tahun: TAHUN },
      { jabatan_tapd: 'Anggota', nama_tapd: '197001011990011001', nip_tapd: 'Uji Dua', no_urut: '2', tahun: TAHUN },
    ] })
    r = await kirim('/tim-tapd', { tahun: TAHUN, data: [
      { jabatan_tapd: 'Ketua', nama_tapd: '196702071998031015', nip_tapd: 'Drs. Uji Satu, M.M.', no_urut: '1', tahun: TAHUN },
      // Seandainya SIPD sudah membetulkan urutannya — jangan ikut dibalik.
      { jabatan_tapd: 'Sekretaris', nama_tapd: 'Uji Tiga', nip_tapd: '198001012005011002', no_urut: '3', tahun: TAHUN },
    ] })
    const [tim] = await db.query('SELECT no_urut, nama, nip FROM sipd_tim_tapd WHERE tahun_id = ? ORDER BY no_urut', [ta.id])
    cek('nama/nip yang tertukar dibalik', tim[0]?.nama === 'Drs. Uji Satu, M.M.' && tim[0]?.nip === '196702071998031015', `${tim[0]?.nama} / ${tim[0]?.nip}`)
    cek('baris yang sudah benar tidak ikut dibalik', tim[1]?.nama === 'Uji Tiga' && tim[1]?.nip === '198001012005011002', `${tim[1]?.nama} / ${tim[1]?.nip}`)
    cek('anggota yang keluar ikut terhapus', r.status === 200 && tim.length === 2 && !tim.some(t => t.no_urut === 2), tim.map(t => t.no_urut).join(', '))
    const tapdSync = await lihat('/tim-tapd')
    cek('GET /sync/tim-tapd nama/nip sudah benar',
      tapdSync.json.data[0]?.nama === 'Drs. Uji Satu, M.M.' && tapdSync.json.data[0]?.nip === '196702071998031015' &&
      Object.keys(tapdSync.json.data[0]).sort().join() === 'jabatan,nama,nip,no_urut',
      JSON.stringify(tapdSync.json.data[0]))
    const tapd = await ambil('/tim-tapd')
    cek('GET tim-tapd urut no_urut, nama/nip sudah benar',
      tapd.data.length === 2 && tapd.data[0].nama === 'Drs. Uji Satu, M.M.' && tapd.data[1].no_urut === 3,
      tapd.data.map(t => `${t.no_urut}:${t.nama}`).join(', '))
    await db.query('DELETE FROM sipd_tim_tapd WHERE tahun_id = ?', [ta.id])
  }
} finally {
  // CASCADE ikut membersihkan baris DPA yang menempel ke jadwal uji.
  await db.query('DELETE FROM sipd_jadwal WHERE tahun_id = ? AND id_jadwal IN (990063, 990064, 990065)', [ta.id])
}

console.log(gagal ? `\n${gagal} pengujian GAGAL.` : '\nSemua lulus.')
process.exit(gagal ? 1 : 0)
