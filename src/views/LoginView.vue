<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { getDb } from '../utils/db'
import { ElMessage } from 'element-plus'

const router = useRouter()
const auth = useAuthStore()

const form = reactive({ username: '', password: '' })
const loading = ref(false)

async function handleLogin() {
  loading.value = true
  try {
    const db = await getDb()
    const result = await db.select(
      'SELECT id, username, role FROM users WHERE username = ? AND password_hash = ?',
      [form.username, form.password]
    )
    if (result.length === 0) {
      ElMessage.error('Username atau password salah')
      return
    }
    auth.login(result[0])
    router.push('/')
  } catch (e) {
    ElMessage.error('Gagal login: ' + e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrapper">
    <el-card class="login-card">
      <template #header>
        <h2>BPKAD Superapps</h2>
        <p>Silakan login untuk melanjutkan</p>
      </template>
      <el-form :model="form" label-position="top" @submit.prevent="handleLogin">
        <el-form-item label="Username">
          <el-input v-model="form.username" placeholder="Username" />
        </el-form-item>
        <el-form-item label="Password">
          <el-input v-model="form.password" type="password" placeholder="Password" show-password />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="loading" style="width: 100%">
          Login
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>

<style scoped>
.login-wrapper {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
}
.login-card {
  width: 380px;
}
.login-card h2 {
  font-size: 20px;
  font-weight: 600;
}
.login-card p {
  font-size: 13px;
  color: #888;
  margin-top: 4px;
}
</style>
