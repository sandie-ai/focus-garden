<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

type Mode = 'focus' | 'break'

type GardenState = {
  totalSessions: number
  sessionsToday: number
  streakDays: number
  lastSessionDate: string | null
}

const STORAGE_KEY = 'focus-garden:v1'

const focusMinutes = ref(25)
const breakMinutes = ref(5)
const mode = ref<Mode>('focus')
const secondsLeft = ref(focusMinutes.value * 60)
const running = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

const garden = ref<GardenState>({
  totalSessions: 0,
  sessionsToday: 0,
  streakDays: 0,
  lastSessionDate: null,
})

const lofiStations = [
  { name: 'Lofi Girl (YouTube)', url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk', type: 'external' },
  { name: 'SomaFM Groove Salad', url: 'https://ice4.somafm.com/groovesalad-128-mp3', type: 'audio' },
  { name: 'SomaFM Drone Zone', url: 'https://ice4.somafm.com/dronezone-128-mp3', type: 'audio' },
]

const selectedStation = ref(lofiStations[1].url)
const audioRef = ref<HTMLAudioElement | null>(null)
const audioPlaying = ref(false)

const mmss = computed(() => {
  const m = Math.floor(secondsLeft.value / 60).toString().padStart(2, '0')
  const s = (secondsLeft.value % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

const dayPhase = computed(() => {
  if (garden.value.totalSessions >= 20) return 'night'
  if (garden.value.totalSessions >= 8) return 'sunset'
  return 'day'
})

const gardenStage = computed(() => {
  if (garden.value.totalSessions >= 30) return 4
  if (garden.value.totalSessions >= 20) return 3
  if (garden.value.totalSessions >= 10) return 2
  if (garden.value.totalSessions >= 3) return 1
  return 0
})

const plantCount = computed(() => Math.min(12, Math.floor(garden.value.totalSessions / 2) + 1))

const progressToNext = computed(() => {
  const thresholds = [3, 10, 20, 30]
  const current = garden.value.totalSessions
  const next = thresholds.find(t => current < t)
  if (!next) return 100
  const prev = [...thresholds].reverse().find(t => t <= current) ?? 0
  const ratio = ((current - prev) / (next - prev)) * 100
  return Math.max(0, Math.min(100, Math.round(ratio)))
})

function makePlantStyle(index: number) {
  const left = ((index * 73) % 92) + 4
  const sway = (index % 5) - 2
  const scale = 0.8 + ((index * 13) % 4) * 0.1
  return {
    left: `${left}%`,
    transform: `translateX(-50%) scale(${scale}) rotate(${sway}deg)`,
    animationDelay: `${(index % 6) * 0.2}s`,
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    focusMinutes: focusMinutes.value,
    breakMinutes: breakMinutes.value,
    mode: mode.value,
    secondsLeft: secondsLeft.value,
    garden: garden.value,
    selectedStation: selectedStation.value,
  }))
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

function syncDailyCounters() {
  const today = todayISO()
  if (garden.value.lastSessionDate && garden.value.lastSessionDate !== today) {
    garden.value.sessionsToday = 0
  }
}

function setMode(next: Mode) {
  mode.value = next
  secondsLeft.value = (next === 'focus' ? focusMinutes.value : breakMinutes.value) * 60
  running.value = false
  stopTimer()
  persist()
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function completeFocusSession() {
  const today = todayISO()
  const last = garden.value.lastSessionDate

  garden.value.totalSessions += 1
  garden.value.sessionsToday += 1

  if (!last) {
    garden.value.streakDays = 1
  } else {
    const dLast = new Date(last)
    const dToday = new Date(today)
    const delta = Math.round((dToday.getTime() - dLast.getTime()) / 86400000)
    if (delta === 0) {
      // same day, streak unchanged
    } else if (delta === 1) {
      garden.value.streakDays += 1
    } else {
      garden.value.streakDays = 1
    }
  }

  garden.value.lastSessionDate = today
}

function onTimerDone() {
  if (mode.value === 'focus') {
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

async function toggleAudio() {
  const station = lofiStations.find(s => s.url === selectedStation.value)
  if (!station || station.type === 'external') {
    window.open(station?.url || selectedStation.value, '_blank')
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
    // autoplay blocked
    audioPlaying.value = false
  }
}

watch([focusMinutes, breakMinutes], () => {
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

onMounted(() => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (raw) {
    try {
      const data = JSON.parse(raw)
      focusMinutes.value = Number(data.focusMinutes ?? 25)
      breakMinutes.value = Number(data.breakMinutes ?? 5)
      mode.value = data.mode ?? 'focus'
      secondsLeft.value = Number(data.secondsLeft ?? focusMinutes.value * 60)
      selectedStation.value = data.selectedStation ?? lofiStations[1].url
      if (data.garden) garden.value = data.garden
    } catch {
      // ignore corrupted storage
    }
  }

  syncDailyCounters()
  persist()
})
</script>

<template>
  <NuxtRouteAnnouncer />
  <main class="app" :data-phase="dayPhase">
    <section class="panel timer-panel">
      <div class="brand">Focus Garden</div>
      <h1>{{ mode === 'focus' ? 'Mode Focus' : 'Mode Pause' }}</h1>
      <p class="subtitle">Un timer chill qui fait pousser ton jardin 🌱</p>

      <div class="timer">{{ mmss }}</div>

      <div class="controls">
        <button class="primary" @click="toggleTimer">{{ running ? 'Pause' : 'Start' }}</button>
        <button @click="resetTimer">Reset</button>
        <button @click="setMode(mode === 'focus' ? 'break' : 'focus')">Switch</button>
      </div>

      <div class="presets">
        <button @click="applyPreset(25, 5)">25/5</button>
        <button @click="applyPreset(50, 10)">50/10</button>
        <button @click="applyPreset(90, 20)">90/20</button>
      </div>

      <div class="inputs">
        <label>
          Focus (min)
          <input v-model.number="focusMinutes" type="number" min="5" max="180" />
        </label>
        <label>
          Pause (min)
          <input v-model.number="breakMinutes" type="number" min="1" max="60" />
        </label>
      </div>

      <div class="audio-box">
        <label for="station">Lo-fi / ambiance</label>
        <select id="station" v-model="selectedStation">
          <option v-for="station in lofiStations" :key="station.url" :value="station.url">
            {{ station.name }}
          </option>
        </select>
        <button class="audio-btn" @click="toggleAudio">
          {{ audioPlaying ? 'Stop audio' : 'Play audio' }}
        </button>
        <audio ref="audioRef" :src="selectedStation" preload="none" loop />
      </div>
    </section>

    <section class="panel garden-panel">
      <h2>Ton jardin</h2>
      <div class="stats">
        <div><strong>{{ garden.totalSessions }}</strong><span>sessions total</span></div>
        <div><strong>{{ garden.sessionsToday }}</strong><span>aujourd'hui</span></div>
        <div><strong>{{ garden.streakDays }}</strong><span>jours de streak</span></div>
      </div>

      <div class="stage-row">
        <span>Évolution</span>
        <span>Stage {{ gardenStage }} / 4</span>
      </div>
      <div class="progress">
        <div class="progress-fill" :style="{ width: `${progressToNext}%` }" />
      </div>

      <div class="garden-canvas">
        <div class="soil" />
        <div
          v-for="i in plantCount"
          :key="i"
          class="plant"
          :style="makePlantStyle(i)"
          :data-stage="gardenStage"
        >
          <span class="stem" />
          <span class="leaf leaf-left" />
          <span class="leaf leaf-right" />
          <span v-if="gardenStage >= 2" class="flower" />
        </div>
      </div>

      <p class="hint">
        Plus tu termines de sessions focus, plus ton jardin grandit. Objectif: 3 sessions aujourd’hui 💪
      </p>
    </section>
  </main>
</template>

<style scoped>
:global(body) {
  margin: 0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
  background: #0f1220;
  color: #eef2ff;
}

.app {
  min-height: 100vh;
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
  padding: 1rem;
  transition: background 0.5s ease;
}

.app[data-phase='day'] { background: radial-gradient(circle at top, #1e294f, #0f1220 55%); }
.app[data-phase='sunset'] { background: radial-gradient(circle at top, #422f53, #121420 55%); }
.app[data-phase='night'] { background: radial-gradient(circle at top, #141a33, #090b13 60%); }

@media (min-width: 980px) {
  .app {
    grid-template-columns: 1fr 1fr;
    padding: 1.5rem;
  }
}

.panel {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 18px;
  padding: 1rem;
  backdrop-filter: blur(8px);
}

.brand {
  display: inline-flex;
  background: rgba(134, 239, 172, 0.2);
  color: #bbf7d0;
  border: 1px solid rgba(187, 247, 208, 0.4);
  border-radius: 999px;
  padding: 0.2rem 0.6rem;
  font-size: 0.8rem;
  margin-bottom: 0.5rem;
}

h1, h2 {
  margin: 0;
}

.subtitle {
  margin-top: 0.4rem;
  color: #c7d2fe;
}

.timer {
  font-size: clamp(2.4rem, 9vw, 5rem);
  font-weight: 800;
  text-align: center;
  letter-spacing: 2px;
  margin: 1rem 0;
}

.controls, .presets {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

button {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #eef2ff;
  padding: 0.55rem 0.9rem;
  border-radius: 10px;
  cursor: pointer;
}

button:hover {
  background: rgba(255, 255, 255, 0.14);
}

.primary {
  background: linear-gradient(135deg, #22c55e, #16a34a);
  border: none;
}

.inputs {
  margin-top: 0.8rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

label {
  display: grid;
  gap: 0.3rem;
  font-size: 0.9rem;
}

input, select {
  width: 100%;
  padding: 0.5rem;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(10, 12, 20, 0.7);
  color: #eef2ff;
}

.audio-box {
  margin-top: 0.9rem;
  display: grid;
  gap: 0.45rem;
}

.audio-btn {
  width: fit-content;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.6rem;
  margin-top: 0.8rem;
}

.stats > div {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 0.65rem;
  text-align: center;
}

.stats strong {
  display: block;
  font-size: 1.2rem;
}

.stats span {
  color: #c7d2fe;
  font-size: 0.8rem;
}

.stage-row {
  display: flex;
  justify-content: space-between;
  margin-top: 0.8rem;
  color: #c7d2fe;
  font-size: 0.9rem;
}

.progress {
  height: 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 0.35rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #4ade80, #22d3ee);
}

.garden-canvas {
  position: relative;
  height: 260px;
  margin-top: 1rem;
  border-radius: 16px;
  overflow: hidden;
  background: linear-gradient(to bottom, rgba(125, 211, 252, 0.2), rgba(16, 185, 129, 0.1));
  border: 1px solid rgba(255, 255, 255, 0.16);
}

.soil {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 38%;
  background: linear-gradient(to top, #3a2a1b, #4b3323);
}

.plant {
  position: absolute;
  bottom: 25%;
  width: 14px;
  height: 90px;
  animation: sway 3s ease-in-out infinite;
}

.stem {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 4px;
  height: 70px;
  transform: translateX(-50%);
  background: #4ade80;
  border-radius: 10px;
}

.leaf {
  position: absolute;
  width: 16px;
  height: 10px;
  background: #65e28f;
  border-radius: 14px 14px 14px 2px;
}

.leaf-left {
  left: -10px;
  bottom: 32px;
  transform: rotate(-30deg);
}

.leaf-right {
  right: -10px;
  bottom: 44px;
  transform: rotate(35deg) scaleX(-1);
}

.flower {
  position: absolute;
  top: 6px;
  left: 50%;
  width: 12px;
  height: 12px;
  transform: translateX(-50%);
  border-radius: 999px;
  background: radial-gradient(circle, #fef08a, #f472b6);
}

.plant[data-stage='0'] .leaf,
.plant[data-stage='0'] .flower {
  display: none;
}

.plant[data-stage='1'] .flower {
  display: none;
}

.hint {
  margin-top: 0.7rem;
  color: #c7d2fe;
}

@keyframes sway {
  0%, 100% { transform: translateX(-50%) rotate(-2deg); }
  50% { transform: translateX(-50%) rotate(2deg); }
}
</style>
