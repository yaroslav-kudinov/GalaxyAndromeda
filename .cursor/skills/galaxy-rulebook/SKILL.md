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

- Shield absorb 4+2 points
- Priority skip: battleship cost 9+1=10
- Production by region size
- Hyper fireRange [2, 3] (not adjacent)
- Bombardment: defender does not roll
