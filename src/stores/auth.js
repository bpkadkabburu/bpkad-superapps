import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../utils/api.js'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(JSON.parse(localStorage.getItem('user') || 'null'))

  const isLoggedIn   = computed(() => !!user.value)
  const isSuperadmin = computed(() => user.value?.role === 'superadmin')

  async function login(username, password) {
    const { data } = await api.post('/auth/login', { username, password })
    user.value = data.user
    localStorage.setItem('token', data.token)
    localStorage.setItem('user', JSON.stringify(data.user))
  }

  function logout() {
    user.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('user')
  }

  return { user, isLoggedIn, isSuperadmin, login, logout }
})
