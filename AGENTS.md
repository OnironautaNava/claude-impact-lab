# AGENTS.md

## Scope

- This file applies to the workspace root at `G:\Repos\claude-impact-lab`.
- The main product code lives in `smart-commute-cdmx/`.
- Root `package.json` is only a thin command launcher into `smart-commute-cdmx/`.
- For product work, prefer using `smart-commute-cdmx/` as the working directory.
- SDD work for the app should use `smart-commute-cdmx/.atl/skill-registry.md`.
- Treat root `/.atl/` as workspace-level metadata, not app-local implementation guidance.

## Repository Layout

- `package.json` - root command aliases.
- `smart-commute-cdmx/package.json` - actual app scripts.
- `smart-commute-cdmx/src/App.tsx` - main application shell and map logic.
- `smart-commute-cdmx/src/types.ts` - shared domain types.
- `smart-commute-cdmx/src/styles.css` - global styles and tokens.
- `smart-commute-cdmx/public/data/` - generated frontend data.
- `smart-commute-cdmx/scripts/` - Node and Python ETL scripts.

## Tooling Detected

- Frontend stack: React 18 + Vite 5 + TypeScript 5.
- Mapping: `maplibre-gl`; current app logic is mostly local React state.
- Package manager: `npm`; Python ETL deps: `pyproj`, `pyshp`.
- TypeScript compiler is strict.
- No ESLint, Prettier, Biome, Jest, Vitest, or Playwright config found.
- No test files were found.
- No Cursor rules found in `.cursor/rules/` or `.cursorrules`.
- No Copilot instructions found in `.github/copilot-instructions.md`.

## Install

Run from `smart-commute-cdmx/`:

```bash
npm install
python -m pip install -r requirements.txt
```

## Build, Dev, Typecheck, and Data Commands

Preferred working directory: `smart-commute-cdmx/`.

### App commands

```bash
npm run dev
npm run build
npm run preview
npm run typecheck
npm run generate:data
npm run generate:sprint1
npm run generate:multimodal
```

### Root aliases

```bash
npm run cdmx:dev
npm run cdmx:lint
npm run cdmx:test
npm run cdmx:test:run
npm run cdmx:test:single -- src/utils/formatting.test.ts
npm run cdmx:typecheck
npm run cdmx:generate:data
npm run cdmx:generate:sprint1
npm run cdmx:generate:multimodal
```

## Lint and Test Status

- Linting uses ESLint with flat config via `smart-commute-cdmx/eslint.config.js`.
- Testing uses Vitest via `smart-commute-cdmx/vitest.config.ts`.
- Current test files live under `smart-commute-cdmx/src/**/*.test.ts`.
- Safe validation commands are:

```bash
npm run lint
npm run test:run
npm run typecheck
```

- Prefer running `npm run lint`, `npm run test:run`, and `npm run typecheck` from `smart-commute-cdmx/`.

## Single-Test Guidance

- Single-file test execution is available with Vitest.
- Preferred app-level command:

```bash
npm run test:single -- src/utils/formatting.test.ts
```

- Equivalent direct Vitest command:

```bash
npx vitest run src/utils/formatting.test.ts
```

- If you need one named test inside a file, use:

```bash
npx vitest run src/utils/formatting.test.ts -t "formats percentages with one decimal place"
```

## Data / ETL Execution Notes

- ETL scripts resolve raw input data from `SMART_COMMUTE_DATA_DIR`, then `data-source.local`, then `../docs/data`.
- `npm run generate:data` uses `scripts/generate-mvp-data.mjs`.
- `npm run generate:sprint1` uses `scripts/generate-sprint1-artifacts.mjs`.
- `npm run generate:multimodal` uses `scripts/generate_multimodal_data.py`.
- ETL outputs land in `smart-commute-cdmx/public/data/`.
- Do not hardcode machine-specific absolute data paths in committed files.

## Code Style - General

- Use TypeScript and keep `strict` mode clean.
- Follow the existing semicolon-based style.
- Prefer single quotes in TS/TSX files.
- Keep trailing commas in multiline objects, arrays, params, and imports when the surrounding file uses them.
- Use `const` by default; use `let` only when mutation is required.
- Prefer small pure helpers for data transforms and derived calculations.
- Keep business/data logic outside JSX when possible.
- Avoid comments unless a block is genuinely non-obvious.

## Imports

- Group imports in this order:
  1. framework/vendor packages
  2. type-only vendor imports
  3. side-effect imports
  4. local type imports
  5. local value imports
- Use `import type` for type-only imports.
- Keep relative imports simple; there is no path alias configuration.
- Do not introduce barrel files unless there is a strong reason; the current app imports directly.

## Formatting and File Organization

- Match the existing 2-space JSON indentation and current TS/TSX formatting.
- Keep large TSX files ordered as helpers, components, then main export.
- Keep CSS organized by design tokens, reset, layout, then component sections.

## Types and Data Modeling

- Prefer explicit interfaces for app data contracts.
- Keep domain shapes centralized in `smart-commute-cdmx/src/types.ts` unless a type is hyper-local.
- Use literal unions for constrained states and tuple types for coordinate pairs.
- Prefer `Record<string, T>` only when keys are truly dynamic.
- Use `satisfies` when validating object shape without widening useful literal types.
- Keep non-null assertions narrow and obvious.

## Naming Conventions

- Components: `PascalCase`.
- Functions and variables: `camelCase`.
- Type aliases and interfaces: `PascalCase`.
- Constants: `camelCase` for most values, `UPPER_SNAKE_CASE` only for rare true constants.
- CSS classes: kebab-case.
- Prefer names that describe domain meaning, not UI implementation trivia.

## React and State Conventions

- Prefer functional components.
- Derive data with `useMemo` when the calculation is substantial or reused.
- Avoid redundant state when a value can be derived.
- Use refs for imperative MapLibre objects and DOM containers.
- Preserve existing accessibility attributes and semantic buttons.

## Error Handling and Async Work

- Fail loudly in ETL scripts when required input data is missing.
- In UI fetch flows, prefer graceful fallback behavior when alternate data sources exist.
- The current frontend loads `multimodal-data.json` first and falls back to `mvp-data.json`.
- Do not swallow errors silently; include actionable context.

## Working in This Repo

- Before editing, check whether the change belongs in the workspace root or in `smart-commute-cdmx/`.
- For frontend/product changes, prefer reading and editing files under `smart-commute-cdmx/` only.
- For data-pipeline changes, update the generating script and inspect the corresponding JSON outputs.
- Because there is no lint/test suite, be conservative with refactors and verify with `npm run typecheck`.

## Agent-Specific Notes

- There are no Cursor or Copilot rule files to merge into this document.
- Existing repository guidance from `CLAUDE.md` says app-specific SDD work should run from `smart-commute-cdmx/`.
- If you add linting or testing in the future, update this file with exact commands, including single-file and single-test invocation.
