import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useTahunStore } from '../stores/tahun'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
    meta: { requiresAuth: false }
  },
  {
    path: '/',
    component: () => import('../views/LayoutView.vue'),
    meta: { requiresAuth: true },
    children: [
      {
        path: '',
        name: 'SelectYear',
        component: () => import('../views/SelectYearView.vue')
      },
      {
        path: 'tahun/:tahun',
        children: [
          {
            path: '',
            name: 'Home',
            component: () => import('../views/HomeView.vue')
          },
          {
            path: 'referensi',
            children: [
              {
                path: 'skpd',
                name: 'ReferensiSKPD',
                component: () => import('../views/referensi/SkpdView.vue')
              },
              {
                path: 'subkegiatan-pmk',
                name: 'SubkegiatanPMK',
                component: () => import('../views/SubkegiatanPMKView.vue'),
                meta: { requiresSkpdSync: true }
              }
            ]
          },
          {
            path: 'sumber-data',
            children: [
              {
                path: 'anggaran',
                name: 'AnggaranRekap',
                component: () => import('../views/AnggaranRekapView.vue'),
                meta: { requiresSkpdSync: true }
              },
              {
                path: 'dokumen-realisasi',
                name: 'DokumenRealisasi',
                component: () => import('../views/DokumenRealisasiView.vue'),
                meta: { requiresSkpdSync: true }
              }
            ]
          }
        ]
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.requiresAuth !== false && !auth.isLoggedIn) {
    return { name: 'Login' }
  }

  if (to.meta.requiresSuperadmin && auth.user?.role !== 'superadmin') {
    return { name: 'SelectYear' }
  }

  // Guard: redirect ke halaman SKPD jika belum sync
  if (to.meta.requiresSkpdSync) {
    const tahunStore = useTahunStore()
    const tahun = to.params.tahun
    if (!tahunStore.skpdSyncedAt) {
      return { name: 'ReferensiSKPD', params: { tahun } }
    }
  }
})

export default router
