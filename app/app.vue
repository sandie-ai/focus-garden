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
    <header class="topbar pixel-panel">
      <div class="brand">
        <span class="brand-icon">[ ]</span>
        <div>
          <p class="brand-title">FOCUS GARDEN</p>
          <p class="brand-subtitle">cozy retro focus sim</p>
        </div>
      </div>
      <div class="status-box" :class="{ running }">
        <span class="status-led" />
        <span>{{ running ? 'session active' : 'waiting at camp' }}</span>
      </div>
    </header>

    <section class="workspace">
      <article class="pixel-panel timer-panel">
        <div class="mode-row">
          <button class="pixel-btn mode-btn" :class="{ active: mode === 'focus' }" @click="setMode('focus')">FOCUS</button>
          <button class="pixel-btn mode-btn" :class="{ active: mode === 'break' }" @click="setMode('break')">BREAK</button>
        </div>

        <h1>{{ modeTitle }}</h1>
        <p class="mode-hint">{{ modeHint }}</p>

        <div
          class="timer-shell pixel-frame"
          :class="{ 'timer-complete': history[0]?.sessionType === 'focus' && mode === 'break' && !running }"
        >
          <p class="timer-display">{{ mmss }}</p>
          <div class="timer-track pixel-frame-inset">
            <div
              class="timer-fill"
              :style="{
                width: `${Math.max(
                  0,
                  Math.min(
                    100,
                    Math.round((((mode === 'focus' ? focusMinutes : breakMinutes) * 60 - secondsLeft) / Math.max(1, (mode === 'focus' ? focusMinutes : breakMinutes) * 60)) * 100)
                  )
                )}%`,
              }"
            />
          </div>
        </div>

        <div class="controls">
          <button class="pixel-btn primary" @click="toggleTimer">{{ running ? 'PAUSE' : 'START' }}</button>
          <button class="pixel-btn" @click="resetTimer">RESET</button>
          <button class="pixel-btn" @click="setMode(mode === 'focus' ? 'break' : 'focus')">SWITCH</button>
        </div>

        <div class="preset-row">
          <button class="pixel-btn small" @click="applyPreset(25, 5)">25/5</button>
          <button class="pixel-btn small" @click="applyPreset(50, 10)">50/10</button>
          <button class="pixel-btn small" @click="applyPreset(90, 20)">90/20</button>
          <button class="pixel-btn small" @click="showInputs = !showInputs">CUSTOM</button>
        </div>

        <transition name="drop">
          <div v-if="showInputs" class="inputs pixel-frame">
            <label>
              Focus Min
              <input v-model.number="focusMinutes" type="number" min="5" max="180">
            </label>
            <label>
              Break Min
              <input v-model.number="breakMinutes" type="number" min="1" max="60">
            </label>
          </div>
        </transition>

        <div class="audio-box pixel-frame">
          <label for="station">RADIO</label>
          <select id="station" v-model="selectedStation">
            <option v-for="station in lofiStations" :key="station.url" :value="station.url">
              {{ station.name }}
            </option>
          </select>
          <button class="pixel-btn primary" @click="toggleAudio">{{ audioPlaying ? 'STOP AUDIO' : 'PLAY AUDIO' }}</button>
          <audio ref="audioRef" :src="selectedStation" preload="none" loop />
        </div>
      </article>

      <article class="pixel-panel garden-panel">
        <div class="stats-ribbon">
          <div class="stat-card pixel-frame">
            <span class="label">TOTAL</span>
            <strong :key="`total-${garden.totalSessions}`">{{ garden.totalSessions }}</strong>
          </div>
          <div class="stat-card pixel-frame">
            <span class="label">TODAY</span>
            <strong :key="`today-${garden.sessionsToday}`">{{ garden.sessionsToday }}</strong>
          </div>
          <div class="stat-card pixel-frame">
            <span class="label">STREAK</span>
            <strong :key="`streak-${garden.streakDays}`">{{ garden.streakDays }}</strong>
          </div>
        </div>

        <div class="progress-box pixel-frame">
          <div class="progress-head">
            <span>Stage {{ gardenStage }}/4</span>
            <span>{{ progressToNext }}%</span>
          </div>
          <div class="progress-track pixel-frame-inset">
            <div class="progress-fill" :style="{ width: `${progressToNext}%` }" />
          </div>
        </div>

        <div
          class="garden-canvas pixel-frame"
          :class="{
            'session-boom': history[0]?.sessionType === 'focus' && mode === 'break' && !running,
            'growth-glow': showSparkle,
          }"
        >
          <div class="sky" />
          <div class="sun-glow" />
          <div class="sun" />
          <div class="haze haze-a" />
          <div class="haze haze-b" />
          <div class="cloud cloud-a" />
          <div class="cloud cloud-b" />
          <div class="birds">
            <span v-for="i in 7" :key="`b-${i}`" class="bird" :style="{ left: `${12 + i * 11}%`, top: `${10 + (i * 7) % 22}%`, animationDelay: `${i * 0.4}s` }" />
          </div>
          <div class="butterflies">
            <span v-for="i in 4" :key="`butterfly-${i}`" class="butterfly" :style="{ animationDelay: `${i * 4.8}s` }" />
          </div>
          <div class="horizon" />
          <div class="ground" />
          <div class="path" />
          <div class="fence">
            <span v-for="i in 10" :key="`fence-${i}`" class="fence-post" :style="{ left: `${4 + i * 10}%` }" />
          </div>
          <div class="grass-layer">
            <span v-for="i in 28" :key="`grass-${i}`" class="grass-tuft" :style="{ left: `${(i * 9 + 7) % 100}%`, animationDelay: `${i * 0.08}s` }" />
          </div>

          <div
            class="pixel-cat"
            :class="{
              sleepy: mode === 'break',
              happy: history[0]?.sessionType === 'focus' && mode === 'break' && !running,
            }"
          >
            <div class="cat-shadow" />
            <div class="cat-tail" />
            <div class="cat-body">
              <div class="cat-ear ear-left" />
              <div class="cat-ear ear-right" />
              <div class="cat-face">
                <span class="cat-eye eye-left" />
                <span class="cat-eye eye-right" />
                <span class="cat-mouth" />
              </div>
              <div class="cat-paw paw-left" />
              <div class="cat-paw paw-right" />
            </div>
          </div>

          <div v-if="garden.totalSessions === 0" class="empty-garden pixel-frame">
            <p>PRESS START TO PLANT YOUR FIRST SPROUT.</p>
          </div>

          <template v-else>
            <div
              v-for="plant in plants"
              :key="plant.id"
              class="plant"
              :class="{ fresh: newlyPlanted.includes(plant.id) }"
              :style="plant.style"
            >
              <div class="plant-body">
                <div class="stem" :style="{ '--hue': plant.hue }" />
                <div class="leaf leaf-left" :style="{ '--hue': plant.hue }" />
                <div class="leaf leaf-right" :style="{ '--hue': plant.hue }" />
                <div class="flower-core" />
                <div class="petal p1" :style="{ '--hue': plant.hue }" />
                <div class="petal p2" :style="{ '--hue': plant.hue }" />
                <div class="petal p3" :style="{ '--hue': plant.hue }" />
                <div class="petal p4" :style="{ '--hue': plant.hue }" />
              </div>
            </div>
          </template>

          <div
            v-if="history.length > 0"
            :key="`confetti-${history[0].id}`"
            class="confetti-overlay"
            :class="{ show: history[0].sessionType === 'focus' }"
          >
            <span
              v-for="i in 34"
              :key="`c-${i}`"
              class="confetti-piece"
              :style="{
                left: `${48 + ((i % 2 === 0 ? -1 : 1) * ((i * 7) % 44))}%`,
                top: `${48 + ((i * 3) % 16)}%`,
                '--drift': `${(i * 9) % 72}`,
                animationDelay: `${i * 0.018}s`,
              }"
            />
          </div>

          <transition name="sparkle">
            <div v-if="showSparkle" class="sparkle-overlay">
              <span
                v-for="i in 52"
                :key="`p-${i}`"
                class="spark"
                :style="{ left: `${(i * 19 + 12) % 100}%`, top: `${16 + (i * 13) % 62}%`, animationDelay: `${i * 0.016}s` }"
              />
            </div>
          </transition>
        </div>

        <div class="activity-box pixel-frame">
          <div class="activity-tabs">
            <button class="pixel-btn small" :class="{ active: activeActivityTab === 'stats' }" @click="activeActivityTab = 'stats'">STATS</button>
            <button class="pixel-btn small" :class="{ active: activeActivityTab === 'history' }" @click="activeActivityTab = 'history'">HISTORY</button>
          </div>

          <div v-if="activeActivityTab === 'stats'" class="stats-panel">
            <div class="mini-grid">
              <div class="mini-stat pixel-frame"><span>This Week</span><strong>{{ weeklyStats.thisWeek }}</strong></div>
              <div class="mini-stat pixel-frame"><span>Last Week</span><strong>{{ weeklyStats.lastWeek }}</strong></div>
              <div class="mini-stat pixel-frame"><span>This Month</span><strong>{{ monthlyStats.thisMonth }}</strong></div>
              <div class="mini-stat pixel-frame"><span>Last Month</span><strong>{{ monthlyStats.lastMonth }}</strong></div>
              <div class="mini-stat pixel-frame"><span>Best Streak</span><strong>{{ bestStreakFromHistory }}</strong></div>
              <div class="mini-stat pixel-frame"><span>Unlocked</span><strong>{{ unlockedPlants.length }}</strong></div>
            </div>

            <div class="streak-chart pixel-frame">
              <p>LAST 10 DAYS</p>
              <div class="streak-bars">
                <div v-for="day in streakHistory" :key="day.day" class="streak-day">
                  <div class="bar" :class="{ active: day.active }" :style="{ height: `${Math.max(12, day.count * 12)}px` }" />
                  <span>{{ day.day }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="history-panel">
            <p v-if="recentHistory.length === 0" class="history-empty">NO SESSIONS YET.</p>
            <ul v-else class="history-list">
              <li v-for="entry in recentHistory" :key="entry.id" class="history-item pixel-frame">
                <span class="pixel-check" :class="{ checked: entry.sessionType === 'focus' }" />
                <span class="badge" :class="entry.sessionType">{{ entry.sessionType }}</span>
                <span class="duration">{{ entry.durationMinutes }} MIN</span>
                <span class="time">{{ formatHistoryTime(entry.completedAt) }}</span>
              </li>
            </ul>
          </div>
        </div>
      </article>
    </section>
  </main>
</template>

<style>
html,
body,
#__nuxt {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  min-height: 100%;
}

#__nuxt {
  min-height: 100vh;
}

body {
  background: linear-gradient(180deg, #ff8fa3 0%, #ff6b6b 35%, #fec89a 70%, #ffd93d 100%);
}
</style>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap');

:root {
  --warm-dark: #2d2a4a;
  --warm-dark-2: #3d3a5c;
  --coral-0: #ff6b6b;
  --coral-1: #e85d75;
  --terracotta: #f4a261;
  --gold: #ffd93d;
  --gold-2: #ffbe3d;
  --pink: #ff8fa3;
  --soft-purple: #b8a9c9;
  --green-0: #4ade80;
  --green-1: #22c55e;
  --green-2: #86efac;
  --cream: #fff5db;
  --ink: #1d1734;
  --ink-soft: #3a3157;
}

* {
  box-sizing: border-box;
  image-rendering: pixelated;
}

.app {
  min-height: 100vh;
  padding: 14px;
  color: var(--ink);
  font-family: 'VT323', 'Courier New', monospace;
  background:
    radial-gradient(circle at 20% -10%, #ffd66d 0%, rgba(255, 214, 109, 0) 38%),
    linear-gradient(180deg, #ff8fa3 0%, #ff6b6b 28%, #fec89a 58%, #ffd93d 100%);
  position: relative;
  overflow: hidden;
}

.app::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to bottom, transparent 96%, rgba(45, 42, 74, 0.08) 96%),
    linear-gradient(to right, transparent 96%, rgba(45, 42, 74, 0.08) 96%);
  background-size: 4px 4px;
}

.topbar,
.workspace,
.timer-panel,
.garden-panel {
  position: relative;
  z-index: 1;
}

.pixel-panel {
  border: 3px solid var(--warm-dark);
  background: linear-gradient(180deg, #ffd7ac 0%, #f4a261 100%);
  box-shadow: 4px 4px 0 var(--warm-dark);
}

.pixel-frame {
  border: 2px solid var(--warm-dark);
  background: #ffe5c6;
  box-shadow: inset -2px -2px 0 rgba(45, 42, 74, 0.25), inset 2px 2px 0 rgba(255, 255, 255, 0.4);
}

.pixel-frame-inset {
  border: 2px solid var(--warm-dark);
  background: #fff0dc;
  box-shadow: inset 2px 2px 0 rgba(255, 255, 255, 0.55);
}

.topbar {
  max-width: 1200px;
  margin: 0 auto 12px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  font-family: 'Press Start 2P', monospace;
  color: var(--warm-dark);
  font-size: 14px;
}

.brand-title {
  margin: 0;
  font-family: 'Press Start 2P', monospace;
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--warm-dark);
}

.brand-subtitle {
  margin: 4px 0 0;
  font-size: 24px;
  color: var(--ink-soft);
}

.status-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 2px solid var(--warm-dark);
  background: #ffddb2;
  font-size: 22px;
  text-transform: uppercase;
  color: var(--ink);
}

.status-led {
  width: 10px;
  height: 10px;
  background: #9f92b0;
}

.status-box.running .status-led {
  background: var(--gold);
  animation: blink 1s steps(2) infinite;
}

.workspace {
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 360px 1fr;
  gap: 12px;
}

.timer-panel,
.garden-panel {
  padding: 12px;
}

h1 {
  margin: 8px 0 4px;
  font-family: 'Press Start 2P', monospace;
  font-size: 16px;
  line-height: 1.4;
  color: var(--warm-dark);
}

.mode-hint {
  margin: 0 0 10px;
  font-size: 24px;
  color: var(--ink-soft);
}

.mode-row,
.controls,
.preset-row,
.activity-tabs {
  display: grid;
  gap: 8px;
}

.mode-row,
.controls {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.controls {
  margin-top: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.preset-row {
  margin-top: 8px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.pixel-btn {
  border: 2px solid var(--warm-dark);
  background: linear-gradient(180deg, #ff8fa3 0%, #e85d75 100%);
  color: #fff8ef;
  padding: 8px 6px;
  font-family: 'Press Start 2P', monospace;
  font-size: 10px;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 2px 2px 0 var(--warm-dark);
  transition: transform 0.12s steps(2), box-shadow 0.12s steps(2), filter 0.12s steps(2);
}

.pixel-btn:hover {
  background: linear-gradient(180deg, #ffa3b2 0%, #ff6b6b 100%);
  filter: saturate(1.08);
}

.pixel-btn:active {
  transform: translate(1px, 1px) scale(0.92, 0.82);
  box-shadow: 1px 1px 0 var(--warm-dark);
}

.pixel-btn.active,
.pixel-btn.primary,
.mode-btn.active {
  background: linear-gradient(180deg, #ffd93d 0%, #ffbe3d 100%);
  color: var(--ink);
  border-color: var(--warm-dark);
}

.pixel-btn.small {
  font-size: 9px;
  padding: 7px 4px;
}

.timer-shell {
  margin-top: 8px;
  padding: 12px;
  position: relative;
}

.timer-shell::after {
  content: '';
  position: absolute;
  inset: 2px;
  pointer-events: none;
  opacity: 0;
}

.timer-shell.timer-complete::after {
  animation: timer-flash 0.65s steps(5);
}

.timer-display {
  margin: 0;
  font-family: 'Press Start 2P', monospace;
  font-size: clamp(26px, 5vw, 44px);
  line-height: 1;
  text-align: center;
  color: var(--warm-dark);
  text-shadow: 2px 0 0 #ffe58e;
}

.timer-track,
.progress-track {
  margin-top: 10px;
  height: 16px;
  overflow: hidden;
}

.timer-fill,
.progress-fill {
  height: 100%;
  background: repeating-linear-gradient(90deg, var(--gold) 0 8px, #ff8fa3 8px 16px);
  position: relative;
  overflow: hidden;
}

.timer-fill::after,
.progress-fill::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 30%;
  background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.68) 50%, transparent 100%);
  animation: shine 2.6s steps(20) infinite;
}

.inputs,
.audio-box,
.progress-box,
.activity-box {
  margin-top: 10px;
  padding: 10px;
}

.inputs {
  display: grid;
  gap: 8px;
}

label {
  display: grid;
  gap: 4px;
  font-size: 22px;
}

input,
select {
  width: 100%;
  border: 2px solid var(--warm-dark);
  background: #fff8ee;
  color: var(--ink);
  padding: 6px;
  border-radius: 0;
  font-family: 'VT323', monospace;
  font-size: 24px;
}

.stats-ribbon {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.stat-card {
  padding: 8px;
  text-align: center;
}

.stat-card .label {
  display: block;
  font-size: 18px;
  color: var(--ink-soft);
}

.stat-card strong {
  font-family: 'Press Start 2P', monospace;
  font-size: 16px;
  color: var(--warm-dark);
  display: inline-block;
  animation: stat-pop 0.38s steps(3);
}

.progress-head {
  display: flex;
  justify-content: space-between;
  font-family: 'Press Start 2P', monospace;
  font-size: 9px;
}

.garden-canvas {
  margin-top: 10px;
  min-height: 300px;
  position: relative;
  overflow: hidden;
  background: #ffba8a;
  transform-origin: center;
}

.garden-canvas::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 23% 68%, rgba(255, 236, 159, 0.12) 0%, transparent 26%),
    radial-gradient(circle at 76% 64%, rgba(255, 236, 159, 0.09) 0%, transparent 28%);
}

.garden-canvas::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
}

.garden-canvas.growth-glow::after {
  animation: growth-pulse 1.2s steps(8) 1;
}

.garden-canvas.session-boom {
  animation: screen-shake 0.52s steps(5) 1;
}

.sky,
.horizon,
.ground {
  position: absolute;
  left: 0;
  right: 0;
}

.sky {
  top: 0;
  bottom: 35%;
  background: linear-gradient(180deg, #b8a9c9 0%, #ff8fa3 30%, #ff6b6b 58%, #fec89a 82%, #ffd93d 100%);
}

.sun-glow {
  position: absolute;
  width: 170px;
  height: 170px;
  right: 7%;
  top: 8%;
  background: radial-gradient(circle, rgba(255, 217, 61, 0.8) 0%, rgba(255, 217, 61, 0) 72%);
}

.sun {
  position: absolute;
  right: 13%;
  top: 16%;
  width: 44px;
  height: 44px;
  background: #ffd93d;
  box-shadow: 3px 3px 0 #ff8fa3;
}

.haze {
  position: absolute;
  height: 6px;
  background: rgba(255, 248, 209, 0.55);
}

.haze-a {
  left: 8%;
  right: 14%;
  top: 40%;
}

.haze-b {
  left: 15%;
  right: 24%;
  top: 48%;
}

.horizon {
  bottom: 34%;
  height: 7%;
  background: linear-gradient(180deg, rgba(255, 160, 108, 0.2) 0%, rgba(255, 143, 163, 0.6) 100%);
}

.ground {
  bottom: 0;
  height: 35%;
  background:
    linear-gradient(180deg, rgba(157, 250, 185, 0.6) 0%, rgba(74, 222, 128, 0) 32%),
    repeating-linear-gradient(90deg, var(--green-1) 0 16px, var(--green-0) 16px 32px);
  border-top: 3px solid var(--green-2);
}

.ground::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(to right, rgba(16, 99, 61, 0.2) 0 2px, transparent 2px 12px),
    linear-gradient(to bottom, rgba(16, 99, 61, 0.15) 0 2px, transparent 2px 10px);
  opacity: 0.3;
}

.cloud {
  position: absolute;
  width: 50px;
  height: 14px;
  background: #fff3da;
  box-shadow: 2px 2px 0 #ff8fa3;
}

.cloud::before,
.cloud::after {
  content: '';
  position: absolute;
  width: 14px;
  height: 14px;
  background: #fff3da;
}

.cloud::before {
  left: -10px;
  top: -4px;
}

.cloud::after {
  right: -10px;
  top: 4px;
}

.cloud-a {
  left: 10%;
  top: 17%;
  animation: drift 16s steps(40) infinite;
}

.cloud-b {
  left: 64%;
  top: 27%;
  animation: drift 22s steps(44) infinite reverse;
}

.birds {
  position: absolute;
  inset: 0;
}

.bird {
  position: absolute;
  width: 14px;
  height: 6px;
  border-top: 2px solid #4f4367;
  filter: drop-shadow(0 1px 0 rgba(255, 245, 219, 0.6));
  border-radius: 50%;
  transform: scaleX(1.15);
  animation: glide 4.8s steps(24) infinite;
}

.butterflies {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.butterfly {
  position: absolute;
  left: -9%;
  top: 44%;
  width: 10px;
  height: 8px;
  background:
    linear-gradient(90deg, #ffe580 0 44%, #ff8fa3 44% 56%, #ffe580 56% 100%);
  box-shadow: 0 0 0 2px #e85d75;
  transform-origin: center;
  animation: butterfly-fly 13s steps(80) infinite;
}

.butterfly::before,
.butterfly::after {
  content: '';
  position: absolute;
  width: 4px;
  height: 2px;
  background: #ffefc2;
  top: -2px;
}

.butterfly::before { left: 0; }
.butterfly::after { right: 0; }

.path {
  position: absolute;
  left: 40%;
  bottom: 0;
  width: 18%;
  height: 26%;
  background:
    linear-gradient(to right, rgba(93, 73, 42, 0.24) 0 2px, transparent 2px 9px),
    repeating-linear-gradient(180deg, #e6b980 0 8px, #cf995d 8px 16px);
  box-shadow: inset 2px 0 0 rgba(255, 240, 210, 0.25), inset -2px 0 0 rgba(93, 73, 42, 0.24);
}

.fence {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 28%;
  height: 24px;
  pointer-events: none;
}

.fence::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 13px;
  height: 4px;
  background: #c9894a;
  box-shadow: 0 3px 0 #8f5e31;
}

.fence-post {
  position: absolute;
  top: 1px;
  width: 6px;
  height: 20px;
  background: #d59f63;
  border-top: 2px solid #f7d2a6;
  box-shadow: 2px 2px 0 #8f5e31;
}

.grass-layer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 28%;
  height: 32px;
  pointer-events: none;
}

.grass-tuft {
  position: absolute;
  bottom: 0;
  width: 7px;
  height: 12px;
  background: linear-gradient(180deg, #9ef08f 0%, #3ab15f 100%);
  clip-path: polygon(50% 0%, 0% 100%, 30% 70%, 50% 100%, 70% 70%, 100% 100%);
  animation: grass-dance 3.2s steps(3) infinite;
}

.pixel-cat {
  position: absolute;
  right: 16%;
  bottom: 29%;
  width: 40px;
  height: 34px;
  z-index: 4;
  transform-origin: bottom center;
  animation: cat-stretch 7.8s steps(10) infinite;
}

.cat-shadow {
  position: absolute;
  left: 8px;
  bottom: 0;
  width: 26px;
  height: 6px;
  background: rgba(45, 42, 74, 0.35);
}

.cat-tail {
  position: absolute;
  left: 28px;
  bottom: 10px;
  width: 14px;
  height: 8px;
  border-top: 4px solid #6f5678;
  border-right: 2px solid #6f5678;
  transform-origin: left bottom;
  animation: tail-wiggle 2.2s steps(4) infinite;
}

.cat-body {
  position: absolute;
  left: 6px;
  bottom: 4px;
  width: 24px;
  height: 20px;
  background: #c6a18b;
  box-shadow: inset 2px 2px 0 rgba(255, 234, 213, 0.55), 2px 2px 0 #6f5678;
}

.cat-ear {
  position: absolute;
  top: -6px;
  width: 8px;
  height: 8px;
  background: #b88d74;
}

.ear-left { left: 0; clip-path: polygon(0 100%, 100% 100%, 0 0); }
.ear-right { right: 0; clip-path: polygon(0 100%, 100% 100%, 100% 0); }

.cat-face {
  position: absolute;
  left: 4px;
  top: 6px;
  width: 16px;
  height: 10px;
}

.cat-eye {
  position: absolute;
  width: 3px;
  height: 3px;
  background: #2d2a4a;
  animation: cat-blink 4s steps(2) infinite;
}

.eye-left { left: 1px; }
.eye-right { right: 1px; }

.cat-mouth {
  position: absolute;
  left: 6px;
  top: 5px;
  width: 4px;
  height: 2px;
  border-bottom: 2px solid #7d4f43;
}

.cat-paw {
  position: absolute;
  bottom: -4px;
  width: 7px;
  height: 5px;
  background: #a97e69;
}

.paw-left { left: 3px; }
.paw-right { right: 3px; }

.pixel-cat.sleepy .cat-eye {
  height: 1px;
  top: 1px;
  animation: none;
}

.pixel-cat.sleepy .cat-mouth {
  border-bottom-color: #9a6a5e;
}

.pixel-cat.happy {
  animation: cat-jump 0.75s steps(5) 1;
}

.pixel-cat.happy .cat-mouth {
  border-bottom-color: #ffef99;
  border-bottom-width: 3px;
}

.empty-garden {
  position: absolute;
  left: 50%;
  top: 56%;
  transform: translate(-50%, -50%);
  max-width: 280px;
  padding: 8px;
  text-align: center;
  font-family: 'Press Start 2P', monospace;
  font-size: 9px;
  line-height: 1.6;
}

.plant {
  position: absolute;
  width: 22px;
  height: 48px;
  transform-origin: bottom center;
}

.plant-body {
  position: relative;
  width: 100%;
  height: 100%;
  transform-origin: bottom center;
  animation: sway 3.4s steps(4) infinite;
}

.plant:nth-child(odd) .plant-body {
  animation-duration: 4.1s;
}

.plant:nth-child(3n) .plant-body {
  animation-duration: 2.9s;
}

.stem {
  position: absolute;
  left: 9px;
  bottom: 2px;
  width: 4px;
  height: 28px;
  background: hsl(var(--hue), 60%, 42%);
}

.leaf {
  position: absolute;
  width: 7px;
  height: 7px;
  bottom: 16px;
  background: hsl(var(--hue), 65%, 48%);
}

.leaf-left {
  left: 2px;
}

.leaf-right {
  right: 2px;
}

.flower-core {
  position: absolute;
  left: 8px;
  top: 2px;
  width: 6px;
  height: 6px;
  background: #fff2a7;
}

.petal {
  position: absolute;
  width: 6px;
  height: 6px;
  background: hsl(var(--hue), 75%, 62%);
}

.p1 { left: 8px; top: -4px; }
.p2 { left: 2px; top: 2px; }
.p3 { left: 14px; top: 2px; }
.p4 { left: 8px; top: 8px; }

.fresh {
  animation: pop 0.45s steps(4) 3;
  filter: drop-shadow(0 0 4px rgba(255, 255, 190, 0.85));
}

.fresh .plant-body {
  animation: new-plant-glow 1.15s steps(6) 2, sway 3.2s steps(4) infinite;
}

.sparkle-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 6;
}

.spark {
  position: absolute;
  width: 5px;
  height: 5px;
  background: #ffef99;
  box-shadow: 0 0 0 2px rgba(255, 239, 153, 0.5);
  animation: spark 0.95s steps(4) forwards;
}

.confetti-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 7;
}

.confetti-overlay.show .confetti-piece {
  animation: confetti 1.25s steps(14) forwards;
}

.confetti-piece {
  position: absolute;
  width: 5px;
  height: 9px;
  background: #fff5db;
}

.confetti-piece:nth-child(4n) {
  background: #ff8fa3;
}

.confetti-piece:nth-child(4n + 1) {
  background: #ffd93d;
}

.confetti-piece:nth-child(4n + 2) {
  background: #86efac;
}

.activity-tabs {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 8px;
}

.mini-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.mini-stat {
  padding: 8px;
  display: grid;
  gap: 4px;
}

.mini-stat span {
  font-size: 20px;
  color: var(--ink-soft);
}

.mini-stat strong {
  font-family: 'Press Start 2P', monospace;
  font-size: 11px;
}

.streak-chart {
  margin-top: 8px;
  padding: 8px;
}

.streak-chart p {
  margin: 0 0 8px;
  font-family: 'Press Start 2P', monospace;
  font-size: 9px;
}

.streak-bars {
  display: grid;
  gap: 6px;
  grid-template-columns: repeat(10, minmax(0, 1fr));
  align-items: end;
}

.streak-day {
  display: grid;
  justify-items: center;
  gap: 3px;
  font-size: 14px;
}

.bar {
  width: 100%;
  min-height: 12px;
  background: #d7c5b5;
  border: 2px solid var(--warm-dark);
}

.bar.active {
  background: linear-gradient(180deg, var(--green-0) 0%, var(--green-1) 100%);
}

.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.history-item {
  display: grid;
  grid-template-columns: 12px auto auto 1fr;
  align-items: center;
  gap: 8px;
  padding: 7px;
}

.pixel-check {
  width: 10px;
  height: 10px;
  border: 2px solid var(--warm-dark);
  background: #ffe9cf;
}

.pixel-check.checked {
  background: var(--green-0);
}

.badge {
  padding: 2px 6px;
  border: 2px solid var(--warm-dark);
  font-family: 'Press Start 2P', monospace;
  font-size: 8px;
  text-transform: uppercase;
}

.badge.focus {
  background: #ddffe8;
  color: #0f5132;
}

.badge.break {
  background: #fff0bf;
  color: #5f3a0a;
}

.duration,
.time,
.history-empty {
  font-size: 20px;
}

.time {
  justify-self: end;
  color: var(--ink-soft);
}

@keyframes blink {
  50% { opacity: 0.35; }
}

@keyframes glide {
  0%, 100% { transform: translateY(0) scaleX(1.15); opacity: 0.78; }
  50% { transform: translateY(-3px) scaleX(1.15); opacity: 1; }
}

@keyframes pop {
  0% { transform: translateX(-50%) scale(0.7); }
  100% { transform: translateX(-50%) scale(1); }
}

@keyframes spark {
  0% { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: translateY(-20px) scale(0); }
}

@keyframes drift {
  0% { transform: translateX(0); }
  50% { transform: translateX(14px); }
  100% { transform: translateX(0); }
}

@keyframes shine {
  0% { transform: translateX(-130%); }
  100% { transform: translateX(420%); }
}

@keyframes timer-flash {
  0% { opacity: 0.95; background: rgba(255, 255, 224, 0.7); }
  100% { opacity: 0; background: rgba(255, 255, 224, 0); }
}

@keyframes stat-pop {
  0% { transform: scale(0.8); }
  70% { transform: scale(1.14); }
  100% { transform: scale(1); }
}

@keyframes sway {
  0%, 100% { transform: rotate(-2deg); }
  50% { transform: rotate(3deg); }
}

@keyframes new-plant-glow {
  0% { filter: drop-shadow(0 0 0 rgba(255, 255, 160, 0)); }
  50% { filter: drop-shadow(0 0 9px rgba(255, 255, 160, 0.95)); }
  100% { filter: drop-shadow(0 0 0 rgba(255, 255, 160, 0)); }
}

@keyframes growth-pulse {
  0% { opacity: 0; }
  35% { opacity: 0.75; background: radial-gradient(circle at center, rgba(255, 254, 178, 0.35) 0%, transparent 65%); }
  100% { opacity: 0; }
}

@keyframes confetti {
  0% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
  100% { transform: translate(calc((var(--drift, 16) * 1px) - 36px), 120px) rotate(280deg); opacity: 0; }
}

@keyframes screen-shake {
  0%, 100% { transform: translate(0, 0); }
  20% { transform: translate(-3px, 1px); }
  40% { transform: translate(3px, -1px); }
  60% { transform: translate(-2px, -1px); }
  80% { transform: translate(2px, 1px); }
}

@keyframes butterfly-fly {
  0% { transform: translateX(0) translateY(0); opacity: 0; }
  8% { opacity: 1; }
  22% { transform: translateX(120px) translateY(-22px); }
  44% { transform: translateX(260px) translateY(16px); }
  68% { transform: translateX(390px) translateY(-18px); }
  88% { opacity: 1; }
  100% { transform: translateX(560px) translateY(8px); opacity: 0; }
}

@keyframes grass-dance {
  0%, 100% { transform: translateX(0) rotate(-4deg); }
  50% { transform: translateX(1px) rotate(4deg); }
}

@keyframes tail-wiggle {
  0%, 100% { transform: rotate(12deg); }
  50% { transform: rotate(-14deg); }
}

@keyframes cat-blink {
  0%, 92%, 100% { height: 3px; transform: translateY(0); }
  94% { height: 1px; transform: translateY(1px); }
}

@keyframes cat-stretch {
  0%, 80%, 100% { transform: translateY(0) scaleY(1); }
  90% { transform: translateY(1px) scaleY(0.94); }
}

@keyframes cat-jump {
  0% { transform: translateY(0); }
  30% { transform: translateY(-14px); }
  60% { transform: translateY(0); }
  80% { transform: translateY(-6px); }
  100% { transform: translateY(0); }
}

.drop-enter-active,
.drop-leave-active,
.sparkle-enter-active,
.sparkle-leave-active {
  transition: opacity 0.2s steps(4), transform 0.2s steps(4);
}

.drop-enter-from,
.drop-leave-to,
.sparkle-enter-from,
.sparkle-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

@media (max-width: 1024px) {
  .workspace {
    grid-template-columns: 1fr;
  }

  .history-item {
    grid-template-columns: 12px auto auto;
  }

  .time {
    grid-column: 2 / -1;
    justify-self: start;
  }
}

@media (max-width: 640px) {
  .brand-title {
    font-size: 10px;
  }

  .brand-subtitle,
  .status-box,
  .duration,
  .time,
  label,
  input,
  select,
  .mini-stat span {
    font-size: 18px;
  }

  .timer-display {
    font-size: 30px;
  }

  .stats-ribbon,
  .mini-grid,
  .controls,
  .preset-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
