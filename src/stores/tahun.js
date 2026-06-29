import { defineStore } from 'pinia'
import { ref } from 'vue'

const LS_KEY = 'tahun_active'

function loadFromStorage() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || 'null')
  } catch {
    return null
  }
}

export const useTahunStore = defineStore('tahun', () => {
  const stored = loadFromStorage()
  const activeTahun = ref(stored?.tahun ?? null)
  const skpdSyncedAt = ref(stored?.skpd_synced_at ?? null)

  function setActiveTahun(tahunItem) {
    activeTahun.value = tahunItem?.tahun ?? null
    skpdSyncedAt.value = tahunItem?.skpd_synced_at ?? null
    persist()
  }

  function markSkpdSynced(syncedAt) {
    skpdSyncedAt.value = syncedAt
    persist()
  }

  function clearSkpdSync() {
    skpdSyncedAt.value = null
    persist()
  }

  function reset() {
    activeTahun.value = null
    skpdSyncedAt.value = null
    localStorage.removeItem(LS_KEY)
  }

  function persist() {
    if (activeTahun.value) {
      localStorage.setItem(LS_KEY, JSON.stringify({
        tahun: activeTahun.value,
        skpd_synced_at: skpdSyncedAt.value,
      }))
    } else {
      localStorage.removeItem(LS_KEY)
    }
  }

  return { activeTahun, skpdSyncedAt, setActiveTahun, markSkpdSynced, clearSkpdSync, reset }
})
