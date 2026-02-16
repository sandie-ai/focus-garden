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
  { name: 'Lofi Girl 🎧', url: 'https://www.youtube.com/watch?v=jfKfPfyJRdk', type: 'external' },
  { name: 'SomaFM Groove', url: 'https://ice4.somafm.com/groovesalad-128-mp3', type: 'audio' },
  { name: 'SomaFM Drone Zone', url: 'https://ice4.somafm.com/dronezone-128-mp3', type: 'audio' },
]

const selectedStation = ref(lofiStations[1].url)
const audioRef = ref<HTMLAudioElement | null>(null)
const audioPlaying = ref(false)
const newlyPlanted = ref<number[]>([])
const showSparkle = ref(false)

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
  if (garden.value.totalSessions >= 30) return 100
  const thresholds = [3, 10, 20, 30]
  const current = garden.value.totalSessions
  const next = thresholds.find(t => current < t)
  if (!next) return 100
  const prev = [...thresholds].reverse().find(t => t <= current) ?? 0
  const ratio = ((current - prev) / (next - prev)) * 100
  return Math.max(0, Math.min(100, Math.round(ratio)))
})

const plantTypes = [
  { id: 'flower', name: 'Flower', emoji: '🌸', hue: 330 },
  { id: 'sunflower', name: 'Sunflower', emoji: '🌻', hue: 45 },
  { id: 'tulip', name: 'Tulip', emoji: '🌷', hue: 350 },
  { id: 'rose', name: 'Rose', emoji: '🌹', hue: 0 },
  { id: 'cactus', name: 'Cactus', emoji: '🌵', hue: 150 },
  { id: 'lavender', name: 'Lavender', emoji: '💜', hue: 270 },
]

const plants = computed(() => {
  return Array.from({ length: plantCount.value }, (_, i) => ({
    id: i,
    type: plantTypes[i % plantTypes.length].id,
    hue: plantTypes[i % plantTypes.length].hue,
    style: makePlantStyle(i)
  }))
})

const unlockedPlants = computed(() => {
  const count = garden.value.totalSessions
  if (count === 0) return []
  if (count < 3) return [plantTypes[0]]
  if (count < 10) return plantTypes.slice(0, 2)
  if (count < 20) return plantTypes.slice(0, 4)
  return plantTypes
})

function makePlantStyle(index: number) {
  const left = 8 + (index * 7.5) % 80
  const scale = 0.85 + (index % 3) * 0.15
  const bottom = 18 + (index * 2) % 15
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
  const prevCount = garden.value.totalSessions

  garden.value.totalSessions += 1
  garden.value.sessionsToday += 1

  const newCount = garden.value.totalSessions
  const newPlantIndices: number[] = []
  for (let i = Math.floor(prevCount / 2); i < Math.floor(newCount / 2); i++) {
    newPlantIndices.push(i)
  }
  if (newPlantIndices.length > 0) {
    newlyPlanted.value = newPlantIndices
    showSparkle.value = true
    setTimeout(() => { 
      newlyPlanted.value = [] 
      showSparkle.value = false
    }, 2500)
  }

  if (!last) {
    garden.value.streakDays = 1
  } else {
    const dLast = new Date(last)
    const dToday = new Date(today)
    const delta = Math.round((dToday.getTime() - dLast.getTime()) / 86400000)
    if (delta === 0) {
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
    } catch {}
  }

  syncDailyCounters()
  persist()
})
</script>

<template>
  <NuxtRouteAnnouncer />
  <main class="app" :data-phase="dayPhase">
    <section class="panel timer-panel">
      <div class="brand">🌱 Focus Garden</div>
      <h1>{{ mode === 'focus' ? 'Focus Time' : 'Break Time' }}</h1>
      <p class="subtitle">Grow your garden, grow your mind</p>

      <div class="timer-container">
        <div class="timer-glow" />
        <div class="timer-glow-2" />
        <div class="timer">{{ mmss }}</div>
      </div>

      <div class="controls">
        <button class="primary" @click="toggleTimer">
          <span v-if="running">⏸ Pause</span>
          <span v-else>▶ Start</span>
        </button>
        <button @click="resetTimer">↺ Reset</button>
        <button @click="setMode(mode === 'focus' ? 'break' : 'focus')">
          {{ mode === 'focus' ? '☕ Break' : '🎯 Focus' }}
        </button>
      </div>

      <div class="presets">
        <button @click="applyPreset(25, 5)">25/5</button>
        <button @click="applyPreset(50, 10)">50/10</button>
        <button @click="applyPreset(90, 20)">90/20</button>
      </div>

      <div class="inputs">
        <label>
          Focus
          <input v-model.number="focusMinutes" type="number" min="5" max="180" />
        </label>
        <label>
          Break
          <input v-model.number="breakMinutes" type="number" min="1" max="60" />
        </label>
      </div>

      <div class="audio-box">
        <label for="station">🎵 Ambiance</label>
        <select id="station" v-model="selectedStation">
          <option v-for="station in lofiStations" :key="station.url" :value="station.url">
            {{ station.name }}
          </option>
        </select>
        <button class="audio-btn" @click="toggleAudio">
          {{ audioPlaying ? '⏹ Stop' : '🎵 Play' }}
        </button>
        <audio ref="audioRef" :src="selectedStation" preload="none" loop />
      </div>
    </section>

    <section class="panel garden-panel">
      <div class="garden-header">
        <h2>🌸 Your Garden</h2>
        <div class="stats-row">
          <div class="stat">
            <span class="stat-value">{{ garden.totalSessions }}</span>
            <span class="stat-label">Total</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ garden.sessionsToday }}</span>
            <span class="stat-label">Today</span>
          </div>
          <div class="stat">
            <span class="stat-value">{{ garden.streakDays }}🔥</span>
            <span class="stat-label">Streak</span>
          </div>
        </div>
      </div>

      <div class="stage-row">
        <span>Stage {{ gardenStage }} / 4</span>
        <span class="progress-text">{{ progressToNext }}% to next</span>
      </div>
      <div class="progress">
        <div class="progress-fill" :style="{ width: `${progressToNext}%` }" />
      </div>

      <div class="garden-canvas">
        <!-- Sky -->
        <div class="sky-layer">
          <template v-if="dayPhase === 'night'">
            <div v-for="i in 40" :key="i" class="star" :style="{
              left: `${(i * 23 + 7) % 100}%`,
              top: `${(i * 17 + 3) % 45}%`,
              animationDelay: `${i * 0.15}s`,
              opacity: 0.2 + (i % 4) * 0.2
            }" />
          </template>
          
          <div v-if="dayPhase === 'night'" class="moon">
            <div class="moon-glow" />
            <div class="moon-body">
              <div class="crater c1" />
              <div class="crater c2" />
              <div class="crater c3" />
              <div class="crater c4" />
            </div>
          </div>
          
          <div v-if="dayPhase !== 'night'" class="sun" :class="dayPhase">
            <div class="sun-rays" />
          </div>
          
          <div class="clouds-layer">
            <div class="cloud c1" />
            <div class="cloud c2" />
            <div class="cloud c3" />
          </div>
        </div>

        <!-- Hills -->
        <div class="hills-layer">
          <div class="hill h1" />
          <div class="hill h2" />
          <div class="hill h3" />
          <div class="hill h4" />
        </div>

        <!-- Ground -->
        <div class="ground-layer">
          <div class="ground-texture" />
          <div class="grass-patches">
            <div v-for="i in 15" :key="i" class="grass-tuft" :style="{
              left: `${i * 6.5 + 2}%`,
              transform: `rotate(${(i % 7) - 3}deg)`
            }" />
          </div>
        </div>

        <!-- Empty State -->
        <div v-if="garden.totalSessions === 0" class="empty-garden">
          <div class="empty-plant">
            <div class="pot">
              <div class="pot-rim" />
              <div class="pot-body">
                <div class="pot-shine" />
              </div>
            </div>
            <div class="sprout">
              <div class="stem" />
              <div class="leaf l1" />
              <div class="leaf l2" />
              <div class="leaf l3" />
              <div class="dew d1" />
              <div class="dew d2" />
            </div>
            <div class="glow" />
          </div>
          <p class="empty-text">Start growing! 🌱</p>
        </div>

        <!-- Plants -->
        <template v-else>
          <div
            v-for="plant in plants"
            :key="plant.id"
            class="plant"
            :class="[`type-${plant.type}`, { 'just-planted': newlyPlanted.includes(plant.id) }]"
            :style="plant.style"
          >
            <div class="plant-container" :style="{ '--hue': plant.hue }">
              <div class="stem-main">
                <div class="stem-layer" />
              </div>
              <div class="leaves">
                <div class="leaf-element le1" />
                <div class="leaf-element le2" />
                <div class="leaf-element le3" />
                <div class="leaf-element le4" />
              </div>
              <div class="flower-head">
                <div class="petals">
                  <div class="petal p1" />
                  <div class="petal p2" />
                  <div class="petal p3" />
                  <div class="petal p4" />
                  <div class="petal p5" />
                  <div class="petal p6" />
                  <div class="petal p7" />
                  <div class="petal p8" />
                </div>
                <div class="flower-center">
                  <div class="center-dot" />
                  <div class="center-dot" />
                  <div class="center-dot" />
                  <div class="center-dot" />
                  <div class="center-dot" />
                </div>
              </div>
              <div v-if="gardenStage >= 4" class="plant-glow" />
            </div>
          </div>
        </template>

        <!-- Sparkles -->
        <div v-if="showSparkle" class="sparkle-overlay">
          <div v-for="i in 12" :key="i" class="sparkle-particle" :style="{
            left: `${15 + (i * 6) % 70}%`,
            top: `${30 + (i * 4) % 40}%`,
            animationDelay: `${i * 0.1}s`
          }" />
        </div>

        <!-- Particles -->
        <div class="particles">
          <template v-if="dayPhase === 'night'">
            <div v-for="i in 15" :key="i" class="firefly" :style="{
              left: `${(i * 19) % 100}%`,
              top: `${25 + (i * 13) % 45}%`,
              animationDelay: `${i * 0.3}s`
            }" />
          </template>
          <template v-else-if="dayPhase === 'sunset'">
            <div v-for="i in 8" :key="i" class="firefly faint" :style="{
              left: `${(i * 23) % 100}%`,
              top: `${30 + (i * 11) % 40}%`,
              animationDelay: `${i * 0.4}s`
            }" />
          </template>
          <template v-else>
            <div v-for="i in 5" :key="i" class="dust" :style="{
              left: `${(i * 27) % 100}%`,
              top: `${20 + (i * 17) % 50}%`,
              animationDelay: `${i * 0.8}s`
            }" />
          </template>
        </div>
      </div>

      <!-- Collection -->
      <div class="plant-showcase">
        <h3>🌱 Collection</h3>
        <div class="plant-evolution">
          <div 
            v-for="plant in plantTypes" 
            :key="plant.id"
            class="evolution-row"
            :class="{ locked: !unlockedPlants.find(p => p.id === plant.id) }"
          >
            <span class="plant-emoji">{{ plant.emoji }}</span>
            <div class="evolution-stages">
              <div 
                v-for="stage in 4" 
                :key="stage" 
                class="stage-dot"
                :class="{ active: gardenStage >= stage }"
              />
            </div>
            <span class="plant-name">{{ plant.name }}</span>
          </div>
        </div>
      </div>

      <p class="hint">Complete focus sessions to grow your garden ✨</p>
    </section>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap');

:root {
  --accent: #22c55e;
  --accent-light: #4ade80;
}

:global(body) {
  margin: 0;
  font-family: 'Outfit', sans-serif;
  background: #080c14;
  color: #f0f4f8;
}

.app {
  min-height: 100vh;
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
  padding: 0.75rem;
  transition: background 1s ease;
}

.app[data-phase='day'] { 
  background: linear-gradient(180deg, #1e3a5f 0%, #0f1f35 50%, #0a1425 100%);
}
.app[data-phase='sunset'] { 
  background: linear-gradient(180deg, #3d2952 0%, #261838 50%, #130d1f 100%);
}
.app[data-phase='night'] { 
  background: linear-gradient(180deg, #0a0f1a 0%, #04060d 50%, #020408 100%);
}

@media (min-width: 640px) {
  .app {
    padding: 1rem;
    gap: 1.25rem;
  }
}

@media (min-width: 1024px) {
  .app {
    grid-template-columns: 1fr 1.3fr;
    padding: 1.5rem;
    gap: 2rem;
  }
}

.panel {
  background: linear-gradient(145deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 100%);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 20px;
  padding: 1.25rem;
  backdrop-filter: blur(24px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}

@media (min-width: 1024px) {
  .panel {
    border-radius: 28px;
    padding: 1.75rem;
  }
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: linear-gradient(135deg, rgba(34,197,94,0.3) 0%, rgba(16,185,129,0.2) 100%);
  color: #86efac;
  border: 1px solid rgba(134,239,172,0.35);
  border-radius: 999px;
  padding: 0.35rem 0.75rem;
  font-size: 0.8rem;
  font-weight: 600;
}

h1, h2, h3 { margin: 0; font-weight: 800; }

h1 {
  font-size: 1.5rem;
  margin-top: 0.75rem;
  background: linear-gradient(135deg, #fff 0%, #c7d2fe 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

@media (min-width: 640px) {
  h1 { font-size: 1.8rem; }
}

h2 { font-size: 1.2rem; color: #e2e8f0; }
h3 { font-size: 0.95rem; color: #e2e8f0; margin-bottom: 0.5rem; }

.subtitle { margin: 0.35rem 0 0.75rem; color: #94a3b8; font-size: 0.9rem; }

.timer-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 1.25rem 0;
  height: 150px;
}

@media (min-width: 640px) {
  .timer-container {
    height: 180px;
    margin: 1.5rem 0;
  }
}

.timer-glow {
  position: absolute;
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, rgba(34,197,94,0.25) 0%, transparent 70%);
  border-radius: 50%;
  animation: pulse-soft 4s ease-in-out infinite;
}

.timer-glow-2 {
  position: absolute;
  width: 150px;
  height: 150px;
  background: radial-gradient(circle, rgba(74,222,128,0.15) 0%, transparent 60%);
  border-radius: 50%;
  animation: pulse-soft 4s ease-in-out infinite 0.5s;
}

@keyframes pulse-soft {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.1); opacity: 1; }
}

.timer {
  font-size: clamp(2.8rem, 12vw, 5.8rem);
  font-weight: 800;
  letter-spacing: 6px;
  font-variant-numeric: tabular-nums;
  color: #fff;
  text-shadow: 0 0 50px rgba(34,197,94,0.6), 0 4px 20px rgba(0,0,0,0.3);
  position: relative;
  z-index: 1;
}

.controls, .presets {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: center;
}

@media (min-width: 640px) {
  .controls, .presets {
    gap: 0.6rem;
  }
}

button {
  border: 1px solid rgba(255,255,255,0.15);
  background: linear-gradient(145deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 100%);
  color: #e2e8f0;
  padding: 0.6rem 1rem;
  border-radius: 12px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

@media (min-width: 640px) {
  button {
    padding: 0.75rem 1.3rem;
    border-radius: 16px;
    font-size: 0.95rem;
  }
}

button:hover {
  background: linear-gradient(145deg, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.08) 100%);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0,0,0,0.25);
}

.primary {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  border: none;
  color: white;
  padding: 0.6rem 1.5rem;
  box-shadow: 0 4px 24px rgba(34,197,94,0.4), inset 0 1px 0 rgba(255,255,255,0.2);
}

@media (min-width: 640px) {
  .primary {
    padding: 0.75rem 2rem;
  }
}

.primary:hover {
  background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
}

.inputs {
  margin-top: 0.85rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

label {
  display: grid;
  gap: 0.35rem;
  font-size: 0.8rem;
  color: #94a3b8;
}

input, select {
  width: 100%;
  padding: 0.55rem;
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(15,23,42,0.7);
  color: #f1f5f9;
  font-family: inherit;
  font-size: 0.9rem;
  transition: all 0.2s;
}

@media (min-width: 640px) {
  label { font-size: 0.85rem; }
  input, select { padding: 0.7rem; border-radius: 14px; font-size: 1rem; }
}

input:focus, select:focus {
  outline: none;
  border-color: rgba(34,197,94,0.6);
  box-shadow: 0 0 0 3px rgba(34,197,94,0.15);
}

.audio-box { margin-top: 0.85rem; display: grid; gap: 0.45rem; }
.audio-btn { width: fit-content; justify-self: center; }

/* Garden Panel */
.garden-header {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

@media (min-width: 640px) {
  .garden-header {
    flex-direction: row;
    justify-content: space-between;
    align-items: flex-start;
  }
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

@media (min-width: 640px) {
  .stats-row {
    gap: 0.75rem;
  }
}

.stat {
  background: linear-gradient(145deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  padding: 0.6rem 0.5rem;
  text-align: center;
  transition: transform 0.2s;
}

@media (min-width: 640px) {
  .stat {
    border-radius: 18px;
    padding: 0.9rem;
  }
}

.stat:hover { transform: translateY(-2px); }

.stat-value { display: block; font-size: 1.2rem; font-weight: 800; color: #f8fafc; }

@media (min-width: 640px) {
  .stat-value { font-size: 1.6rem; }
}

.stat-label { color: #64748b; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px; }

@media (min-width: 640px) {
  .stat-label { font-size: 0.75rem; }
}

.stage-row {
  display: flex;
  justify-content: space-between;
  margin-top: 0.85rem;
  color: #94a3b8;
  font-size: 0.8rem;
}

.progress-text { color: #86efac; }

.progress {
  height: 8px;
  background: rgba(255,255,255,0.1);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 0.4rem;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #22c55e, #4ade80, #34d399);
  border-radius: 999px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 12px rgba(34,197,94,0.5);
}

/* Garden Canvas */
.garden-canvas {
  position: relative;
  height: 260px;
  margin-top: 1rem;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.15);
}

@media (min-width: 640px) {
  .garden-canvas {
    height: 320px;
    margin-top: 1.25rem;
    border-radius: 24px;
  }
}

/* Sky */
.sky-layer { position: absolute; inset: 0; z-index: 1; }

.star {
  position: absolute;
  width: 2px;
  height: 2px;
  background: #fff;
  border-radius: 50%;
  animation: twinkle 2.5s ease-in-out infinite;
}

@keyframes twinkle {
  0%, 100% { opacity: 0.2; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.3); }
}

.moon {
  position: absolute;
  top: 15px;
  right: 20px;
  width: 40px;
  height: 40px;
  z-index: 2;
}

@media (min-width: 640px) {
  .moon { top: 20px; right: 30px; width: 50px; height: 50px; }
}

.moon-glow {
  position: absolute;
  inset: -15px;
  background: radial-gradient(circle, rgba(254,240,138,0.3) 0%, transparent 70%);
  animation: moon-pulse 4s ease-in-out infinite;
}

@keyframes moon-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

.moon-body {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 35% 35%, #fefce8, #fef9c3 50%, #fde047);
  border-radius: 50%;
  box-shadow: 0 0 30px rgba(254,240,138,0.5);
}

.crater { position: absolute; background: rgba(0,0,0,0.08); border-radius: 50%; }
.crater.c1 { width: 8px; height: 8px; top: 10px; left: 11px; }
.crater.c2 { width: 5px; height: 5px; top: 20px; left: 6px; }
.crater.c3 { width: 6px; height: 6px; top: 16px; left: 22px; }
.crater.c4 { width: 4px; height: 4px; top: 26px; left: 14px; }

.sun {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: 45px;
  height: 45px;
  border-radius: 50%;
  z-index: 2;
}

@media (min-width: 640px) {
  .sun { top: 15px; width: 60px; height: 60px; }
}

.sun.day {
  background: radial-gradient(circle at 30% 30%, #fff7ed, #fbbf24 60%, #f59e0b);
  box-shadow: 0 0 50px rgba(251,191,36,0.6);
}

.sun.sunset {
  background: radial-gradient(circle at 30% 30%, #fed7aa, #f97316 60%, #ea580c);
  box-shadow: 0 0 60px rgba(249,115,22,0.6);
}

.sun-rays {
  position: absolute;
  inset: -25px;
  background: conic-gradient(from 0deg, transparent 0deg, rgba(255,255,255,0.1) 10deg, transparent 20deg);
  animation: rotate-slow 30s linear infinite;
  border-radius: 50%;
}

@keyframes rotate-slow { to { transform: rotate(360deg); } }

.clouds-layer { position: absolute; inset: 0; z-index: 3; }

.cloud {
  position: absolute;
  background: linear-gradient(180deg, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.1) 100%);
  border-radius: 50px;
  filter: blur(10px);
}

.cloud.c1 { width: 60px; height: 20px; top: 20px; left: -80px; animation: drift 35s linear infinite; }
.cloud.c2 { width: 45px; height: 15px; top: 40px; left: -80px; animation: drift 28s linear infinite 5s; }
.cloud.c3 { width: 55px; height: 18px; top: 60px; left: -80px; animation: drift 32s linear infinite 12s; }

@media (min-width: 640px) {
  .cloud.c1 { width: 80px; height: 26px; top: 25px; }
  .cloud.c2 { width: 60px; height: 20px; top: 50px; }
  .cloud.c3 { width: 70px; height: 24px; top: 75px; }
}

@keyframes drift { from { transform: translateX(0); } to { transform: translateX(calc(100vw + 100px)); } }

/* Hills */
.hills-layer {
  position: absolute;
  bottom: 50px;
  left: 0;
  right: 0;
  z-index: 4;
}

@media (min-width: 640px) {
  .hills-layer { bottom: 60px; }
}

.hill { position: absolute; border-radius: 50%; }
.hill.h1 { width: 160px; height: 50px; background: #1a4a35; left: -20px; bottom: 0; }
.hill.h2 { width: 150px; height: 45px; background: #145030; right: -15px; bottom: 0; }
.hill.h3 { width: 120px; height: 40px; background: #0f3a24; left: 25%; bottom: 0; }
.hill.h4 { width: 100px; height: 30px; background: #0a2a18; left: 55%; bottom: 0; }

@media (min-width: 640px) {
  .hill.h1 { width: 220px; height: 70px; left: -30px; }
  .hill.h2 { width: 200px; height: 60px; right: -20px; }
  .hill.h3 { width: 160px; height: 50px; }
  .hill.h4 { width: 140px; height: 40px; }
}

/* Ground */
.ground-layer {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 50px;
  background: linear-gradient(180deg, #1a5c35 0%, #0d3a20 40%, #062a16 100%);
  z-index: 5;
}

@media (min-width: 640px) {
  .ground-layer { height: 60px; }
}

.ground-texture {
  position: absolute;
  inset: 0;
  background-image: 
    radial-gradient(circle at 20% 30%, rgba(255,255,255,0.03) 1px, transparent 1px),
    radial-gradient(circle at 60% 70%, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 20px 20px;
}

.grass-patches {
  position: absolute;
  top: -8px;
  left: 0;
  right: 0;
  height: 12px;
}

@media (min-width: 640px) {
  .grass-patches { top: -10px; height: 15px; }
}

.grass-tuft {
  position: absolute;
  bottom: 0;
  width: 3px;
  height: 10px;
  background: linear-gradient(to top, #145028, #22c55e, #4ade80);
  border-radius: 3px 3px 0 0;
  transform-origin: bottom center;
  animation: sway 2.5s ease-in-out infinite;
}

@media (min-width: 640px) {
  .grass-tuft { width: 4px; height: 12px; }
}

@keyframes sway { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }

/* Empty State */
.empty-garden {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.empty-plant { position: relative; animation: float-gentle 4s ease-in-out infinite; }

@keyframes float-gentle { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }

.pot { position: relative; }

.pot-rim {
  width: 44px;
  height: 11px;
  background: linear-gradient(180deg, #d97706 0%, #b45309 50%, #92400e 100%);
  border-radius: 5px;
  position: relative;
  z-index: 2;
}

.pot-body {
  width: 36px;
  height: 32px;
  background: linear-gradient(180deg, #b45309 0%, #92400e 50%, #78350f 100%);
  border-radius: 3px 3px 12px 12px;
  position: relative;
  margin: 0 auto;
  margin-top: -3px;
}

.pot-shine {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 6px;
  height: 16px;
  background: rgba(255,255,255,0.15);
  border-radius: 3px;
}

.sprout {
  position: absolute;
  bottom: 34px;
  left: 50%;
  transform: translateX(-50%);
}

.stem { width: 3px; height: 22px; background: linear-gradient(90deg, #15803d, #22c55e, #15803d); border-radius: 2px; margin: 0 auto; }

.leaf {
  position: absolute;
  background: linear-gradient(135deg, #22c55e 0%, #4ade80 100%);
  border-radius: 50% 50% 50% 20%;
}

.leaf.l1 { width: 11px; height: 8px; bottom: 14px; left: -8px; transform: rotate(-35deg); }
.leaf.l2 { width: 10px; height: 7px; bottom: 17px; right: -6px; transform: rotate(30deg) scaleX(-1); }
.leaf.l3 { width: 8px; height: 6px; bottom: 20px; left: -4px; transform: rotate(-20deg); }

.dew {
  position: absolute;
  width: 3px;
  height: 3px;
  background: rgba(255,255,255,0.8);
  border-radius: 50%;
  animation: dew-shine 2s ease-in-out infinite;
}

.dew.d1 { top: 2px; left: 3px; }
.dew.d2 { top: 6px; right: 5px; animation-delay: 0.5s; }

@keyframes dew-shine { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }

.glow {
  position: absolute;
  top: -25px;
  left: 50%;
  transform: translateX(-50%);
  width: 60px;
  height: 60px;
  background: radial-gradient(circle, rgba(34,197,94,0.3) 0%, transparent 70%);
  animation: glow-pulse 3s ease-in-out infinite;
}

@keyframes glow-pulse { 0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); } 50% { opacity: 1; transform: translateX(-50%) scale(1.2); } }

.empty-text {
  margin-top: 1.2rem;
  color: #86efac;
  font-size: 1rem;
  font-weight: 600;
}

/* Plants */
.plant { position: absolute; z-index: 6; }

.plant.just-planted { animation: plant-appear 1s cubic-bezier(0.34, 1.56, 0.64, 1) forwards; }

@keyframes plant-appear { 0% { opacity: 0; transform: translateX(-50%) scale(0.3) translateY(30px); } 100% { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); } }

.plant-container {
  position: relative;
  width: 32px;
  height: 65px;
  animation: plant-sway 4s ease-in-out infinite;
  transform-origin: bottom center;
}

@media (min-width: 640px) {
  .plant-container { width: 40px; height: 80px; }
}

@keyframes plant-sway { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }

.stem-main {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 36px;
  background: linear-gradient(90deg, #15803d, #22c55e, #15803d);
  border-radius: 2px;
}

@media (min-width: 640px) {
  .stem-main { width: 5px; height: 45px; }
}

.stem-layer { position: absolute; left: 1px; width: 2px; height: 100%; background: rgba(255,255,255,0.15); border-radius: 2px; }

.leaves { position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); }

.leaf-element {
  position: absolute;
  background: linear-gradient(135deg, hsl(var(--hue, 140), 60%, 45%) 0%, hsl(var(--hue, 140), 70%, 55%) 100%);
  border-radius: 50% 50% 50% 20%;
}

.le1 { width: 11px; height: 7px; left: -10px; bottom: 6px; transform: rotate(-35deg); }
.le2 { width: 10px; height: 6px; right: -8px; bottom: 10px; transform: rotate(30deg) scaleX(-1); }
.le3 { width: 8px; height: 5px; left: -6px; bottom: 16px; transform: rotate(-25deg); }
.le4 { width: 9px; height: 5px; right: -5px; bottom: 19px; transform: rotate(20deg) scaleX(-1); }

@media (min-width: 640px) {
  .le1 { width: 14px; height: 9px; left: -12px; bottom: 8px; }
  .le2 { width: 12px; height: 8px; right: -10px; bottom: 12px; }
  .le3 { width: 10px; height: 7px; left: -8px; bottom: 20px; }
  .le4 { width: 11px; height: 7px; right: -7px; bottom: 24px; }
}

.flower-head {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 26px;
  height: 26px;
}

@media (min-width: 640px) {
  .flower-head { width: 32px; height: 32px; }
}

.petals { position: absolute; inset: 0; }

.petal {
  position: absolute;
  width: 10px;
  height: 13px;
  background: linear-gradient(135deg, hsl(var(--hue, 330), 75%, 65%) 0%, hsl(var(--hue, 330), 60%, 55%) 100%);
  border-radius: 50%;
  transform-origin: bottom center;
}

@media (min-width: 640px) {
  .petal { width: 12px; height: 16px; }
}

.p1 { bottom: 0; left: 50%; transform: translateX(-50%) rotate(0deg); }
.p2 { bottom: 2px; left: 60%; transform: rotate(45deg); }
.p3 { bottom: 5px; right: 2px; transform: rotate(90deg); }
.p4 { bottom: 10px; right: 0; transform: rotate(135deg); }
.p5 { bottom: 14px; right: 2px; transform: rotate(180deg); }
.p6 { bottom: 16px; left: 4px; transform: rotate(225deg); }
.p7 { bottom: 14px; left: 0; transform: rotate(270deg); }
.p8 { bottom: 8px; left: 2px; transform: rotate(315deg); }

.flower-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 12px;
  height: 12px;
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
  border-radius: 50%;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-content: center;
  gap: 1px;
  padding: 2px;
}

@media (min-width: 640px) {
  .flower-center { width: 14px; height: 14px; }
}

.center-dot { width: 2px; height: 2px; background: #78350f; border-radius: 50%; }

@media (min-width: 640px) {
  .center-dot { width: 3px; height: 3px; }
}

.plant-glow {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 40px;
  height: 40px;
  background: radial-gradient(circle, hsla(var(--hue, 330), 80%, 65%, 0.4) 0%, transparent 70%);
  animation: glow-flower 2s ease-in-out infinite;
}

@keyframes glow-flower { 0%, 100% { opacity: 0.5; transform: translateX(-50%) scale(1); } 50% { opacity: 1; transform: translateX(-50%) scale(1.3); } }

/* Particles */
.sparkle-overlay { position: absolute; inset: 0; z-index: 20; pointer-events: none; }

.sparkle-particle {
  position: absolute;
  width: 5px;
  height: 5px;
  background: #fff;
  border-radius: 50%;
  animation: sparkle-burst 1.5s ease-out forwards;
  box-shadow: 0 0 8px #fff, 0 0 16px #fef08a;
}

@keyframes sparkle-burst { 0% { opacity: 0; transform: scale(0); } 30% { opacity: 1; transform: scale(1.5); } 100% { opacity: 0; transform: scale(0) translateY(-25px); } }

.firefly {
  position: absolute;
  width: 3px;
  height: 3px;
  background: #fef08a;
  border-radius: 50%;
  box-shadow: 0 0 6px #fef08a, 0 0 12px #fef08a;
  animation: fly 5s ease-in-out infinite;
}

@media (min-width: 640px) {
  .firefly { width: 4px; height: 4px; }
}

.firefly.faint { opacity: 0.6; }

@keyframes fly { 0%, 100% { opacity: 0; transform: translate(0, 0) scale(0.5); } 25% { opacity: 1; transform: translate(12px, -16px) scale(1); } 50% { opacity: 0.6; transform: translate(-8px, -28px) scale(0.8); } 75% { opacity: 1; transform: translate(16px, -12px) scale(1.2); } }

.dust { position: absolute; width: 2px; height: 2px; background: rgba(255,255,255,0.4); border-radius: 50%; animation: float-dust 8s ease-in-out infinite; }

@keyframes float-dust { 0%, 100% { opacity: 0; transform: translateY(0); } 50% { opacity: 0.6; transform: translateY(-16px); } }

/* Showcase */
.plant-showcase {
  margin-top: 1.25rem;
  padding: 0.85rem;
  background: rgba(0,0,0,0.2);
  border-radius: 16px;
  border: 1px solid rgba(255,255,255,0.08);
}

@media (min-width: 640px) {
  .plant-showcase { margin-top: 1.5rem; padding: 1rem; border-radius: 18px; }
}

.plant-evolution { display: flex; flex-direction: column; gap: 0.4rem; }

@media (min-width: 640px) {
  .plant-evolution { gap: 0.5rem; }
}

.evolution-row {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem;
  background: rgba(255,255,255,0.04);
  border-radius: 10px;
  transition: all 0.2s;
}

@media (min-width: 640px) {
  .evolution-row { padding: 0.6rem; gap: 0.75rem; border-radius: 12px; }
}

.evolution-row.locked { opacity: 0.35; }
.evolution-row:not(.locked):hover { background: rgba(255,255,255,0.08); }

.plant-emoji { font-size: 1.1rem; width: 26px; text-align: center; }

@media (min-width: 640px) {
  .plant-emoji { font-size: 1.3rem; width: 30px; }
}

.evolution-stages { display: flex; gap: 3px; }

.stage-dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(255,255,255,0.1);
  transition: all 0.3s;
}

@media (min-width: 640px) {
  .stage-dot { width: 22px; height: 22px; gap: 4px; }
}

.stage-dot.active {
  background: linear-gradient(135deg, #22c55e, #4ade80);
  box-shadow: 0 0 8px rgba(34,197,94,0.5);
}

.plant-name { flex: 1; font-size: 0.8rem; color: #e2e8f0; }

@media (min-width: 640px) {
  .plant-name { font-size: 0.85rem; }
}

.hint { margin-top: 0.85rem; color: #64748b; font-size: 0.8rem; text-align: center; }

@media (min-width: 640px) {
  .hint { margin-top: 1rem; font-size: 0.85rem; }
}
</style>
