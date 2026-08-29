---
name: galaxy-dev
description: Develop Galaxy Andromeda monorepo features. Use when editing packages/rules, server, client, or monorepo structure.
---

# Galaxy Dev

Read [AGENTS.md](../../AGENTS.md) and [docs/architecture.md](../../docs/architecture.md) first.

## Structure

- `@galaxy/rules` — pure TS, no IO
- `@galaxy/server` — Fastify port 3001
- `@galaxy/client` — Nuxt SPA port 3000
- Sync mechanics with [docs/rulebook.md](../../docs/rulebook.md) and `packages/rules/data/ships.yaml`

## Commands

```bash
pnpm dev
pnpm test
pnpm typecheck
```

## Rules

- Do not change `packages/rules/src/types.ts` without ADR in `docs/decisions/`
- Update `docs/changelog.md` when done
- After project changes write `docs/patch-notes/YYYY-MM-DD-slug.md`. Follow `.cursor/rules/patch-notes.mdc` (human Russian for the player, glossary, no abbreviations in Суть / Правила / UI)

## Client audio

- Interface SFX: `packages/client/public/sounds/`, composable `useGameSfx.ts`, mute key `galaxy-sfx-muted`
- Background soundtrack: `packages/client/public/audio/` — in-game playlist (`strategium.mp3`, `strategium-ii.mp3`, `cold-calculation.mp3`, `cosmic-minimalism.mp3`, `cosmic-minimalism-ii.mp3`, `whisper-of-intrigue.mp3`, `wreckage-of-the-throne.mp3`, `shadow-of-war.mp3`, `data-sync.mp3`, `technological-breakthrough.mp3`), composable `useBackgroundMusic.ts`, panel `SoundtrackPanel.vue` on `/game/:roomId` (header + room lobby). Transport: pause/play (`userPaused`, distinct from mute), seek via `audio.currentTime` / `timeupdate` / `duration` (`utils/track-time.ts`). Mute uses `audio.muted` (clock keeps running). Volume slider is behind a «Громкость» disclosure. Prefs key `galaxy-music-prefs` (volume 0–100, mute, shuffle, repeat playlist/one, excluded ids); legacy `galaxy-music-muted`. Pause and seek position are not persisted. Default shuffle on, playlist loop, modest volume. SFX mute stays `galaxy-sfx-muted`. Both this playlist and the landing theme pause on `document.hidden` (`utils/page-visibility-audio.ts`); resume when visible if the user did not pause (mute may still be on). Do not default-mute visible tabs.
- Landing theme (home `/` only): `wreckage-of-the-throne.mp3` loop via `useLandingMusic.ts` / `LandingMusicControl.vue`. Independent prefs `galaxy-landing-music-prefs` (`muted`, `volume`). Pauses when leaving `/` so it does not overlap the in-game playlist. Same hidden-tab pause as the in-game playlist.
- **IDE browser:** before interacting with localhost in Cursor’s browser, mute soundtrack (`galaxy-music-prefs.muted` + `galaxy-music-muted`), landing theme (`galaxy-landing-music-prefs.muted`), and SFX (`galaxy-sfx-muted`); pause `audio` elements. Do not change the player default to muted. After verification, close leftover tabs (blank, duplicate localhost, finished rooms). See `.cursor/rules/browser-verify-quiet.mdc`.
