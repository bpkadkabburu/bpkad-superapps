import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth.js'
import subkegiatanPmkRoutes from './routes/subkegiatanPmk.js'
import tahunAnggaranRoutes from './routes/tahunAnggaran.js'
import anggaranRekapRoutes from './routes/anggaranRekap.js'
import dokumenRealisasiRoutes from './routes/dokumenRealisasi.js'
import skpdRoutes from './routes/skpd.js'
import rekapRealisasiRoutes from './routes/rekapRealisasi.js'
import apiKeysRoutes from './routes/apiKeys.js'
import syncRoutes from './routes/sync.js'

const app = new Hono()

app.use('*', cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}))

app.route('/api/auth', authRoutes)
app.route('/api/api-keys', apiKeysRoutes)
app.route('/api/sync', syncRoutes)
app.route('/api/tahun-anggaran', tahunAnggaranRoutes)
app.route('/api/referensi/skpd', skpdRoutes)
app.route('/api/referensi/subkegiatan-pmk', subkegiatanPmkRoutes)
app.route('/api/sumber-data/anggaran', anggaranRekapRoutes)
app.route('/api/sumber-data/dokumen-realisasi', dokumenRealisasiRoutes)
app.route('/api/rekap-realisasi', rekapRealisasiRoutes)

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('API running on http://localhost:3001')
})
