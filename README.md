# Focus Garden

A chill Nuxt web app that mixes:
- **Lo-fi focus timer** (Pomodoro style)
- **Tiny habit garden** that grows with completed sessions

## MVP features

- Focus/break timer (`25/5`, `50/10`, `90/20`, custom)
- Session persistence in localStorage
- Garden progression (stages + streak + daily sessions)
- Lo-fi / ambient audio options
- Mobile-friendly responsive UI

## Run locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm run preview
```

## Architecture (future-proof for mobile + Apple Watch)

Current app is intentionally client-first and simple. For future expansion:

1. **Shared domain model**
   - keep timer/session/garden logic isolated in composables or shared package
2. **API-ready persistence**
   - today: localStorage
   - next: sync API (sessions, streaks, garden state)
3. **Mobile app path**
   - Nuxt + Capacitor for iOS/Android wrapper
4. **Apple Watch path**
   - watchOS companion app that syncs via iPhone app/backend
   - reuse same session model/streak rules

## Codex + MCP setup used

Codex config (`~/.codex/config.toml`) includes optional MCP servers:
- `filesystem_focus_garden` (project file access)
- `github` (repo workflows, requires `GITHUB_TOKEN`)
- `playwright` (UI/browser task automation)

These are optional and can be enabled/disabled per environment.

## Stack

- Nuxt 4
- Vue 3 (script setup)
- Pure CSS (no UI kit yet)

---

Built with chill vibes ☕🌿
