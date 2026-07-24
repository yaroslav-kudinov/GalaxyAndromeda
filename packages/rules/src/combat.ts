/** Combat mechanics — implement in agent/rules-gameplay worktree */
export const COMBAT_STUB = true

export function rollD6(count = 1): number[] {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1)
}
