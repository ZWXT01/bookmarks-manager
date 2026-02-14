# Repository Guidelines

## Project Structure & Module Organization
- `src/`: TypeScript backend source.
- `src/index.ts`: app bootstrap, plugin registration, auth hooks, and core endpoints.
- `src/routes/`: modular route handlers (`bookmarks`, `categories`, `check`, `jobs`, `import`, etc.).
- `src/*.ts` (non-routes): domain services (DB, auth, jobs queue, importer/exporter, AI flows).
- `views/`: EJS templates for server-rendered pages.
- `public/`: frontend assets (`app.js`, `app.css`, vendor libs).
- `tests/`: Vitest test suites (`*.test.ts`) and DB helpers.
- `extension-new/`: browser extension source (manifest, popup, content scripts).
- `data/`: runtime SQLite DB and backups (local/dev only).

## Build, Test, and Development Commands
- `npm run dev`: run server in watch mode via `tsx`.
- `npm run build`: compile TypeScript to `dist/`.
- `npm start`: run compiled app (`dist/index.js`).
- `npm test`: run Vitest once.
- `npm run test:watch`: run tests in watch mode.
- `docker compose up -d --build`: containerized local deployment.

## Coding Style & Naming Conventions
- Language: TypeScript (strict mode enabled).
- Follow existing style in touched files (indentation varies across modules; do not reformat unrelated code).
- Prefer small route modules under `src/routes/` and reusable logic in service files.
- Use descriptive camelCase for variables/functions; PascalCase for types/interfaces.
- Keep API error messages stable and explicit.
- No formal formatter/linter is configured; keep changes minimal and consistent.

## Testing Guidelines
- Framework: Vitest (`vitest.config.ts`).
- Test files: `tests/**/*.test.ts`.
- Add/update tests for behavior changes, especially around DB schema, routes, jobs, and import/export logic.
- Run `npm test` and `npm run build` before opening a PR.
- Prefer `tests/helpers/db.ts`; avoid adding new compiled `.js` test artifacts.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history: `feat: ...`, `fix: ...`, `docs: ...`.
- Keep commits focused by concern (e.g., route fix vs schema migration).
- PRs should include:
  - clear summary and motivation,
  - key API/UI behavior changes,
  - test evidence (`npm test`, `npm run build`),
  - screenshots for UI changes (`views/` / `public/`),
  - migration or config notes if DB/env behavior changes.

## Security & Configuration Tips
- Configure secrets with env vars (`SESSION_SECRET`, `API_TOKEN`, AI credentials); never commit secrets.
- Default credentials are for local bootstrap only; change in real deployments.
- Validate redirect targets and auth-sensitive route changes carefully.
