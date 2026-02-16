<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type Mode = 'focus' | 'break'
type ActivityTab = 'stats' | 'history'

type GardenState = {
  totalSessions: number
  sessionsToday: number
  streakDays: number
  lastSessionDate: string | null
}

type HistoryEntry = {
  id: string
  sessionType: Mode
  durationMinutes: number
  completedAt: string
}

type SupabaseGardenSessionRow = {
  total_sessions: number
  sessions_today: number
  streak_days: number
  last_session_date: string | null
}

type SupabaseHistoryRow = {
  id: string
  session_type: Mode
  duration_minutes: number
  completed_at: string
}

const STORAGE_KEY = 'focus-garden:v1'
const USER_KEY = 'focus-garden:user-id'

const config = useRuntimeConfig()
const supabaseUrl = String(config.public.supabaseUrl || '').replace(/\/+$/, '')
const supabaseToken = String(config.public.supabaseToken || '').trim()

function createSupabaseClient(baseUrl: string, token: string) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/, '')
  const normalizedToken = String(token || '').trim()
  const enabled = Boolean(normalizedBaseUrl && normalizedToken)

  const headers = (prefer?: string) => {
    const result: Record<string, string> = {
      apikey: normalizedToken,
      Authorization: `Bearer ${normalizedToken}`,
      'Content-Type': 'application/json',
    }
    if (prefer) result.Prefer = prefer
    return result
  }

  const loadGarden = async (userId: string) => {
    if (!enabled) return null

    const query = new URLSearchParams({
      select: 'total_sessions,sessions_today,streak_days,last_session_date',
      user_id: `eq.${userId}`,
      limit: '1',
    })

    const response = await fetch(`${normalizedBaseUrl}/rest/v1/garden_sessions?${query.toString()}`, {
      method: 'GET',
      headers: headers(),
    })

    if (!response.ok) throw new Error(`load garden failed with status ${response.status}`)

    const rows = await response.json() as SupabaseGardenSessionRow[]
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
  }

  const upsertGarden = async (userId: string, state: GardenState) => {
    if (!enabled) return

    const payload = {
      user_id: userId,
      total_sessions: state.totalSessions,
      sessions_today: state.sessionsToday,
      streak_days: state.streakDays,
      last_session_date: state.lastSessionDate,
      updated_at: new Date().toISOString(),
    }

    const response = await fetch(`${normalizedBaseUrl}/rest/v1/garden_sessions?on_conflict=user_id`, {
      method: 'POST',
      headers: headers('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(payload),
    })

    if (!response.ok) throw new Error(`sync garden failed with status ${response.status}`)
  }

  const loadHistory = async (userId: string, limit = 40) => {
    if (!enabled) return []

    const query = new URLSearchParams({
      select: 'id,session_type,duration_minutes,completed_at',
      user_id: `eq.${userId}`,
      order: 'completed_at.desc',
      limit: String(limit),
    })

    const response = await fetch(`${normalizedBaseUrl}/rest/v1/garden_history?${query.toString()}`, {
      method: 'GET',
      headers: headers(),
    })

    if (!response.ok) throw new Error(`load history failed with status ${response.status}`)

    const rows = await response.json() as SupabaseHistoryRow[]
    return Array.isArray(rows) ? rows : []
  }

  const insertHistory = async (userId: string, entry: HistoryEntry) => {
    if (!enabled) return

    const payload = {
      id: entry.id,
      user_id: userId,
      session_type: entry.sessionType,
      duration_minutes: entry.durationMinutes,
      completed_at: entry.completedAt,
    }

    const response = await fetch(`${normalizedBaseUrl}/rest/v1/garden_history`, {
      method: 'POST',
      headers: headers('return=minimal'),
      body: JSON.stringify(payload),
    })

    if (!response.ok) throw new Error(`insert history failed with status ${response.status}`)
  }

  return {
    enabled,
    loadGarden,
    upsertGarden,
    loadHistory,
    insertHistory,
  }
}

const supabaseClient = createSupabaseClient(supabaseUrl, supabaseToken)
const supabaseEnabled = supabaseClient.enabled
const syncInProgress = ref(false)

const focusMinutes = ref(25)
const breakMinutes = ref(5)
const mode = ref<Mode>('focus')
const secondsLeft = ref(focusMinutes.value * 60)
const running = ref(false)
const showInputs = ref(false)
const activeActivityTab = ref<ActivityTab>('stats')

const garden = ref<GardenState>({
  totalSessions: 0,
  sessionsToday: 0,
  streakDays: 0,
  lastSessionDate: null,
})
const history = ref<HistoryEntry[]>([])
const newlyPlanted = ref<number[]>([])
const showSparkle = ref(false)

const lofiStations = [
  { name: 'Lofi Girl Live', url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk', type: 'external' },
  { name: 'SomaFM Groove Salad', url: 'https://ice4.somafm.com/groovesalad-128-mp3', type: 'audio' },
  { name: 'SomaFM Drone Zone', url: 'https://ice4.somafm.com/dronezone-128-mp3', type: 'audio' },
]

const selectedStation = ref(lofiStations[1].url)
const audioRef = ref<HTMLAudioElement | null>(null)
const audioPlaying = ref(false)

let timer: ReturnType<typeof setInterval> | null = null

const modeTitle = computed(() => mode.value === 'focus' ? 'Deep Focus' : 'Gentle Break')
const modeHint = computed(() => mode.value === 'focus' ? 'Build momentum one calm session at a time.' : 'Let your attention reset before the next sprint.')

const dayPhase = computed(() => {
  if (garden.value.totalSessions >= 22) return 'night'
  if (garden.value.totalSessions >= 10) return 'sunset'
  return 'golden'
})

const mmss = computed(() => {
  const minutes = Math.floor(secondsLeft.value / 60).toString().padStart(2, '0')
  const seconds = (secondsLeft.value % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
})

const gardenStage = computed(() => {
  if (garden.value.totalSessions >= 30) return 4
  if (garden.value.totalSessions >= 20) return 3
  if (garden.value.totalSessions >= 10) return 2
  if (garden.value.totalSessions >= 3) return 1
  return 0
})

const progressToNext = computed(() => {
  if (garden.value.totalSessions >= 30) return 100
  const thresholds = [3, 10, 20, 30]
  const current = garden.value.totalSessions
  const next = thresholds.find(value => current < value)
  if (!next) return 100

  const previous = [...thresholds].reverse().find(value => value <= current) ?? 0
  const ratio = ((current - previous) / (next - previous)) * 100
  return Math.max(0, Math.min(100, Math.round(ratio)))
})

const plantTypes = [
  { id: 'daisy', name: 'Daisy', emoji: '🌼', hue: 44 },
  { id: 'sunflower', name: 'Sunflower', emoji: '🌻', hue: 38 },
  { id: 'tulip', name: 'Tulip', emoji: '🌷', hue: 12 },
  { id: 'hibiscus', name: 'Hibiscus', emoji: '🌺', hue: 8 },
  { id: 'rose', name: 'Rose', emoji: '🌹', hue: 0 },
  { id: 'cactus', name: 'Cactus', emoji: '🌵', hue: 140 },
]

const plantCount = computed(() => Math.min(14, Math.floor(garden.value.totalSessions / 2) + 1))

const plants = computed(() => {
  return Array.from({ length: plantCount.value }, (_, index) => ({
    id: index,
    hue: plantTypes[index % plantTypes.length].hue,
    emoji: plantTypes[index % plantTypes.length].emoji,
    style: makePlantStyle(index),
  }))
})

const unlockedPlants = computed(() => {
  const count = garden.value.totalSessions
  if (count <= 0) return []
  if (count < 3) return [plantTypes[0]]
  if (count < 10) return plantTypes.slice(0, 2)
  if (count < 20) return plantTypes.slice(0, 4)
  return plantTypes
})

const recentHistory = computed(() => history.value.slice(0, 20))

function dayFromIsoTimestamp(isoValue: string) {
  return isoValue.slice(0, 10)
}

function countEntriesBetween(startInclusive: Date, endExclusive: Date) {
  const startMs = startInclusive.getTime()
  const endMs = endExclusive.getTime()

  return history.value.filter((entry) => {
    const completed = new Date(entry.completedAt).getTime()
    return completed >= startMs && completed < endMs
  }).length
}

function startOfWeek(date: Date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const offset = (start.getDay() + 6) % 7
  start.setDate(start.getDate() - offset)
  return start
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

const weeklyStats = computed(() => {
  const now = new Date()
  const thisWeekStart = startOfWeek(now)
  const nextWeekStart = new Date(thisWeekStart)
  nextWeekStart.setDate(nextWeekStart.getDate() + 7)
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)

  return {
    thisWeek: countEntriesBetween(thisWeekStart, nextWeekStart),
    lastWeek: countEntriesBetween(lastWeekStart, thisWeekStart),
  }
})

const monthlyStats = computed(() => {
  const now = new Date()
  const thisMonthStart = startOfMonth(now)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  return {
    thisMonth: countEntriesBetween(thisMonthStart, nextMonthStart),
    lastMonth: countEntriesBetween(lastMonthStart, thisMonthStart),
  }
})

const bestStreakFromHistory = computed(() => {
  const focusDays = new Set(
    history.value
      .filter(entry => entry.sessionType === 'focus')
      .map(entry => dayFromIsoTimestamp(entry.completedAt)),
  )
  const sorted = [...focusDays].sort()

  let best = 0
  let current = 0
  let previous: string | null = null

  for (const day of sorted) {
    if (!previous) {
      current = 1
    } else {
      const prevDate = new Date(previous)
      const currentDate = new Date(day)
      const delta = Math.round((currentDate.getTime() - prevDate.getTime()) / 86400000)
      current = delta === 1 ? current + 1 : 1
    }
    best = Math.max(best, current)
    previous = day
  }

  return best
})

const streakHistory = computed(() => {
  const byDay: Record<string, number> = {}

  for (const entry of history.value) {
    if (entry.sessionType !== 'focus') continue
    const day = dayFromIsoTimestamp(entry.completedAt)
    byDay[day] = (byDay[day] || 0) + 1
  }

  return Array.from({ length: 10 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (9 - index))
    const iso = date.toISOString().slice(0, 10)
    const count = byDay[iso] || 0

    return {
      day: iso.slice(5),
      count,
      active: count > 0,
    }
  })
})

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function createLocalId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`
}

function getOrCreateUserId() {
  const existing = localStorage.getItem(USER_KEY)
  if (existing) return existing

  const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `user-${Date.now()}-${Math.round(Math.random() * 1e9)}`

  localStorage.setItem(USER_KEY, next)
  return next
}

function sanitizeGardenState(value: unknown): GardenState {
  const input = (value ?? {}) as Record<string, unknown>
  const maybeDate = input.lastSessionDate

  return {
    totalSessions: Math.max(0, Number(input.totalSessions ?? 0) || 0),
    sessionsToday: Math.max(0, Number(input.sessionsToday ?? 0) || 0),
    streakDays: Math.max(0, Number(input.streakDays ?? 0) || 0),
    lastSessionDate: typeof maybeDate === 'string' ? maybeDate : null,
  }
}

function sanitizeHistoryEntry(value: unknown): HistoryEntry | null {
  const input = (value ?? {}) as Record<string, unknown>
  const sessionType = input.sessionType === 'break' ? 'break' : input.sessionType === 'focus' ? 'focus' : null
  const completedAt = typeof input.completedAt === 'string' ? input.completedAt : null

  if (!sessionType || !completedAt) return null

  return {
    id: typeof input.id === 'string' ? input.id : createLocalId(),
    sessionType,
    durationMinutes: Math.max(1, Number(input.durationMinutes ?? 0) || 1),
    completedAt,
  }
}

function makePlantStyle(index: number) {
  const left = 8 + (index * 7.2) % 82
  const scale = 0.75 + (index % 4) * 0.14
  const bottom = 17 + (index * 2) % 16

  return {
    left: `${left}%`,
    bottom: `${bottom}%`,
    transform: `translateX(-50%) scale(${scale})`,
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    focusMinutes: focusMinutes.value,
    breakMinutes: breakMinutes.value,
    mode: mode.value,
    secondsLeft: secondsLeft.value,
    selectedStation: selectedStation.value,
    garden: garden.value,
    history: history.value,
  }))
}

function syncDailyCounters() {
  const today = todayISO()
  if (garden.value.lastSessionDate && garden.value.lastSessionDate !== today) {
    garden.value.sessionsToday = 0
    return true
  }
  return false
}

async function ensureSupabaseTable() {
  if (!supabaseEnabled) return false

  try {
    await $fetch('/api/supabase/setup', {
      method: 'POST',
      body: { supabaseUrl },
    })
    return true
  } catch (error) {
    console.warn('[focus-garden] Supabase setup failed. Using localStorage only.', error)
    return false
  }
}

async function loadFromSupabase() {
  if (!supabaseEnabled) return null

  const userId = getOrCreateUserId()

  try {
    const [gardenRow, historyRows] = await Promise.all([
      supabaseClient.loadGarden(userId),
      supabaseClient.loadHistory(userId, 40),
    ])

    return {
      garden: gardenRow
        ? sanitizeGardenState({
            totalSessions: gardenRow.total_sessions,
            sessionsToday: gardenRow.sessions_today,
            streakDays: gardenRow.streak_days,
            lastSessionDate: gardenRow.last_session_date,
          })
        : null,
      history: historyRows
        .map(row => sanitizeHistoryEntry({
          id: row.id,
          sessionType: row.session_type,
          durationMinutes: row.duration_minutes,
          completedAt: row.completed_at,
        }))
        .filter((entry): entry is HistoryEntry => entry !== null),
    }
  } catch (error) {
    console.warn('[focus-garden] Could not load Supabase state. Using localStorage fallback.', error)
    return null
  }
}

async function syncGardenToSupabase() {
  if (!supabaseEnabled || syncInProgress.value) return false

  syncInProgress.value = true
  const userId = getOrCreateUserId()

  try {
    await supabaseClient.upsertGarden(userId, garden.value)
    return true
  } catch (error) {
    console.warn('[focus-garden] Supabase sync failed. localStorage remains source of truth.', error)
    return false
  } finally {
    syncInProgress.value = false
  }
}

async function syncHistoryEntryToSupabase(entry: HistoryEntry) {
  if (!supabaseEnabled) return

  const userId = getOrCreateUserId()
  try {
    await supabaseClient.insertHistory(userId, entry)
  } catch (error) {
    console.warn('[focus-garden] History sync failed. localStorage remains source of truth.', error)
  }
}

function stopTimer() {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

function setMode(next: Mode) {
  mode.value = next
  running.value = false
  stopTimer()
  secondsLeft.value = (next === 'focus' ? focusMinutes.value : breakMinutes.value) * 60
  persist()
}

function completeFocusSession() {
  const today = todayISO()
  const previousTotal = garden.value.totalSessions
  const previousDate = garden.value.lastSessionDate

  garden.value.totalSessions += 1
  garden.value.sessionsToday += 1

  const newPlantIndices: number[] = []
  for (let i = Math.floor(previousTotal / 2); i < Math.floor(garden.value.totalSessions / 2); i += 1) {
    newPlantIndices.push(i)
  }

  if (newPlantIndices.length > 0) {
    newlyPlanted.value = newPlantIndices
    showSparkle.value = true
    setTimeout(() => {
      newlyPlanted.value = []
      showSparkle.value = false
    }, 2200)
  }

  if (!previousDate) {
    garden.value.streakDays = 1
  } else {
    const last = new Date(previousDate)
    const current = new Date(today)
    const delta = Math.round((current.getTime() - last.getTime()) / 86400000)

    if (delta === 1) {
      garden.value.streakDays += 1
    } else if (delta > 1) {
      garden.value.streakDays = 1
    }
  }

  garden.value.lastSessionDate = today
  persist()
  void syncGardenToSupabase()
}

function recordCompletedSession(sessionType: Mode, durationMinutes: number) {
  const entry: HistoryEntry = {
    id: createLocalId(),
    sessionType,
    durationMinutes: Math.max(1, Number(durationMinutes) || 1),
    completedAt: new Date().toISOString(),
  }

  history.value = [entry, ...history.value].slice(0, 100)
  persist()
  void syncHistoryEntryToSupabase(entry)
}

function onTimerDone() {
  const completedMode = mode.value
  const completedDuration = completedMode === 'focus' ? focusMinutes.value : breakMinutes.value

  recordCompletedSession(completedMode, completedDuration)

  if (completedMode === 'focus') {
    completeFocusSession()
    setMode('break')
  } else {
    setMode('focus')
  }
}

function toggleTimer() {
  if (running.value) {
    running.value = false
    stopTimer()
    persist()
    return
  }

  running.value = true
  timer = setInterval(() => {
    if (secondsLeft.value <= 1) {
      running.value = false
      stopTimer()
      onTimerDone()
      return
    }
    secondsLeft.value -= 1
  }, 1000)

  persist()
}

function resetTimer() {
  running.value = false
  stopTimer()
  secondsLeft.value = (mode.value === 'focus' ? focusMinutes.value : breakMinutes.value) * 60
  persist()
}

function applyPreset(focus: number, rest: number) {
  focusMinutes.value = focus
  breakMinutes.value = rest
  resetTimer()
}

function formatHistoryTime(iso: string) {
  const date = new Date(iso)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

async function toggleAudio() {
  const station = lofiStations.find(item => item.url === selectedStation.value)

  if (!station || station.type === 'external') {
    window.open(station?.url || selectedStation.value, '_blank', 'noopener,noreferrer')
    return
  }

  if (!audioRef.value) return

  if (audioPlaying.value) {
    audioRef.value.pause()
    audioPlaying.value = false
    return
  }

  try {
    await audioRef.value.play()
    audioPlaying.value = true
  } catch {
    audioPlaying.value = false
  }
}

watch([focusMinutes, breakMinutes], () => {
  focusMinutes.value = Math.min(180, Math.max(5, Number(focusMinutes.value) || 25))
  breakMinutes.value = Math.min(60, Math.max(1, Number(breakMinutes.value) || 5))

  if (!running.value) {
    secondsLeft.value = (mode.value === 'focus' ? focusMinutes.value : breakMinutes.value) * 60
  }

  persist()
})

watch(selectedStation, () => {
  if (audioRef.value) {
    audioRef.value.pause()
    audioPlaying.value = false
  }
  persist()
})

onMounted(async () => {
  getOrCreateUserId()

  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>
      focusMinutes.value = Math.min(180, Math.max(5, Number(data.focusMinutes ?? 25) || 25))
      breakMinutes.value = Math.min(60, Math.max(1, Number(data.breakMinutes ?? 5) || 5))
      mode.value = data.mode === 'break' ? 'break' : 'focus'
      secondsLeft.value = Math.max(0, Number(data.secondsLeft ?? focusMinutes.value * 60) || focusMinutes.value * 60)
      selectedStation.value = String(data.selectedStation ?? lofiStations[1].url)

      if (data.garden) {
        garden.value = sanitizeGardenState(data.garden)
      }

      if (Array.isArray(data.history)) {
        history.value = data.history
          .map(entry => sanitizeHistoryEntry(entry))
          .filter((entry): entry is HistoryEntry => entry !== null)
      }
    } catch {
      // Ignore malformed localStorage payloads and keep defaults.
    }
  }

  await ensureSupabaseTable()
  const supabaseState = await loadFromSupabase()
  if (supabaseState) {
    if (supabaseState.garden) garden.value = supabaseState.garden
    history.value = supabaseState.history
  }

  const resetApplied = syncDailyCounters()
  persist()

  if (resetApplied) {
    void syncGardenToSupabase()
  }
})

onBeforeUnmount(() => {
  stopTimer()
  if (audioRef.value) {
    audioRef.value.pause()
  }
})
</script>

<template>
  <NuxtRouteAnnouncer />
  <main class="app" :data-phase="dayPhase">
    <div class="ambient ambient-one" />
    <div class="ambient ambient-two" />

    <header class="topbar">
      <div class="brand-mark">
        <span class="brand-icon">🌿</span>
        <div>
          <p class="brand-title">Focus Garden</p>
          <p class="brand-subtitle">Cozy focus, one session at a time</p>
        </div>
      </div>
      <div class="live-pill">
        <span class="dot" :class="{ running }" />
        {{ running ? 'Session Running' : 'Ready to Bloom' }}
      </div>
    </header>

    <section class="workspace">
      <article class="panel timer-panel">
        <div class="mode-row">
          <button class="mode-chip" :class="{ active: mode === 'focus' }" @click="setMode('focus')">Focus</button>
          <button class="mode-chip" :class="{ active: mode === 'break' }" @click="setMode('break')">Break</button>
        </div>

        <h1>{{ modeTitle }}</h1>
        <p class="mode-hint">{{ modeHint }}</p>

        <div class="timer-shell">
          <div class="timer-ring" />
          <div class="timer-display">{{ mmss }}</div>
        </div>

        <div class="controls">
          <button class="btn btn-primary" @click="toggleTimer">{{ running ? 'Pause' : 'Start' }}</button>
          <button class="btn" @click="resetTimer">Reset</button>
          <button class="btn" @click="setMode(mode === 'focus' ? 'break' : 'focus')">Switch</button>
        </div>

        <div class="preset-row">
          <button class="chip" @click="applyPreset(25, 5)">25 / 5</button>
          <button class="chip" @click="applyPreset(50, 10)">50 / 10</button>
          <button class="chip" @click="applyPreset(90, 20)">90 / 20</button>
          <button class="chip" @click="showInputs = !showInputs">Custom</button>
        </div>

        <transition name="expand">
          <div v-if="showInputs" class="inputs">
            <label>
              Focus Minutes
              <input v-model.number="focusMinutes" type="number" min="5" max="180">
            </label>
            <label>
              Break Minutes
              <input v-model.number="breakMinutes" type="number" min="1" max="60">
            </label>
          </div>
        </transition>

        <div class="audio-box">
          <label for="station">Ambience</label>
          <select id="station" v-model="selectedStation">
            <option v-for="station in lofiStations" :key="station.url" :value="station.url">
              {{ station.name }}
            </option>
          </select>
          <button class="btn btn-audio" @click="toggleAudio">{{ audioPlaying ? 'Stop Audio' : 'Play Audio' }}</button>
          <audio ref="audioRef" :src="selectedStation" preload="none" loop />
        </div>
      </article>

      <article class="panel garden-panel">
        <div class="stats-ribbon">
          <div class="stat-card">
            <span class="stat-value">{{ garden.totalSessions }}</span>
            <span class="stat-label">Total Sessions</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{{ garden.sessionsToday }}</span>
            <span class="stat-label">Today</span>
          </div>
          <div class="stat-card">
            <span class="stat-value">{{ garden.streakDays }}</span>
            <span class="stat-label">Streak Days</span>
          </div>
        </div>

        <div class="progress-box">
          <div class="progress-labels">
            <span>Garden Stage {{ gardenStage }} / 4</span>
            <span>{{ progressToNext }}% to next stage</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" :style="{ width: `${progressToNext}%` }" />
          </div>
        </div>

        <div class="garden-canvas">
          <div class="sky" />
          <div class="sun" :class="dayPhase" />
          <div class="horizon" />
          <div class="ground" />

          <div class="fireflies">
            <span v-for="i in 8" :key="i" class="firefly" :style="{
              left: `${10 + i * 11}%`,
              animationDelay: `${i * 0.4}s`
            }" />
          </div>

          <div v-if="garden.totalSessions === 0" class="empty-garden">
            <div class="pot">🪴</div>
            <p>Start a focus session to grow your first bloom.</p>
          </div>

          <template v-else>
            <div
              v-for="plant in plants"
              :key="plant.id"
              class="plant"
              :class="{ fresh: newlyPlanted.includes(plant.id) }"
              :style="plant.style"
            >
              <div class="stem" :style="{ '--hue': plant.hue }" />
              <div class="bloom">{{ plant.emoji }}</div>
              <div class="plant-glow" :style="{ '--hue': plant.hue }" />
            </div>
          </template>

          <transition name="sparkle">
            <div v-if="showSparkle" class="sparkle-overlay">
              <span v-for="i in 24" :key="i" class="spark" :style="{
                left: `${(i * 17 + 12) % 100}%`,
                top: `${20 + (i * 13) % 60}%`,
                animationDelay: `${i * 0.04}s`
              }" />
            </div>
          </transition>
        </div>

        <div class="activity-box">
          <div class="activity-tabs">
            <button class="tab" :class="{ active: activeActivityTab === 'stats' }" @click="activeActivityTab = 'stats'">Stats</button>
            <button class="tab" :class="{ active: activeActivityTab === 'history' }" @click="activeActivityTab = 'history'">History</button>
          </div>

          <div v-if="activeActivityTab === 'stats'" class="stats-panel">
            <div class="mini-grid">
              <div class="mini-stat">
                <span>This Week</span>
                <strong>{{ weeklyStats.thisWeek }}</strong>
              </div>
              <div class="mini-stat">
                <span>Last Week</span>
                <strong>{{ weeklyStats.lastWeek }}</strong>
              </div>
              <div class="mini-stat">
                <span>This Month</span>
                <strong>{{ monthlyStats.thisMonth }}</strong>
              </div>
              <div class="mini-stat">
                <span>Last Month</span>
                <strong>{{ monthlyStats.lastMonth }}</strong>
              </div>
              <div class="mini-stat">
                <span>Best Streak</span>
                <strong>{{ bestStreakFromHistory }}</strong>
              </div>
              <div class="mini-stat">
                <span>Unlocked Plants</span>
                <strong>{{ unlockedPlants.length }}</strong>
              </div>
            </div>

            <div class="streak-chart">
              <p>Last 10 Days</p>
              <div class="streak-bars">
                <div v-for="day in streakHistory" :key="day.day" class="streak-day">
                  <div class="bar" :class="{ active: day.active }" :style="{ height: `${Math.max(16, day.count * 16)}px` }" />
                  <span>{{ day.day }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="history-panel">
            <p v-if="recentHistory.length === 0" class="history-empty">No sessions recorded yet.</p>
            <ul v-else class="history-list">
              <li v-for="entry in recentHistory" :key="entry.id" class="history-item">
                <span class="badge" :class="entry.sessionType">{{ entry.sessionType }}</span>
                <span class="duration">{{ entry.durationMinutes }} min</span>
                <span class="time">{{ formatHistoryTime(entry.completedAt) }}</span>
              </li>
            </ul>
          </div>
        </div>
      </article>
    </section>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Manrope:wght@400;500;600;700&display=swap');

:root {
  --cream-1: #fff3dd;
  --cream-2: #ffd9a7;
  --amber-1: #f6a13a;
  --amber-2: #d6721f;
  --earth-1: #7a421a;
  --earth-2: #4f2a12;
  --olive-1: #b2c57c;
  --leaf-1: #6f9148;
}

* {
  box-sizing: border-box;
}

.app {
  min-height: 100vh;
  padding: 1rem;
  color: #fff8ed;
  font-family: 'Manrope', 'Segoe UI', sans-serif;
  position: relative;
  overflow: hidden;
  background: radial-gradient(120% 120% at 20% 10%, #ffcb7f 0%, #f49a4d 36%, #9d4f1f 74%, #46210f 100%);
}

.app[data-phase='sunset'] {
  background: radial-gradient(130% 130% at 50% 0%, #ffd8a6 0%, #f4a65a 35%, #ad5f2b 68%, #4f2813 100%);
}

.app[data-phase='night'] {
  background: radial-gradient(130% 130% at 50% 0%, #f5bf87 0%, #a25d30 40%, #4f2a1a 70%, #2a1711 100%);
}

.ambient {
  position: absolute;
  border-radius: 999px;
  filter: blur(35px);
  pointer-events: none;
}

.ambient-one {
  width: 340px;
  height: 340px;
  top: -120px;
  left: -80px;
  background: rgba(255, 199, 122, 0.35);
  animation: drift-a 9s ease-in-out infinite;
}

.ambient-two {
  width: 420px;
  height: 420px;
  right: -120px;
  bottom: -180px;
  background: rgba(255, 144, 59, 0.26);
  animation: drift-b 11s ease-in-out infinite;
}

@keyframes drift-a {
  0%,
  100% { transform: translate(0, 0); }
  50% { transform: translate(22px, 12px); }
}

@keyframes drift-b {
  0%,
  100% { transform: translate(0, 0); }
  50% { transform: translate(-20px, -14px); }
}

.topbar {
  max-width: 1180px;
  margin: 0 auto 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  position: relative;
  z-index: 2;
}

.brand-mark {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.brand-icon {
  width: 46px;
  height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  border-radius: 14px;
  background: linear-gradient(145deg, rgba(255, 214, 151, 0.48), rgba(232, 137, 64, 0.28));
  border: 1px solid rgba(255, 240, 214, 0.36);
  box-shadow: 0 10px 24px rgba(69, 29, 8, 0.33);
}

.brand-title {
  margin: 0;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.28rem;
  letter-spacing: 0.2px;
}

.brand-subtitle {
  margin: 0.1rem 0 0;
  color: rgba(255, 242, 225, 0.84);
  font-size: 0.82rem;
}

.live-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.48rem 0.78rem;
  border-radius: 999px;
  font-size: 0.78rem;
  background: rgba(66, 31, 13, 0.4);
  border: 1px solid rgba(255, 216, 173, 0.38);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #ffc47b;
}

.dot.running {
  background: #ffe6a9;
  box-shadow: 0 0 12px rgba(255, 224, 135, 0.9);
  animation: pulse-dot 1.4s ease-in-out infinite;
}

@keyframes pulse-dot {
  0%,
  100% { transform: scale(1); opacity: 0.75; }
  50% { transform: scale(1.25); opacity: 1; }
}

.workspace {
  max-width: 1180px;
  margin: 0 auto;
  position: relative;
  z-index: 2;
  display: grid;
  gap: 1rem;
}

.panel {
  border-radius: 28px;
  border: 1px solid rgba(255, 220, 183, 0.2);
  background: linear-gradient(160deg, rgba(101, 51, 21, 0.53), rgba(53, 26, 13, 0.62));
  box-shadow: 0 18px 42px rgba(34, 13, 6, 0.35), inset 0 1px 0 rgba(255, 237, 206, 0.16);
  backdrop-filter: blur(8px);
}

.timer-panel {
  padding: 1.1rem;
}

.mode-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.95rem;
}

.mode-chip {
  border: none;
  border-radius: 999px;
  padding: 0.42rem 0.84rem;
  font-family: inherit;
  font-size: 0.78rem;
  color: #ffe9cb;
  background: rgba(255, 222, 183, 0.12);
  cursor: pointer;
  transition: 0.2s ease;
}

.mode-chip.active {
  background: linear-gradient(145deg, #ffbf62, #f08d3e);
  color: #3e1d0f;
  font-weight: 700;
}

h1 {
  margin: 0;
  font-family: 'Fraunces', Georgia, serif;
  font-size: clamp(1.8rem, 4.6vw, 2.4rem);
  line-height: 1.1;
}

.mode-hint {
  margin: 0.42rem 0 1rem;
  color: rgba(255, 237, 212, 0.88);
  font-size: 0.88rem;
}

.timer-shell {
  position: relative;
  margin: 0 auto 1rem;
  width: min(100%, 390px);
  border-radius: 28px;
  padding: 1.15rem 0.9rem;
  text-align: center;
  background: linear-gradient(175deg, rgba(255, 227, 188, 0.1), rgba(255, 159, 80, 0.05));
  border: 1px solid rgba(255, 227, 193, 0.24);
}

.timer-ring {
  position: absolute;
  inset: 0;
  border-radius: 28px;
  box-shadow: inset 0 0 24px rgba(255, 198, 125, 0.16), 0 0 34px rgba(255, 150, 68, 0.28);
  pointer-events: none;
}

.timer-display {
  position: relative;
  z-index: 1;
  font-family: 'Fraunces', Georgia, serif;
  font-size: clamp(3rem, 13vw, 5.4rem);
  letter-spacing: 2px;
  color: #fff5df;
  text-shadow: 0 0 22px rgba(255, 187, 102, 0.4), 0 8px 24px rgba(39, 15, 6, 0.45);
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  justify-content: center;
}

.btn,
.chip,
.tab {
  border: 1px solid rgba(255, 225, 180, 0.22);
  background: linear-gradient(145deg, rgba(255, 210, 159, 0.2), rgba(209, 115, 51, 0.18));
  color: #fff4e0;
  padding: 0.56rem 0.95rem;
  border-radius: 14px;
  font-family: inherit;
  font-weight: 600;
  font-size: 0.82rem;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
}

.btn:hover,
.chip:hover,
.tab:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 20px rgba(45, 18, 8, 0.28);
  filter: saturate(1.08);
}

.btn-primary {
  border: none;
  background: linear-gradient(145deg, #ffd27f 0%, #f49d47 45%, #df732a 100%);
  color: #3f1f10;
  font-weight: 800;
  box-shadow: 0 12px 24px rgba(217, 112, 38, 0.42);
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
  margin-top: 0.85rem;
}

.inputs {
  margin-top: 0.9rem;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.68rem;
}

label {
  display: grid;
  gap: 0.34rem;
  color: #ffeed7;
  font-size: 0.77rem;
}

input,
select {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(255, 216, 166, 0.28);
  padding: 0.58rem 0.66rem;
  color: #fff4e3;
  background: rgba(63, 29, 14, 0.56);
  font-family: inherit;
  font-size: 0.9rem;
}

input:focus,
select:focus {
  outline: none;
  border-color: rgba(255, 214, 134, 0.66);
  box-shadow: 0 0 0 2px rgba(255, 187, 95, 0.22);
}

.audio-box {
  margin-top: 0.92rem;
  display: grid;
  gap: 0.45rem;
}

.btn-audio {
  justify-self: start;
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.22s ease;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.garden-panel {
  padding: 1rem;
}

.stats-ribbon {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
}

.stat-card {
  border-radius: 16px;
  padding: 0.7rem 0.55rem;
  text-align: center;
  border: 1px solid rgba(255, 215, 171, 0.22);
  background: linear-gradient(155deg, rgba(255, 224, 181, 0.18), rgba(171, 87, 33, 0.2));
}

.stat-value {
  display: block;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.4rem;
  line-height: 1;
}

.stat-label {
  display: block;
  margin-top: 0.18rem;
  font-size: 0.68rem;
  color: rgba(255, 235, 208, 0.88);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.progress-box {
  margin-top: 0.8rem;
  border-radius: 16px;
  padding: 0.65rem 0.72rem;
  background: rgba(71, 31, 13, 0.5);
  border: 1px solid rgba(255, 219, 177, 0.16);
}

.progress-labels {
  display: flex;
  justify-content: space-between;
  gap: 0.6rem;
  font-size: 0.72rem;
  color: rgba(255, 239, 216, 0.9);
}

.progress-track {
  margin-top: 0.42rem;
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 232, 196, 0.14);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #ffd17f 0%, #f59d48 50%, #df712d 100%);
  transition: width 0.55s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 18px rgba(255, 187, 102, 0.5);
}

.garden-canvas {
  margin-top: 0.92rem;
  position: relative;
  height: 320px;
  border-radius: 24px;
  overflow: hidden;
  border: 1px solid rgba(255, 220, 184, 0.26);
  background: linear-gradient(180deg, rgba(255, 214, 158, 0.7) 0%, rgba(233, 134, 63, 0.72) 52%, rgba(108, 51, 22, 0.9) 100%);
}

.sky {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 50% 0%, rgba(255, 239, 203, 0.6) 0%, transparent 58%);
}

.sun {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  width: 58px;
  height: 58px;
  border-radius: 999px;
  box-shadow: 0 0 40px rgba(255, 193, 103, 0.7);
  background: radial-gradient(circle at 35% 35%, #fff7db, #ffc267 65%, #ed8e3b 100%);
  animation: sway-sun 7s ease-in-out infinite;
}

.sun.night {
  background: radial-gradient(circle at 35% 35%, #fff2cd, #e7b06f 65%, #b67644 100%);
  box-shadow: 0 0 30px rgba(241, 188, 122, 0.48);
}

@keyframes sway-sun {
  0%,
  100% { transform: translateX(-50%) translateY(0); }
  50% { transform: translateX(-50%) translateY(6px); }
}

.horizon {
  position: absolute;
  left: -8%;
  right: -8%;
  bottom: 78px;
  height: 110px;
  border-radius: 50%;
  background: linear-gradient(180deg, rgba(106, 55, 26, 0.26), rgba(72, 36, 17, 0.66));
}

.ground {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 98px;
  background: linear-gradient(180deg, #7c4622 0%, #5b3319 45%, #3a1f11 100%);
}

.fireflies {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.firefly {
  position: absolute;
  bottom: 70px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #ffe0a2;
  box-shadow: 0 0 10px rgba(255, 218, 148, 0.95);
  animation: float-firefly 5.2s ease-in-out infinite;
}

@keyframes float-firefly {
  0%,
  100% { transform: translate(0, 0); opacity: 0.3; }
  40% { transform: translate(10px, -26px); opacity: 1; }
  70% { transform: translate(-6px, -12px); opacity: 0.5; }
}

.empty-garden {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  text-align: center;
  color: rgba(255, 239, 216, 0.96);
  padding: 0 1rem;
}

.pot {
  font-size: 2.8rem;
  filter: drop-shadow(0 12px 18px rgba(44, 21, 10, 0.45));
  animation: bob 3.4s ease-in-out infinite;
}

@keyframes bob {
  0%,
  100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.plant {
  position: absolute;
  z-index: 3;
}

.plant.fresh {
  animation: pop-in 0.9s cubic-bezier(0.2, 1, 0.25, 1);
}

@keyframes pop-in {
  from { opacity: 0; transform: translateX(-50%) scale(0.35) translateY(18px); }
  to { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
}

.stem {
  margin: 0 auto;
  width: 4px;
  height: 38px;
  border-radius: 6px;
  background: linear-gradient(180deg, hsl(var(--hue), 62%, 45%), hsl(var(--hue), 45%, 31%));
  animation: sway 4s ease-in-out infinite;
  transform-origin: bottom center;
}

@keyframes sway {
  0%,
  100% { transform: rotate(-2.5deg); }
  50% { transform: rotate(2.5deg); }
}

.bloom {
  margin-top: -14px;
  font-size: 1.35rem;
  text-align: center;
  filter: drop-shadow(0 8px 8px rgba(44, 19, 8, 0.4));
}

.plant-glow {
  position: absolute;
  top: -12px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: radial-gradient(circle, hsla(var(--hue), 88%, 68%, 0.36) 0%, transparent 70%);
}

.sparkle-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.spark {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #fff5d5;
  box-shadow: 0 0 10px rgba(255, 239, 194, 0.95);
  animation: burst 1.2s ease-out forwards;
}

@keyframes burst {
  0% { opacity: 0; transform: translateY(0) scale(0.2); }
  40% { opacity: 1; transform: translateY(-16px) scale(1.2); }
  100% { opacity: 0; transform: translateY(-30px) scale(0.6); }
}

.sparkle-enter-active,
.sparkle-leave-active {
  transition: opacity 0.2s ease;
}

.sparkle-enter-from,
.sparkle-leave-to {
  opacity: 0;
}

.activity-box {
  margin-top: 0.9rem;
  border-radius: 18px;
  border: 1px solid rgba(255, 218, 172, 0.18);
  background: rgba(72, 34, 15, 0.52);
  padding: 0.75rem;
}

.activity-tabs {
  display: flex;
  gap: 0.45rem;
}

.tab.active {
  border-color: rgba(255, 218, 149, 0.7);
  background: linear-gradient(145deg, rgba(255, 204, 128, 0.3), rgba(208, 101, 40, 0.28));
}

.stats-panel {
  margin-top: 0.7rem;
}

.mini-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.45rem;
}

.mini-stat {
  border-radius: 12px;
  padding: 0.5rem 0.58rem;
  background: rgba(255, 220, 168, 0.12);
  border: 1px solid rgba(255, 222, 182, 0.18);
}

.mini-stat span {
  display: block;
  color: rgba(255, 235, 209, 0.86);
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.35px;
}

.mini-stat strong {
  display: block;
  margin-top: 0.16rem;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.14rem;
  line-height: 1;
}

.streak-chart {
  margin-top: 0.74rem;
}

.streak-chart p {
  margin: 0;
  font-size: 0.75rem;
  color: rgba(255, 240, 220, 0.88);
}

.streak-bars {
  margin-top: 0.45rem;
  display: grid;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  gap: 0.3rem;
  align-items: end;
}

.streak-day {
  display: grid;
  gap: 0.18rem;
  justify-items: center;
}

.streak-day span {
  font-size: 0.58rem;
  color: rgba(255, 230, 191, 0.78);
}

.bar {
  width: 100%;
  min-height: 16px;
  border-radius: 6px;
  background: rgba(255, 216, 166, 0.2);
}

.bar.active {
  background: linear-gradient(180deg, #ffd58c 0%, #f29a4a 100%);
}

.history-panel {
  margin-top: 0.66rem;
}

.history-empty {
  margin: 0;
  font-size: 0.85rem;
  color: rgba(255, 236, 211, 0.8);
}

.history-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.35rem;
}

.history-item {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.5rem;
  border-radius: 11px;
  border: 1px solid rgba(255, 219, 177, 0.2);
  background: rgba(255, 226, 186, 0.08);
}

.badge {
  text-transform: capitalize;
  border-radius: 999px;
  padding: 0.15rem 0.42rem;
  font-size: 0.64rem;
  font-weight: 700;
}

.badge.focus {
  color: #4a230f;
  background: rgba(255, 213, 136, 0.9);
}

.badge.break {
  color: #fff3dd;
  background: rgba(191, 111, 52, 0.8);
}

.duration {
  color: rgba(255, 240, 215, 0.94);
  font-weight: 600;
  font-size: 0.78rem;
}

.time {
  justify-self: end;
  color: rgba(255, 228, 196, 0.74);
  font-size: 0.72rem;
}

@media (max-width: 639px) {
  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }
}

@media (min-width: 640px) {
  .app {
    padding: 1.4rem;
  }

  .timer-panel,
  .garden-panel {
    padding: 1.2rem;
  }

  .timer-shell {
    padding: 1.6rem 1rem;
  }

  .btn,
  .chip,
  .tab {
    padding: 0.64rem 1.05rem;
    font-size: 0.86rem;
  }

  .inputs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 980px) {
  .workspace {
    grid-template-columns: minmax(320px, 0.9fr) minmax(540px, 1.35fr);
    align-items: start;
  }

  .timer-panel {
    position: sticky;
    top: 1rem;
  }

  .garden-canvas {
    height: 370px;
  }

  .stat-card {
    padding: 0.8rem 0.6rem;
  }

  .stat-value {
    font-size: 1.7rem;
  }

  .progress-labels {
    font-size: 0.78rem;
  }

  .history-item {
    padding: 0.5rem 0.6rem;
  }
}
</style>
