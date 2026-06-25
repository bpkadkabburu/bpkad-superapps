// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

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
                path: 'subkegiatan-pmk',
                name: 'SubkegiatanPMK',
                component: () => import('../views/SubkegiatanPMKView.vue')
              }
            ]
          },
          {
            path: 'realisasi',
            name: 'Realisasi',
            component: () => import('../views/RealisasiView.vue')
          },
          {
            path: 'sumber-data',
            children: [
              {
                path: 'anggaran',
                name: 'AnggaranRekap',
                component: () => import('../views/AnggaranRekapView.vue')
              },
              {
                path: 'dokumen-realisasi',
                name: 'DokumenRealisasi',
                component: () => import('../views/DokumenRealisasiView.vue')
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
})

export default router
