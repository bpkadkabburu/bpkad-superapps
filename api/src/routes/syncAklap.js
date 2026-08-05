import { Hono } from 'hono'
import db from '../db.js'
import { requireApiKey } from '../middleware/apiKey.js'

// ---------------------------------------------------------------------------
// Parse angka format Indonesia: titik = ribuan, koma = desimal
// "5.135.000,00" → 5135000.00
// "0,00" → 0
// ---------------------------------------------------------------------------
function parseAngkaId(str) {
  if (!str || typeof str !== 'string') return 0
  const s = str.trim().replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return isNaN(n) ? 0 : n
}

// ---------------------------------------------------------------------------
// Extract text content dari HTML string (strip tags)
// ---------------------------------------------------------------------------
function stripTags(html) {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, '').trim()
}

// ---------------------------------------------------------------------------
// Cari semua <table>...</table> dalam HTML string
// ---------------------------------------------------------------------------
function findTables(html) {
  const tables = []
  const re = /<table[\s\S]*?<\/table>/gi
  let m
  while ((m = re.exec(html)) !== null) tables.push(m[0])
  return tables
}

// ---------------------------------------------------------------------------
// Cari data <table> → yang punya <thead> dengan "Uraian Urusan"
// ---------------------------------------------------------------------------
function findDataTable(tables) {
  for (const t of tables) {
    if (/Uraian\s+Urusan/i.test(t)) return t
  }
  return null
}

// ---------------------------------------------------------------------------
// Extract <tr> dari <tbody> tabel data
// ---------------------------------------------------------------------------
function extractTbodyRows(tableHtml) {
  // Cari <tbody>...</tbody>
  const tbodyMatch = tableHtml.match(/<tbody[\s\S]*?>([\s\S]*?)<\/tbody>/i)
  if (!tbodyMatch) return []

  const tbody = tbodyMatch[1]
  const rows = []
  const trRe = /<tr[\s\S]*?>([\s\S]*?)<\/tr>/gi
  let m
  while ((m = trRe.exec(tbody)) !== null) {
    rows.push(m[1])
  }
  return rows
}

// ---------------------------------------------------------------------------
// Extract <td> dari satu <tr> string
// ---------------------------------------------------------------------------
function extractCells(trHtml) {
  const cells = []
  const tdRe = /<td[\s\S]*?>([\s\S]*?)<\/td>/gi
  let m
  while ((m = tdRe.exec(trHtml)) !== null) {
    cells.push(stripTags(m[1]).replace(/&nbsp;/gi, ' ').trim())
  }
  return cells
}

// ---------------------------------------------------------------------------
// Deteksi level baris berdasarkan kolom yang terisi
// Kolom: [0]kode1, [1]kode_sub_unit, [2]kode_program_dst, [3]kode_rekening,
//         [4]nama, [5-12]angka
// ---------------------------------------------------------------------------
function detectLevel(cells) {
  const col1 = cells[0] || ''
  const col2 = cells[1] || ''
  const col3 = cells[2] || ''
  const col4 = cells[3] || ''

  // Kolom 4 terisi → rekening level
  if (col4) return 'rekening'
  // Kolom 3 terisi → program/kegiatan/sub_kegiatan
  if (col3) {
    const dots = (col3.match(/\./g) || []).length
    if (dots <= 2) return 'program'          // 1.01.01
    if (dots <= 4) return 'kegiatan'         // 1.01.01.2.01
    return 'sub_kegiatan'                     // 1.01.01.2.01.0001
  }
  // Kolom 2 terisi → sub_unit
  if (col2) return 'sub_unit'
  // Kolom 1 terisi
  if (col1) {
    // Cek apakah mengandung titik → bidang_urusan (X.XX), tanpa titik → urusan (X)
    return col1.includes('.') ? 'bidang_urusan' : 'urusan'
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Cek apakah sebuah kode_rekening adalah leaf (tidak ada child di bawahnya)
// ---------------------------------------------------------------------------
function markLeafRekening(parsedRows) {
  // Kumpulkan semua kode_rekening yang ada
  const allKodes = new Set()
  for (const row of parsedRows) {
    if (row.level === 'rekening' && row.kode_rekening) {
      allKodes.add(row.kode_rekening)
    }
  }

  // Sebuah kode adalah leaf jika TIDAK ada kode lain yang dimulai dengan kode tersebut + '.'
  for (const row of parsedRows) {
    if (row.level !== 'rekening') continue
    const prefix = row.kode_rekening + '.'
    let isLeaf = true
    for (const k of allKodes) {
      if (k !== row.kode_rekening && k.startsWith(prefix)) {
        isLeaf = false
        break
      }
    }
    row.isLeaf = isLeaf
  }
}

// ---------------------------------------------------------------------------
// Main parse: HTML → array of flat rows (hanya leaf rekening)
// ---------------------------------------------------------------------------
export function parseAklapHtml(html) {
  const tables = findTables(html)
  const dataTable = findDataTable(tables)
  if (!dataTable) return []

  const trList = extractTbodyRows(dataTable)
  if (!trList.length) return []

  // Context: track hierarchy saat iterate baris demi baris
  const ctx = {
    kode_urusan: null, nama_urusan: null,
    kode_bidang_urusan: null, nama_bidang_urusan: null,
    kode_sub_skpd: null, nama_sub_skpd: null,
    kode_program: null, nama_program: null,
    kode_kegiatan: null, nama_kegiatan: null,
    kode_sub_kegiatan: null, nama_sub_kegiatan: null,
  }

  const parsedRows = []

  for (const trHtml of trList) {
    const cells = extractCells(trHtml)
    // Minimal harus ada 13 kolom (4 kode + 1 nama + 8 angka)
    if (cells.length < 13) continue

    const level = detectLevel(cells)
    const nama = cells[4] || ''

    switch (level) {
      case 'urusan':
        ctx.kode_urusan = cells[0]
        ctx.nama_urusan = nama
        // Reset level di bawahnya
        ctx.kode_bidang_urusan = null; ctx.nama_bidang_urusan = null
        ctx.kode_sub_skpd = null; ctx.nama_sub_skpd = null
        ctx.kode_program = null; ctx.nama_program = null
        ctx.kode_kegiatan = null; ctx.nama_kegiatan = null
        ctx.kode_sub_kegiatan = null; ctx.nama_sub_kegiatan = null
        break

      case 'bidang_urusan':
        ctx.kode_bidang_urusan = cells[0]
        ctx.nama_bidang_urusan = nama
        ctx.kode_sub_skpd = null; ctx.nama_sub_skpd = null
        ctx.kode_program = null; ctx.nama_program = null
        ctx.kode_kegiatan = null; ctx.nama_kegiatan = null
        ctx.kode_sub_kegiatan = null; ctx.nama_sub_kegiatan = null
        break

      case 'sub_unit':
        ctx.kode_sub_skpd = cells[1]
        ctx.nama_sub_skpd = nama
        ctx.kode_program = null; ctx.nama_program = null
        ctx.kode_kegiatan = null; ctx.nama_kegiatan = null
        ctx.kode_sub_kegiatan = null; ctx.nama_sub_kegiatan = null
        break

      case 'program':
        ctx.kode_program = cells[2]
        ctx.nama_program = nama
        ctx.kode_kegiatan = null; ctx.nama_kegiatan = null
        ctx.kode_sub_kegiatan = null; ctx.nama_sub_kegiatan = null
        break

      case 'kegiatan':
        ctx.kode_kegiatan = cells[2]
        ctx.nama_kegiatan = nama
        ctx.kode_sub_kegiatan = null; ctx.nama_sub_kegiatan = null
        break

      case 'sub_kegiatan':
        ctx.kode_sub_kegiatan = cells[2]
        ctx.nama_sub_kegiatan = nama
        break

      case 'rekening':
        parsedRows.push({
          level: 'rekening',
          kode_rekening: cells[3],
          nama_rekening: nama,
          // 8 kolom angka: col5=anggaranOperasi, col6=realisasiOperasi,
          //                col7=anggaranModal,   col8=realisasiModal,
          //                col9=anggaranTakTerduga, col10=realisasiTakTerduga,
          //                col11=anggaranTransfer,  col12=realisasiTransfer
          realisasi_operasi: parseAngkaId(cells[6]),
          realisasi_modal: parseAngkaId(cells[8]),
          realisasi_tak_terduga: parseAngkaId(cells[10]),
          realisasi_transfer: parseAngkaId(cells[12]),
          // Snapshot context saat ini
          ...structuredClone(ctx),
        })
        break
    }
  }

  // Tandai leaf rekening (yang tidak punya child)
  markLeafRekening(parsedRows)

  // Hanya ambil leaf rows, dan gabung realisasi jadi satu nilai
  return parsedRows
    .filter(r => r.isLeaf)
    .map(r => ({
      kode_sub_skpd: r.kode_sub_skpd,
      nama_sub_skpd: r.nama_sub_skpd,
      kode_urusan: r.kode_urusan,
      nama_urusan: r.nama_urusan,
      kode_bidang_urusan: r.kode_bidang_urusan,
      nama_bidang_urusan: r.nama_bidang_urusan,
      kode_program: r.kode_program,
      nama_program: r.nama_program,
      kode_kegiatan: r.kode_kegiatan,
      nama_kegiatan: r.nama_kegiatan,
      kode_sub_kegiatan: r.kode_sub_kegiatan,
      nama_sub_kegiatan: r.nama_sub_kegiatan,
      kode_rekening: r.kode_rekening,
      nama_rekening: r.nama_rekening,
      nilai_realisasi: r.realisasi_operasi + r.realisasi_modal
                     + r.realisasi_tak_terduga + r.realisasi_transfer,
    }))
}

// ---------------------------------------------------------------------------
// Resolve tahun → tahun_id
// ---------------------------------------------------------------------------
async function resolveTahunId(tahun) {
  const [rows] = await db.query('SELECT id FROM tahun_anggaran WHERE tahun = ?', [tahun])
  return rows[0]?.id ?? null
}

// ---------------------------------------------------------------------------
// DB columns (sesuai urutan INSERT)
// ---------------------------------------------------------------------------
const DB_COLS = [
  'kode_sub_skpd', 'nama_sub_skpd',
  'kode_urusan', 'nama_urusan',
  'kode_bidang_urusan', 'nama_bidang_urusan',
  'kode_program', 'nama_program',
  'kode_kegiatan', 'nama_kegiatan',
  'kode_sub_kegiatan', 'nama_sub_kegiatan',
  'kode_rekening', 'nama_rekening',
  'nilai_realisasi',
]

// ---------------------------------------------------------------------------
// Sync handler — dipanggil dari /api/sync/dokumen-aklap (API key)
//                atau /api/sumber-data/dokumen-aklap (JWT)
// ---------------------------------------------------------------------------
export const syncDokumenAklap = async (c) => {
  const { data, tahun } = await c.req.json()
  if (!tahun) return c.json({ error: 'tahun diperlukan' }, 400)
  if (!data || typeof data !== 'string')
    return c.json({ error: 'data (HTML string) tidak boleh kosong' }, 400)

  const tahun_id = await resolveTahunId(tahun)
  if (!tahun_id) return c.json({ error: 'Tahun tidak ditemukan' }, 404)

  // Parse HTML → structured rows
  const rows = parseAklapHtml(data)

  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // Full replace per tahun
    await conn.query('DELETE FROM dokumen_aklap WHERE tahun_id = ?', [tahun_id])

    if (rows.length > 0) {
      const placeholders = DB_COLS.map(() => '?').join(', ')
      const BATCH = 200
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH)
        const rowPlaceholders = chunk.map(() => `(UUID(), ?, ${placeholders})`).join(', ')
        const values = chunk.flatMap(row => [
          tahun_id,
          ...DB_COLS.map(col => row[col] ?? null),
        ])
        await conn.query(
          `INSERT INTO dokumen_aklap (id, tahun_id, ${DB_COLS.join(', ')}) VALUES ${rowPlaceholders}`,
          values
        )
      }
    }

    await conn.commit()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  // Return HTML apa adanya + jumlah parsed rows
  return c.json({ data, parsed: rows.length })
}

// ---------------------------------------------------------------------------
// Router extension: semua tulis lewat API key
// ---------------------------------------------------------------------------
const router = new Hono()
router.use('*', requireApiKey)
router.post('/', syncDokumenAklap)

export default router
