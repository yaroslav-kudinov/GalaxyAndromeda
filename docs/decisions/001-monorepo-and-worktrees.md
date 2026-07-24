# ADR 001: Monorepo and git worktrees

## Status

Accepted

## Context

Multiple Cursor agents will develop rules, server, client, and harness in parallel.

## Decision

- pnpm monorepo with package boundaries
- Agent branches `agent/<scope>` in git worktrees
- Shared contracts in `packages/rules/src/types.ts` frozen unless ADR

## Consequences

- Less merge conflict when agents stay in scope
- Initial scaffold commit required before parallel work
