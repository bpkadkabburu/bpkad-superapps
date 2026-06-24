import 'dotenv/config'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import authRoutes from './routes/auth.js'
import realisasiRoutes from './routes/realisasi.js'
import paketRoutes from './routes/paket.js'
import mappingRoutes from './routes/mapping.js'

const app = new Hono()

app.use('*', cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
}))

app.route('/api/auth', authRoutes)
app.route('/api/realisasi', realisasiRoutes)
app.route('/api/paket-anggaran', paketRoutes)
app.route('/api/mapping-pmk', mappingRoutes)

serve({ fetch: app.fetch, port: 3001 }, () => {
  console.log('API running on http://localhost:3001')
})
