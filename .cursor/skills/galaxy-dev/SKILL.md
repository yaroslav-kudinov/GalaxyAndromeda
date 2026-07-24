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
