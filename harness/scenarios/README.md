# Scenario JSON format

Scenarios live in `harness/scenarios/*.json`:

```json
{
  "name": "shield-absorb-example",
  "map": { "id": "test", "name": "Test", "cells": [] },
  "initialState": {},
  "actions": [],
  "assertions": []
}
```

Used by vitest and agent-smoke harness.
