# Agent smoke tests

End-to-end flow (Batch 3):

1. Start `@galaxy/server`
2. Run MCP tool `game_create_room`
3. `game_join_room` + `game_get_state` (verify `geometry.asciiMap`)
4. `game_submit_action`

Script: `run-smoke.ts` (to be added in agent/harness-smoke worktree).
