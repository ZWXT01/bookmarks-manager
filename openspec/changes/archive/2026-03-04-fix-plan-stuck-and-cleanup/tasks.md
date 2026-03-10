## Tasks

- [x] Task 1: Add plan_state_logs table to database schema (`src/db.ts`)
- [x] Task 2: Add timeout cleanup and logging to createPlan() (`src/ai-organize-plan.ts`)
- [x] Task 3: Add reason parameter and logging to transitionStatus() (`src/ai-organize-plan.ts`)
- [x] Task 4: Add getActivePlan() export function (`src/ai-organize-plan.ts`)
- [x] Task 5: Add GET /api/ai/organize/active route (`src/routes/ai.ts`)
- [x] Task 6: Add activePlanId to 409 response (`src/routes/ai.ts`)
- [x] Task 7: Frontend 409 recovery flow (`public/app.js`)
- [x] Task 8: Delete orphaned dist files
- [x] Task 9: Delete old JavaScript test files
- [x] Task 10: Remove unused helper functions from types.ts (`src/routes/types.ts`)
- [x] Task 11: Write tests for new functionality (`tests/ai-organize-plan.test.ts`)

## Dependency Order

```
Task 1 (DB schema)
  ├── Task 2 (createPlan timeout + logging) ── depends on Task 1
  ├── Task 3 (transitionStatus reason + logging) ── depends on Task 1
  └── Task 4 (getActivePlan) ── depends on Task 1
        ├── Task 5 (GET /active route) ── depends on Task 4
        └── Task 6 (409 activePlanId) ── depends on Task 2
              └── Task 7 (Frontend recovery) ── depends on Task 5, Task 6
Task 8 (Delete dist) ── independent
Task 9 (Delete tests) ── independent
Task 10 (Remove helpers) ── independent
Task 11 (Tests) ── depends on Task 1-4
```
