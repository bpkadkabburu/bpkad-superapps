<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { HomeFilled, DataAnalysis } from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const activeMenu = computed(() => '/' + (route.path.split('/')[1] || ''))

function logout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <el-container style="min-height: 100vh;">
    <el-header style="
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #fff;
      border-bottom: 1px solid #e4e7ed;
      position: sticky;
      top: 0;
      z-index: 100;
    ">
      <span style="font-weight: 700; font-size: 16px; color: #303133;">BPKAD Superapps</span>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-size: 13px; color: #606266;">{{ auth.user?.username }}</span>
        <el-tag size="small" :type="auth.isSuperadmin ? 'danger' : 'info'">
          {{ auth.isSuperadmin ? 'Superadmin' : 'User' }}
        </el-tag>
        <el-button size="small" @click="logout">Logout</el-button>
      </div>
    </el-header>

    <el-container>
      <el-aside width="200px" style="background: #fff; border-right: 1px solid #e4e7ed; min-height: calc(100vh - 60px);">
        <el-menu
          :default-active="activeMenu"
          router
          style="border-right: none; height: 100%;"
        >
          <el-menu-item index="/">
            <el-icon><HomeFilled /></el-icon>
            <span>Beranda</span>
          </el-menu-item>
          <el-menu-item index="/mapping-pmk">
            <el-icon><DataAnalysis /></el-icon>
            <span>Mapping PMK</span>
          </el-menu-item>
        </el-menu>
      </el-aside>

      <el-main style="background: #f0f2f5; padding: 24px 28px;">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>
