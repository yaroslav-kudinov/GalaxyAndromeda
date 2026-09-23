---
name: galaxy-rulebook
description: Game rules and balance for Galaxy Andromeda. Use when implementing or changing mechanics.
---

# Galaxy Rulebook

Source: [docs/rulebook.md](../../docs/rulebook.md)

Machine data: `packages/rules/data/ships.yaml`

When changing rules:

1. Update rulebook section
2. Update YAML data
3. Add vitest case from PDF examples
4. ADR if changing shared types

Key examples to test:

- Hit-based combat: each ship rolls its dice at its class threshold; hits apply simultaneously (ADR 018)
- Targets are chosen before every round (`diceTargets`); unassigned dice are auto-allocated
- Range from accuracy: +1 needed per hex, nothing above 6; hyper fires at 2–3 hexes only
- Hyper hull: 1 in battle on its cell, 2 under bombardment
- Siege: garrison rerolls misses one by one; tick loses one ship per turn (ADR 019)
- Doctrines: 3-turn windows, values in `packages/rules/src/doctrines.ts` (ADR 020)
- Bombardment: defender does not roll
