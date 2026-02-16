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
  const scale = 0.85 + ((index * 11) % 3) * 0.15
  const bottom = 28 + ((index * 7) % 8)
  return {
    left: `${left}%`,
    bottom: `${bottom}%`,
    transform: `translateX(-50%) scale(${scale})`,
    animationDelay: `${index * 0.1}s`,
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

  // Mark new plants for animation
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
      <div class="brand">Focus Garden</div>
      <h1>{{ mode === 'focus' ? 'Focus Time' : 'Break Time' }}</h1>
      <p class="subtitle">Grow your garden, grow your focus 🌱</p>

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
        <label for="station">Lo-fi Ambiance</label>
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
      <h2>Your Garden</h2>
      <div class="stats">
        <div class="stat">
          <span class="stat-value">{{ garden.totalSessions }}</span>
          <span class="stat-label">Total Sessions</span>
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
        <!-- Stars for night phase -->
        <div v-if="dayPhase === 'night'" class="stars">
          <span v-for="i in 20" :key="i" class="star" :style="{ 
            left: `${(i * 17) % 100}%`, 
            top: `${(i * 23) % 60}%`,
            animationDelay: `${i * 0.3}s`
          }" />
        </div>
        
        <!-- Moon for night -->
        <div v-if="dayPhase === 'night'" class="moon" />
        
        <!-- Sun for day/sunset -->
        <div v-if="dayPhase !== 'night'" class="sun" :class="dayPhase" />
        
        <!-- Clouds -->
        <div class="clouds">
          <span class="cloud c1" />
          <span class="cloud c2" />
        </div>

        <!-- Ground/grass -->
        <div class="ground">
          <div class="grass-layer" />
          <div class="grass-layer grass-2" />
        </div>

        <!-- Plants -->
        <div
          v-for="i in plantCount"
          :key="i"
          class="plant"
          :class="{ 'newly-planted': newlyPlanted.includes(i-1) }"
          :style="makePlantStyle(i)"
          :data-stage="Math.min(gardenStage, 4)"
        >
          <svg viewBox="0 0 64 128" class="plant-svg">
            <!-- Pot -->
            <path d="M20 110 L24 125 L40 125 L44 110 Z" fill="#8B4513" />
            <ellipse cx="32" cy="110" rx="14" ry="4" fill="#A0522D" />
            
            <!-- Stem -->
            <path d="M32 108 Q34 80 32 50" stroke="#2D5A27" stroke-width="4" fill="none" stroke-linecap="round" />
            
            <!-- Leaves based on stage -->
            <g v-if="gardenStage >= 1">
              <path d="M32 85 Q20 80 15 70 Q22 78 32 82" fill="#4CAF50" />
              <path d="M32 85 Q44 80 49 70 Q42 78 32 82" fill="#4CAF50" />
            </g>
            <g v-if="gardenStage >= 2">
              <path d="M32 65 Q18 60 12 48 Q22 58 30 62" fill="#66BB6A" />
              <path d="M32 65 Q46 60 52 48 Q42 58 34 62" fill="#66BB6A" />
            </g>
            <g v-if="gardenStage >= 3">
              <path d="M32 45 Q22 38 18 25 Q28 35 32 40" fill="#81C784" />
              <path d="M32 45 Q42 38 46 25 Q36 35 32 40" fill="#81C784" />
            </g>
            
            <!-- Flower/fruit based on stage -->
            <g v-if="gardenStage >= 2">
              <circle cx="32" cy="35" r="8" fill="#FFE082" />
              <circle cx="32" cy="35" r="5" fill="#FFB74D" />
            </g>
            <g v-if="gardenStage >= 4">
              <!-- Extra sparkle for max stage -->
              <circle cx="28" cy="30" r="2" fill="#FFF" class="sparkle" />
              <circle cx="38" cy="38" r="1.5" fill="#FFF" class="sparkle" style="animation-delay: 0.5s" />
            </g>
          </svg>
        </div>

        <!-- Fireflies for sunset/night -->
        <div v-if="dayPhase !== 'day'" class="fireflies">
          <span v-for="i in 8" :key="i" class="firefly" :style="{
            left: `${(i * 31) % 100}%`,
            top: `${30 + (i * 17) % 50}%`,
            animationDelay: `${i * 0.4}s`
          }" />
        </div>
      </div>

      <p class="hint">
        Complete focus sessions to grow your garden ✨
      </p>
    </section>
  </main>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap');

:global(body) {
  margin: 0;
  font-family: 'Outfit', ui-sans-serif, system-ui, -apple-system, sans-serif;
  background: #0a0e17;
  color: #f0f4f8;
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
  background: linear-gradient(180deg, #1a2a4a 0%, #0f1729 50%, #0a101c 100%);
}
.app[data-phase='sunset'] { 
  background: linear-gradient(180deg, #2d1f3d 0%, #1a1429 50%, #0f0d18 100%);
}
.app[data-phase='night'] { 
  background: linear-gradient(180deg, #0c1222 0%, #060912 50%, #030508 100%);
}

@media (min-width: 980px) {
  .app {
    grid-template-columns: 1fr 1.2fr;
    padding: 1.5rem;
    gap: 2rem;
  }
}

.panel {
  background: linear-gradient(145deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 24px;
  padding: 1.5rem;
  backdrop-filter: blur(20px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  background: linear-gradient(135deg, rgba(34,197,94,0.3) 0%, rgba(16,185,129,0.2) 100%);
  color: #86efac;
  border: 1px solid rgba(134,239,172,0.3);
  border-radius: 999px;
  padding: 0.35rem 0.85rem;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.5px;
}

h1, h2 {
  margin: 0;
  font-weight: 800;
}

h1 {
  font-size: 1.75rem;
  background: linear-gradient(135deg, #f0f9ff 0%, #c7d2fe 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

h2 {
  font-size: 1.4rem;
  color: #e2e8f0;
}

.subtitle {
  margin: 0.4rem 0 1.2rem;
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
  width: 200px;
  height: 200px;
  background: radial-gradient(circle, rgba(34,197,94,0.15) 0%, transparent 70%);
  border-radius: 50%;
  animation: pulse-glow 3s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.1); opacity: 1; }
}

.timer {
  font-size: clamp(3rem, 12vw, 5.5rem);
  font-weight: 800;
  letter-spacing: 4px;
  font-variant-numeric: tabular-nums;
  color: #f8fafc;
  text-shadow: 0 0 40px rgba(34,197,94,0.4);
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
  background: linear-gradient(145deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%);
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
  background: linear-gradient(145deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.1) 100%);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
}

.primary {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  border: none;
  color: white;
  padding: 0.7rem 1.8rem;
  box-shadow: 0 4px 20px rgba(34,197,94,0.4);
}

.primary:hover {
  background: linear-gradient(135deg, #4ade80 0%, #22c55e 100%);
  box-shadow: 0 6px 24px rgba(34,197,94,0.5);
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
  transition: border-color 0.2s;
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

.audio-btn {
  width: fit-content;
  justify-self: center;
}

/* Garden Panel */
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

.stat:hover {
  transform: translateY(-2px);
}

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

.progress-text {
  color: #86efac;
}

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
  height: 300px;
  margin-top: 1.25rem;
  border-radius: 20px;
  overflow: hidden;
  background: linear-gradient(180deg, 
    transparent 0%, 
    rgba(59,130,246,0.1) 30%,
    rgba(16,185,129,0.15) 60%,
    rgba(34,197,94,0.2) 100%
  );
  border: 1px solid rgba(255,255,255,0.12);
}

/* Sky elements */
.stars {
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
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.moon {
  position: absolute;
  top: 20px;
  right: 30px;
  width: 40px;
  height: 40px;
  background: radial-gradient(circle at 30% 30%, #fef9c3, #fde047);
  border-radius: 50%;
  box-shadow: 0 0 30px rgba(253,224,71,0.5);
}

.sun {
  position: absolute;
  top: 15px;
  left: 50%;
  transform: translateX(-50%);
  width: 50px;
  height: 50px;
  border-radius: 50%;
  transition: all 0.8s ease;
}

.sun.day {
  background: radial-gradient(circle at 30% 30%, #fef08a, #fbbf24);
  box-shadow: 0 0 40px rgba(251,191,36,0.6);
}

.sun.sunset {
  background: radial-gradient(circle at 30% 30%, #fdba74, #f97316);
  box-shadow: 0 0 50px rgba(249,115,22,0.5);
}

.clouds {
  position: absolute;
  inset: 0;
}

.cloud {
  position: absolute;
  background: rgba(255,255,255,0.15);
  border-radius: 50px;
  filter: blur(8px);
  animation: float-cloud 20s linear infinite;
}

.cloud.c1 {
  width: 80px;
  height: 25px;
  top: 25px;
  left: -100px;
  animation-duration: 25s;
}

.cloud.c2 {
  width: 60px;
  height: 20px;
  top: 45px;
  left: -100px;
  animation-duration: 18s;
  animation-delay: 5s;
}

@keyframes float-cloud {
  from { transform: translateX(0); }
  to { transform: translateX(calc(100vw + 100px)); }
}

/* Ground */
.ground {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 70px;
  overflow: hidden;
}

.grass-layer {
  position: absolute;
  bottom: 0;
  left: -5%;
  width: 110%;
  height: 30px;
  background: linear-gradient(180deg, #22c55e 0%, #15803d 50%, #14532d 100%);
  border-radius: 50% 50% 0 0 / 100% 100% 0 0;
}

.grass-layer.grass-2 {
  bottom: 5px;
  height: 20px;
  background: linear-gradient(180deg, #16a34a 0%, #166534 100%);
  opacity: 0.7;
}

/* Plants */
.plant {
  position: absolute;
  width: 40px;
  height: 80px;
  transition: all 0.5s ease;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
}

.plant.newly-planted {
  animation: plant-grow 1.5s ease-out forwards;
}

@keyframes plant-grow {
  0% { 
    transform: translateX(-50%) scale(0) translateY(20px);
    opacity: 0;
  }
  50% {
    opacity: 1;
  }
  100% { 
    transform: translateX(-50%) scale(1) translateY(0);
    opacity: 1;
  }
}

.plant-svg {
  width: 100%;
  height: 100%;
  animation: gentle-sway 4s ease-in-out infinite;
}

@keyframes gentle-sway {
  0%, 100% { transform: rotate(-2deg); }
  50% { transform: rotate(2deg); }
}

.sparkle {
  animation: sparkle 1.5s ease-in-out infinite;
}

@keyframes sparkle {
  0%, 100% { opacity: 0.3; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.5); }
}

/* Fireflies */
.fireflies {
  position: absolute;
  inset: 0;
}

.firefly {
  position: absolute;
  width: 4px;
  height: 4px;
  background: #fef08a;
  border-radius: 50%;
  box-shadow: 0 0 10px #fef08a, 0 0 20px #fef08a;
  animation: firefly 3s ease-in-out infinite;
}

@keyframes firefly {
  0%, 100% { 
    opacity: 0; 
    transform: translate(0, 0) scale(0.5);
  }
  25% { 
    opacity: 1; 
    transform: translate(10px, -15px) scale(1);
  }
  50% { 
    opacity: 0.7; 
    transform: translate(-5px, -25px) scale(0.8);
  }
  75% { 
    opacity: 1; 
    transform: translate(15px, -10px) scale(1.2);
  }
}

.hint {
  margin-top: 1rem;
  color: #64748b;
  font-size: 0.85rem;
  text-align: center;
}
</style>
