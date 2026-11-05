# Contributing to NeoText

Thank you for helping. This page is for a developer who has not seen the code before. It says how to run the project, where things live, how to add the common kinds of things, and what must pass before a change is merged.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Found a security problem? Do not open an issue; follow [SECURITY.md](SECURITY.md).

## Set up

You need Node.js 24.7 or newer (NeoText uses the built-in Argon2 in `node:crypto`) and git. npm workspaces are used; there is no pnpm or bun requirement.

```bash
git clone <repository address> neotext
cd neotext
npm ci --ignore-scripts
npm run dev
```

Use `--ignore-scripts`. better-sqlite3 ships ready-made binaries; without the flag npm tries to compile it and fails when no C++ build tools are installed.

`npm run dev` starts the API on <http://localhost:3420> and the web app with hot reload on <http://localhost:5173>, which proxies `/api`. Open the 5173 address. The first visit shows the setup page. Settings live in an optional `.env` (copy `.env.example`; it is ignored by git, and you must never commit it).

You do not need a real model provider to work on most things. The tests run against a mock provider. If you want to try a real one, add an OpenRouter key in Settings, Providers.

Other commands you will use:

| Command | What it does |
|---|---|
| `npm run lint` | Biome (format and lint), the file-size rule, and a scan for key-shaped strings in tracked files |
| `npm run typecheck` | TypeScript in every workspace |
| `npm test` | Unit and integration tests in every workspace |
| `npm run test:e2e` | Browser tests with Playwright (builds the web app first) |
| `npm run build` | Production build of the web app |
| `npm run check:bundle` | Fails if the initial JavaScript is over the ceiling (see Performance) |
| `npm run bench` | Measures server latency and login time against the budgets |
| `npm run format` | Applies Biome formatting |
| `npm start` | Runs the built app the way a user does |

## Where things live

```
apps/server/     @neotext/server   Hono API, SSE, providers, tools, crypto, SQLite with Drizzle
apps/web/        @neotext/web      React 19 single-page app, CSS Modules with design tokens
packages/shared/ @neotext/shared   Zod schemas and types both sides use, the SSE parser,
                                   conversation-tree helpers, URL normalization, settings schema
scripts/         dev, start, size checks, bench, screenshots
docs/            QA checklist, images, the design spec and plans under docs/superpowers
```

The rules that keep the code easy to change:

1. `apps/web` and `apps/server` never import each other. Both import `@neotext/shared`, which is plain TypeScript source (no build step).
2. Inside the server, routes call services, services call repos, and repos are the only code that touches Drizzle tables.
3. Each feature folder owns its own routes, service, repo and tests, with tests next to the code as `*.test.ts`. Server features are folders such as `auth`, `chat`, `providers`, `tools`, `settings`, `transfer`, `admin`, `quotas`. Web features are under `apps/web/src/features`.
4. User content is sealed with the user's data key before it is written, bound to its table, column and row. A row copied to a new id is sealed again under the new id. Follow an existing repo, such as `apps/server/src/chat/messages-repo.ts`, before writing a new one.
5. Every visible string goes through i18n, in English and Indonesian.
6. UI uses the design tokens and the primitives in `apps/web/src/ui`. No cards with shadows, no gradients, no all-caps labels. Everything works with the keyboard, focus is visible, and reduced motion is respected.

The design reasoning is in `docs/superpowers/specs/2026-11-03-neotext-design.md` (the module rules are in section 5, the interface direction in 12, security in 7).

### File size

Source files are at most 400 lines and test files at most 500. `npm run lint` enforces it (`scripts/check-file-size.mjs`; it ignores `node_modules`, `dist`, `drizzle` and `locales`). When a file grows past the limit, split it by responsibility rather than trimming comments.

## How to add things

### A provider adapter

NeoText ships two: OpenRouter, and a generic OpenAI-compatible one that covers Ollama, LM Studio, vLLM and the like. A new one is only needed for an API that is not OpenAI-compatible.

1. Add the kind to `ProviderKindSchema` in `packages/shared/src/providers.ts`.
2. Create `apps/server/src/providers/<name>/adapter.ts` that implements `ProviderAdapter` from `providers/types.ts`: `listModels`, `streamChat` (yield the shared stream events), `test` and `warm`. Look at `openai-compatible/adapter.ts` and its `chunk-mapper.ts` for the shape.
3. Register it in `providers/registry.ts`.
4. Add the service choice to the provider form in `apps/web/src/features/settings/sections/ProviderForm.tsx` and the strings to both locale files.
5. Test it against the local mock provider (`apps/server/test-support/mock-provider.ts`), replaying streams you recorded from the real API into `apps/server/test-support/fixtures/*.sse`. Recorded fixtures keep the tests honest. Remove keys and personal text from them first.

### A tool

Tools are `ToolDefinition` objects (`apps/server/src/tools/types.ts`): a name, a description, a JSON Schema for the arguments, a `defaultPolicy` (`auto`, `ask` or `off`), and an `execute` function that returns text. Treat everything a tool returns as untrusted text from the outside world.

1. Write the tool in `apps/server/src/tools/builtin/`, with its test beside it. Tools that fetch from the network must use the guarded HTTP client (`ctx.http` in `ToolContext`), never `fetch` directly, so private addresses stay blocked.
2. Offer it through a `ToolSource` and add the source in `apps/server/src/container.ts` next to `fetchUrlSource`.
3. Pick the safest default policy. Anything that writes, or that sends data somewhere, should be `ask`.
4. Add the display name and description to both locale files so Settings, Tools can show it.

### A settings field

Settings are stored per user as one versioned document. The schema is in `packages/shared/src/settings/schema.ts`. Reading is lenient: an invalid field falls back to its default and the rest survives, so an old or hand-edited document never locks anyone out.

- **Adding a field needs no migration.** Add it with `leaf(...)` and a default to the right section, add the control to the settings page, and add the strings in both locales. Old documents get the default.
- **Renaming, moving or removing a field, or changing its meaning, needs a migration.** Raise `SETTINGS_SCHEMA_VERSION`, add a pure function to `SETTINGS_MIGRATIONS` in `packages/shared/src/settings/migrations.ts` (keyed by the version it migrates from), and add a test in `migrations.test.ts` that starts from a stored document of the old version and checks the result. Never edit the old fixture to make a test pass. The server keeps a copy of the settings before it migrates them.

### A database change

Edit the tables in `apps/server/src/db/schema/`, then generate the migration with `npm run db:generate -w @neotext/server -- --name <short_name>`. Never edit a generated migration or the snapshots by hand. Upgrading from the first schema is tested in `apps/server/src/db/upgrade.test.ts`; add to it if your change needs data carried across.

### A language

1. Copy `apps/web/src/lib/i18n/locales/en.json` to `<code>.json` and translate every value. Keep the `{{placeholders}}` as they are. Match the tone of the existing Indonesian file: plain, friendly, sentence case, "kamu" and not "Anda".
2. Add the code to `Locale` and the loader table in `apps/web/src/lib/i18n/index.ts`, to the `locale` setting in `packages/shared/src/settings/schema.ts`, and to the language choice in `GeneralSettings.tsx`.
3. `npm test -w @neotext/web` runs a parity test that fails when a key is missing, empty, or has different placeholders.

## Tests

| Layer | Where | How to run |
|---|---|---|
| Unit and integration | next to the code, `*.test.ts` | `npm test`, or `npm run test -w @neotext/server -- <path>` |
| Server API | `createTestApp()` in `apps/server/test-support`, which runs the real app on a temporary data folder (its path has a space on purpose) with cheap password hashing and a fake clock | same |
| Web | Vitest, happy-dom, Testing Library, MSW, fake-indexeddb | `npm run test -w @neotext/web -- <path>` |
| Browser | `apps/web/e2e`, Playwright and Chromium against the built app and mock providers | `npm run test:e2e` (the first time, `npx playwright install chromium`) |
| Live | `apps/server/src/live/*.live.test.ts`, real OpenRouter calls | `npm run test:live` |

Live tests use the key in `OPENROUTER_API_KEY` from your local `.env`, cost a few cents, and skip themselves when there is no key. They never run in CI. Tests must not depend on the wall clock or sleeps: use the injected fake clock so they stay stable on a loaded machine.

Write the failing test first when you fix a bug. Use fake keys such as `sk-or-test-...` and never a real one anywhere.

## Performance

The budgets come from the design spec and are checked by scripts, so a regression fails a build instead of being noticed later. Numbers below were measured on the author's Windows 11 laptop, Node 24.14, for 0.1.0.

**Initial JavaScript.** `npm run build && npm run check:bundle` adds up the entry chunk, everything it imports statically and any script `index.html` loads outside the bundle, gzipped. The dynamic chunks (settings, syntax highlighting, math, the Indonesian strings, drag and drop, and others) are listed but not counted.

| | Gzip |
|---|---|
| Target in the spec | 180 KiB |
| CI ceiling (`CEILING_KIB` in `scripts/check-bundle-size.mjs`) | 330 KiB |
| Measured at 0.1.0 | 326.6 KiB |

The target is not met. About 165 KiB of the total is the framework floor (React, the router, the data library, radix); the rest is the chat route. Until it is cut further, CI enforces the ceiling so the number can only go down. Whenever you make it smaller, lower `CEILING_KIB` to just above the new size. Reaching the 180 KiB target is a known gap.

**Server latency.** `npm run bench` (about 70 seconds) starts the real server as a child process with production settings, plays 50 chat turns against an in-process mock provider, and times five sign-ins with the production password hashing (64 MiB, 2 passes). It fails when a budget is missed. `PERF_SLACK=2` doubles the budgets, which CI does for the browser tests because its runners are slower.

| Metric | p50 | p95 | Budget |
|---|---|---|---|
| Send received to provider request sent | 10.0 ms | 12.4 ms | p95 at most 15 ms |
| Provider first token to client first token | 4.0 ms | 5.5 ms | p95 at most 30 ms |
| Sign-in (slowest of 5) | 338 ms | 386 ms | at most 600 ms |

These are from a run on a quiet machine. The first send-to-provider number is the one that moves with load: on the same laptop with many other programs running, its p95 read 19 to 21 ms (p50 stayed near 10 ms) and the 15 ms budget was missed, while the other two stayed far inside theirs. Run `npm run bench` with nothing else busy, and use `PERF_SLACK=2` (as CI does) on a loaded or shared machine, where it passes with room (p95 19.7 ms against 30 ms).

**Browser.** `apps/web/e2e/perf.spec.ts` seeds 5,000 chats and a 200-message chat and checks that opening a cached long chat paints within 100 ms, that the sidebar stays virtualized with 5,000 chats, that streaming causes no long tasks, and that streamed responses are not compressed.

**Database.** `apps/server/src/db/query-plans.test.ts` fills a database with 5,000 chats and 20,000 usage events and asserts that each hot query uses an index and never scans a whole table. The plans at 0.1.0:

| Query | Plan |
|---|---|
| Recent chats | search `conversations` using `conversations_list_idx` (user, deleted, archived) |
| Pinned chats | search `conversations` using `conversations_pinned_idx` (user, pinned), sorted in a temporary tree |
| Messages of a chat | search `messages` using `messages_conversation_idx`, sorted in a temporary tree |
| Usage by user and time | search `usage_events` using `usage_events_user_idx` (user, created range) |

A page of 50 from the 5,000 chats takes about 2 ms (the test allows 50 ms).

When you add a query that runs on a hot path, add it to that test. Do not relax a budget to make a failing check pass; fix the cause.

## Commits and pull requests

- Commit messages follow the style of the history: a short type prefix and a plain summary in the imperative, such as `feat: add invite-based registration`, `fix: close the personal-mode sign-up gap`, `perf: split heavy dependencies out of the entry bundle`, `test(server): add security inventory checks`, `docs: ...`, `refactor: ...`. Add the scope in brackets when it helps.
- Keep a commit to one change. Do not mix a refactor with a behaviour change.
- Before you open a pull request, run `npm run lint`, `npm run typecheck` and `npm test`. For UI changes run `npm run test:e2e` and look at the result in a browser, in both themes, and at phone width.
- Fill in the pull request template. Say what changed and why, and how you checked it. Add a screenshot for visible changes.
- New or changed text appears in both `en.json` and `id.json`.
- CI runs lint, types and unit tests on Linux and Windows, the browser tests, the bundle budget and a Docker build. All must pass.
- Update `CHANGELOG.md` under "Unreleased" for anything a user would notice.
