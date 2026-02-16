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
const newlyPlanted = ref<number[]>([])

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

// Generate plants with different types
const plants = computed(() => {
  const types = ['flower', 'sunflower', 'tulip', 'rose', 'cactus', 'succulent']
  return Array.from({ length: plantCount.value }, (_, i) => ({
    id: i,
    type: types[i % types.length],
    style: makePlantStyle(i)
  }))
})

function makePlantStyle(index: number) {
  const left = ((index * 73) % 85) + 8
  const scale = 0.8 + ((index * 7) % 4) * 0.15
  const bottom = 22 + ((index * 11) % 12)
  return {
    left: `${left}%`,
    bottom: `${bottom}%`,
    transform: `translateX(-50%) scale(${scale})`,
    animationDelay: `${index * 0.15}s`,
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
    setTimeout(() => { newlyPlanted.value = [] }, 2000)
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
          Focus (min)
          <input v-model.number="focusMinutes" type="number" min="5" max="180" />
        </label>
        <label>
          Break (min)
          <input v-model.number="breakMinutes" type="number" min="1" max="60" />
        </label>
      </div>

      <div class="audio-box">
        <label for="station">🎵 Lo-fi Ambiance</label>
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
      <h2>🌸 Your Garden</h2>
      <div class="stats">
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

      <div class="stage-info">
        <span>Stage {{ gardenStage }} / 4</span>
        <span class="progress-text">{{ progressToNext }}% to next</span>
      </div>
      <div class="progress">
        <div class="progress-fill" :style="{ width: `${progressToNext}%` }" />
      </div>

      <div class="garden-canvas">
        <!-- Sky -->
        <div class="sky">
          <!-- Stars -->
          <template v-if="dayPhase === 'night'">
            <span v-for="i in 30" :key="i" class="star" :style="{
              left: `${(i * 37) % 100}%`,
              top: `${(i * 23) % 50}%`,
              animationDelay: `${i * 0.2}s`,
              opacity: 0.3 + (i % 3) * 0.25
            }" />
          </template>
          
          <!-- Moon -->
          <div v-if="dayPhase === 'night'" class="moon">
            <span class="moon-crater c1" />
            <span class="moon-crater c2" />
            <span class="moon-crater c3" />
          </div>
          
          <!-- Sun -->
          <div v-if="dayPhase !== 'night'" class="sun" :class="dayPhase" />
          
          <!-- Clouds -->
          <div class="clouds">
            <span class="cloud c1" />
            <span class="cloud c2" />
            <span class="cloud c3" />
          </div>
        </div>

        <!-- Hills -->
        <div class="hills">
          <div class="hill hill-1" />
          <div class="hill hill-2" />
          <div class="hill hill-3" />
        </div>

        <!-- Ground -->
        <div class="ground">
          <div class="ground-grass">
            <span v-for="i in 20" :key="i" class="grass-blade" :style="{
              left: `${i * 5}%`,
              height: `${8 + (i % 5) * 3}px`,
              animationDelay: `${i * 0.1}s`
            }" />
          </div>
        </div>

        <!-- Pixel Plants -->
        <div
          v-for="plant in plants"
          :key="plant.id"
          class="pixel-plant"
          :class="{ 'newly-planted': newlyPlanted.includes(plant.id), [plant.type]: true }"
          :style="plant.style"
        >
          <!-- Flower -->
          <template v-if="plant.type === 'flower'">
            <div class="pixel-stem" />
            <div class="pixel-leaf leaf-l" />
            <div class="pixel-leaf leaf-r" />
            <div class="pixel-flower-head">
              <span class="petal p1" />
              <span class="petal p2" />
              <span class="petal p3" />
              <span class="petal p4" />
              <span class="petal p5" />
              <span class="petal p6" />
              <span class="flower-center" />
            </div>
          </template>

          <!-- Sunflower -->
          <template v-else-if="plant.type === 'sunflower'">
            <div class="pixel-stem" />
            <div class="pixel-leaf leaf-l" />
            <div class="pixel-leaf leaf-r" />
            <div class="sunflower-head">
              <span class="seed-row r1" />
              <span class="seed-row r2" />
              <span class="seed-row r3" />
              <span class="seed-row r4" />
              <div class="sunflower-center" />
            </div>
          </template>

          <!-- Tulip -->
          <template v-else-if="plant.type === 'tulip'">
            <div class="pixel-stem" />
            <div class="tulip-head">
              <span class="tulip-petal p1" />
              <span class="tulip-petal p2" />
              <span class="tulip-petal p3" />
            </div>
          </template>

          <!-- Rose -->
          <template v-else-if="plant.type === 'rose'">
            <div class="pixel-stem" />
            <div class="pixel-leaf leaf-l" />
            <div class="pixel-leaf leaf-r" />
            <div class="rose-head">
              <span class="rose-petal rp1" />
              <span class="rose-petal rp2" />
              <span class="rose-petal rp3" />
              <span class="rose-petal rp4" />
              <span class="rose-center" />
            </div>
          </template>

          <!-- Cactus -->
          <template v-else-if="plant.type === 'cactus'">
            <div class="cactus-body">
              <span class="cactus-arm arm-l" />
              <span class="cactus-arm arm-r" />
              <span class="cactus-top" />
            </div>
            <div v-if="gardenStage >= 2" class="cactus-flower" />
          </template>

          <!-- Succulent -->
          <template v-else-if="plant.type === 'succulent'">
            <div class="succulent-base">
              <span class="succulent-leaf sl1" />
              <span class="succulent-leaf sl2" />
              <span class="succulent-leaf sl3" />
              <span class="succulent-leaf sl4" />
              <span class="succulent-leaf sl5" />
              <span class="succulent-leaf sl6" />
            </div>
          </template>
        </div>

        <!-- Fireflies -->
        <template v-if="dayPhase !== 'day'">
          <span v-for="i in 12" :key="i" class="firefly" :style="{
            left: `${(i * 23) % 100}%`,
            top: `${20 + (i * 17) % 50}%`,
            animationDelay: `${i * 0.3}s`
          }" />
        </template>

        <!-- Birds for day -->
        <template v-if="dayPhase === 'day'">
          <span v-for="i in 3" :key="i" class="bird" :style="{
            left: `${20 + i * 25}%`,
            top: `${15 + i * 5}%`,
            animationDelay: `${i * 0.5}s`
          }" />
        </template>
      </div>

      <p class="hint">Complete focus sessions to grow your garden ✨</p>
    </section>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Press+Start+2P&display=swap');

:root {
  --bg-dark: #0c1222;
  --bg-panel: rgba(255,255,255,0.06);
  --accent-green: #22c55e;
  --accent-glow: rgba(34,197,94,0.4);
  --text-primary: #f0f4f8;
  --text-secondary: #94a3b8;
}

:global(body) {
  margin: 0;
  font-family: 'Outfit', sans-serif;
  background: var(--bg-dark);
  color: var(--text-primary);
}

.app {
  min-height: 100vh;
  display: grid;
  gap: 1.25rem;
  grid-template-columns: 1fr;
  padding: 1rem;
  transition: background 0.8s ease;
}

.app[data-phase='day'] { 
  background: linear-gradient(180deg, #1e3a5f 0%, #0f1f35 60%, #0a1425 100%);
}
.app[data-phase='sunset'] { 
  background: linear-gradient(180deg, #2d1f4a 0%, #1a1435 60%, #0d0a1f 100%);
}
.app[data-phase='night'] { 
  background: linear-gradient(180deg, #0a1020 0%, #040810 60%, #020408 100%);
}

@media (min-width: 980px) {
  .app {
    grid-template-columns: 1fr 1.3fr;
    padding: 1.5rem;
    gap: 2rem;
  }
}

.panel {
  background: linear-gradient(145deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 24px;
  padding: 1.5rem;
  backdrop-filter: blur(20px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: linear-gradient(135deg, rgba(34,197,94,0.25) 0%, rgba(16,185,129,0.15) 100%);
  color: #86efac;
  border: 1px solid rgba(134,239,172,0.3);
  border-radius: 999px;
  padding: 0.35rem 0.85rem;
  font-size: 0.9rem;
  font-weight: 600;
}

h1, h2 { margin: 0; font-weight: 800; }

h1 {
  font-size: 1.75rem;
  background: linear-gradient(135deg, #fff 0%, #c7d2fe 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

h2 {
  font-size: 1.3rem;
  color: #e2e8f0;
}

.subtitle {
  margin: 0.4rem 0 1rem;
  color: #94a3b8;
  font-size: 0.95rem;
}

.timer-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 1.5rem 0;
}

.timer-glow {
  position: absolute;
  width: 220px;
  height: 220px;
  background: radial-gradient(circle, rgba(34,197,94,0.2) 0%, transparent 70%);
  border-radius: 50%;
  animation: pulse-glow 3s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { transform: scale(1); opacity: 0.5; }
  50% { transform: scale(1.15); opacity: 1; }
}

.timer {
  font-size: clamp(3rem, 12vw, 5.5rem);
  font-weight: 800;
  letter-spacing: 6px;
  font-variant-numeric: tabular-nums;
  color: #fff;
  text-shadow: 0 0 50px rgba(34,197,94,0.5);
  position: relative;
  z-index: 1;
}

.controls, .presets {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
  justify-content: center;
}

button {
  border: 1px solid rgba(255,255,255,0.15);
  background: linear-gradient(145deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.03) 100%);
  color: #e2e8f0;
  padding: 0.7rem 1.2rem;
  border-radius: 14px;
  cursor: pointer;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

button:hover {
  background: linear-gradient(145deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.08) 100%);
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.3);
}

.primary {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  border: none;
  color: white;
  padding: 0.7rem 1.8rem;
  box-shadow: 0 4px 24px rgba(34,197,94,0.4);
}

.primary:hover {
  background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
  box-shadow: 0 6px 28px rgba(34,197,94,0.5);
}

.inputs {
  margin-top: 1rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.8rem;
}

label {
  display: grid;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: #94a3b8;
}

input, select {
  width: 100%;
  padding: 0.65rem;
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.12);
  background: rgba(15,23,42,0.6);
  color: #f1f5f9;
  font-family: inherit;
  font-size: 1rem;
}

input:focus, select:focus {
  outline: none;
  border-color: rgba(34,197,94,0.5);
}

.audio-box {
  margin-top: 1rem;
  display: grid;
  gap: 0.5rem;
}

.audio-btn { width: fit-content; justify-self: center; }

/* Stats */
.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-top: 1rem;
}

.stat {
  background: linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  padding: 0.8rem;
  text-align: center;
  transition: transform 0.2s;
}

.stat:hover { transform: translateY(-2px); }

.stat-value {
  display: block;
  font-size: 1.5rem;
  font-weight: 800;
  color: #f8fafc;
}

.stat-label {
  color: #64748b;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stage-info {
  display: flex;
  justify-content: space-between;
  margin-top: 1rem;
  color: #94a3b8;
  font-size: 0.85rem;
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
  transition: width 0.5s ease;
  box-shadow: 0 0 12px rgba(34,197,94,0.5);
}

/* Garden Canvas */
.garden-canvas {
  position: relative;
  height: 320px;
  margin-top: 1.25rem;
  border-radius: 20px;
  overflow: hidden;
  background: linear-gradient(180deg, transparent 0%, transparent 35%, #1a3a25 60%, #0d2818 100%);
  border: 1px solid rgba(255,255,255,0.12);
}

/* Sky */
.sky {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.star {
  position: absolute;
  width: 2px;
  height: 2px;
  background: #fff;
  border-radius: 50%;
  animation: twinkle 2s ease-in-out infinite;
}

@keyframes twinkle {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}

.moon {
  position: absolute;
  top: 25px;
  right: 35px;
  width: 44px;
  height: 44px;
  background: radial-gradient(circle at 30% 30%, #fefce8, #fef08a);
  border-radius: 50%;
  box-shadow: 0 0 30px rgba(254,240,138,0.6), inset -8px -8px 12px rgba(0,0,0,0.1);
}

.moon-crater {
  position: absolute;
  background: rgba(0,0,0,0.1);
  border-radius: 50%;
}
.moon-crater.c1 { width: 8px; height: 8px; top: 10px; left: 12px; }
.moon-crater.c2 { width: 5px; height: 5px; top: 22px; left: 8px; }
.moon-crater.c3 { width: 6px; height: 6px; top: 18px; left: 26px; }

.sun {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  width: 56px;
  height: 56px;
  border-radius: 50%;
  transition: all 0.8s ease;
}

.sun.day {
  background: radial-gradient(circle at 30% 30%, #fef08a, #fbbf24);
  box-shadow: 0 0 50px rgba(251,191,36,0.6), 0 0 100px rgba(251,191,36,0.3);
}

.sun.sunset {
  background: radial-gradient(circle at 30% 30%, #fdba74, #f97316);
  box-shadow: 0 0 60px rgba(249,115,22,0.6);
}

.clouds {
  position: absolute;
  inset: 0;
}

.cloud {
  position: absolute;
  background: rgba(255,255,255,0.2);
  border-radius: 50px;
  filter: blur(10px);
}

.cloud.c1 { width: 70px; height: 22px; top: 30px; left: -80px; animation: float 28s linear infinite; }
.cloud.c2 { width: 50px; height: 18px; top: 50px; left: -80px; animation: float 22s linear infinite 3s; }
.cloud.c3 { width: 60px; height: 20px; top: 70px; left: -80px; animation: float 25s linear infinite 8s; }

@keyframes float {
  from { transform: translateX(0); }
  to { transform: translateX(calc(100vw + 100px)); }
}

/* Hills */
.hills {
  position: absolute;
  bottom: 55px;
  left: 0;
  right: 0;
}

.hill {
  position: absolute;
  border-radius: 50%;
}

.hill-1 {
  width: 200px;
  height: 60px;
  background: #1a4a32;
  left: -20px;
  bottom: 0;
}

.hill-2 {
  width: 180px;
  height: 50px;
  background: #145028;
  right: -10px;
  bottom: 0;
}

.hill-3 {
  width: 150px;
  height: 40px;
  background: #0f3820;
  left: 30%;
  bottom: 0;
}

/* Ground */
.ground {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 55px;
  background: linear-gradient(180deg, #1a5c32 0%, #0d3a1f 50%, #082a16 100%);
}

.ground-grass {
  position: absolute;
  top: -8px;
  left: 0;
  right: 0;
  height: 12px;
}

.grass-blade {
  position: absolute;
  bottom: 0;
  width: 3px;
  background: linear-gradient(to top, #145028, #22c55e);
  border-radius: 3px 3px 0 0;
  transform-origin: bottom center;
  animation: grass-sway 2s ease-in-out infinite;
}

@keyframes grass-sway {
  0%, 100% { transform: rotate(-5deg); }
  50% { transform: rotate(5deg); }
}

/* Pixel Plants */
.pixel-plant {
  position: absolute;
  width: 32px;
  height: 60px;
  transition: all 0.5s ease;
}

.pixel-plant.newly-planted {
  animation: plant-spawn 1.5s ease-out forwards;
}

@keyframes plant-spawn {
  0% { transform: translateX(-50%) scale(0) translateY(30px); opacity: 0; }
  60% { transform: translateX(-50%) scale(1.1) translateY(0); opacity: 1; }
  100% { transform: translateX(-50%) scale(1) translateY(0); opacity: 1; }
}

/* Stem */
.pixel-stem {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 4px;
  height: 35px;
  background: linear-gradient(90deg, #15803d, #22c55e, #15803d);
  border-radius: 2px;
}

/* Leaves */
.pixel-leaf {
  position: absolute;
  width: 12px;
  height: 8px;
  background: #22c55e;
  border-radius: 50% 50% 50% 50%;
}

.leaf-l { left: 0; bottom: 15px; transform: rotate(-30deg); }
.leaf-r { right: 0; bottom: 20px; transform: rotate(30deg) scaleX(-1); }

/* Flower head */
.pixel-flower-head {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 24px;
  animation: flower-bob 3s ease-in-out infinite;
}

@keyframes flower-bob {
  0%, 100% { transform: translateX(-50%) rotate(-3deg); }
  50% { transform: translateX(-50%) rotate(3deg); }
}

.petal {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50% 50% 50% 50%;
  background: linear-gradient(135deg, #f472b6, #ec4899);
}

.p1 { top: 0; left: 50%; transform: translateX(-50%); }
.p2 { top: 4px; right: 0; }
.p3 { bottom: 4px; right: 0; }
.p4 { bottom: 0; left: 50%; transform: translateX(-50%); }
.p5 { bottom: 4px; left: 0; }
.p6 { top: 4px; left: 0; }

.flower-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 8px;
  height: 8px;
  background: #fbbf24;
  border-radius: 50%;
}

/* Sunflower */
.sunflower-head {
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%);
  width: 28px;
  height: 28px;
}

.seed-row {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 3px;
  background: #854d0e;
  border-radius: 2px;
}

.r1 { top: 2px; }
.r2 { top: 7px; width: 24px; }
.r3 { top: 12px; width: 22px; }
.r4 { top: 17px; width: 16px; }

.sunflower-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 14px;
  height: 14px;
  background: linear-gradient(135deg, #78350f, #451a03);
  border-radius: 50%;
}

/* Tulip */
.tulip-head {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 22px;
}

.tulip-petal {
  position: absolute;
  bottom: 0;
  width: 10px;
  height: 18px;
  border-radius: 50% 50% 40% 40%;
}

.tulip-petal.p1 { left: 50%; transform: translateX(-50%); background: linear-gradient(to top, #f43f5e, #fb7185); }
.tulip-petal.p2 { left: 0; background: linear-gradient(to top, #e11d48, #f43f5e); transform: rotate(-15deg); }
.tulip-petal.p3 { right: 0; background: linear-gradient(to top, #e11d48, #f43f5e); transform: rotate(15deg) scaleX(-1); }

/* Rose */
.rose-head {
  position: absolute;
  top: -2px;
  left: 50%;
  transform: translateX(-50%);
  width: 22px;
  height: 22px;
}

.rose-petal {
  position: absolute;
  background: linear-gradient(135deg, #dc2626, #b91c1c);
  border-radius: 50%;
}

.rp1 { width: 10px; height: 10px; top: 2px; left: 6px; }
.rp2 { width: 8px; height: 8px; top: 6px; left: 2px; }
.rp3 { width: 8px; height: 8px; top: 6px; right: 2px; }
.rp4 { width: 6px; height: 6px; bottom: 4px; left: 8px; }

.rose-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 6px;
  height: 6px;
  background: #7f1d1d;
  border-radius: 50%;
}

/* Cactus */
.cactus-body {
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 18px;
  height: 45px;
  background: linear-gradient(90deg, #166534, #22c55e, #166534);
  border-radius: 8px 8px 4px 4px;
}

.cactus-arm {
  position: absolute;
  width: 10px;
  height: 20px;
  background: linear-gradient(90deg, #166534, #22c55e);
  border-radius: 5px;
}

.arm-l { left: -8px; bottom: 15px; border-radius: 5px 0 0 5px; }
.arm-r { right: -8px; bottom: 20px; border-radius: 0 5px 5px 0; }

.cactus-top {
  position: absolute;
  top: -3px;
  left: 50%;
  transform: translateX(-50%);
  width: 14px;
  height: 6px;
  background: #22c55e;
  border-radius: 50%;
}

.cactus-flower {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 10px;
  height: 10px;
  background: radial-gradient(circle, #f472b6, #ec4899);
  border-radius: 50%;
}

/* Succulent */
.succulent-base {
  position: absolute;
  bottom: 5px;
  left: 50%;
  transform: translateX(-50%);
  width: 28px;
  height: 20px;
}

.succulent-leaf {
  position: absolute;
  width: 12px;
  height: 14px;
  background: linear-gradient(135deg, #6ee7b7, #34d399);
  border-radius: 50% 50% 50% 50%;
}

.sl1 { top: 0; left: 50%; transform: translateX(-50%); }
.sl2 { top: 4px; left: 2px; }
.sl3 { top: 4px; right: 2px; }
.sl4 { top: 10px; left: 0; }
.sl5 { top: 10px; right: 0; }
.sl6 { bottom: 0; left: 50%; transform: translateX(-50%); }

/* Fireflies */
.firefly {
  position: absolute;
  width: 4px;
  height: 4px;
  background: #fef08a;
  border-radius: 50%;
  box-shadow: 0 0 8px #fef08a, 0 0 16px #fef08a;
  animation: firefly 4s ease-in-out infinite;
}

@keyframes firefly {
  0%, 100% { opacity: 0; transform: scale(0.5); }
  25% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.8); }
  75% { opacity: 1; transform: scale(1.2); }
}

/* Birds */
.bird {
  position: absolute;
  width: 12px;
  height: 6px;
  animation: bird-fly 8s ease-in-out infinite;
}

.bird::before, .bird::after {
  content: '';
  position: absolute;
  width: 8px;
  height: 6px;
  border: 2px solid rgba(255,255,255,0.6);
  border-radius: 50% 50% 0 0;
  border-bottom: none;
}

.bird::before { left: 0; animation: wing-flap 0.3s ease-in-out infinite; }
.bird::after { right: 0; animation: wing-flap 0.3s ease-in-out infinite 0.15s; }

@keyframes bird-fly {
  0%, 100% { transform: translateX(0) translateY(0); }
  50% { transform: translateX(30px) translateY(10px); }
}

@keyframes wing-flap {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-20deg); }
}

.hint {
  margin-top: 1rem;
  color: #64748b;
  font-size: 0.85rem;
  text-align: center;
}
</style>
