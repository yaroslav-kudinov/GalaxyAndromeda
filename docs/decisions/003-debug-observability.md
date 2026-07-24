# ADR 003: Debug observability — geometry-first strategy

## Status

Accepted

## Context

Pure JSON cell lists hinder LLM spatial strategy. Screenshots are heavy and unreliable.

## Decision

- `GameObservation` includes `geometry.asciiMap` and `geometry.spatialSummary` in every `game_get_state`
- Mechanics JSON for legal moves and combat numbers
- Screenshots/SVG only on explicit request or UI debugging via browser MCP

## Consequences

- `@galaxy/rules/src/observation/` renders ASCII maps
- `galaxy-play` skill instructs agents to read geometry first
