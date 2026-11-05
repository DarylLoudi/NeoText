# Changelog

All notable changes to NeoText are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/).

## Unreleased

Nothing yet.

## 0.1.0

The first release.

### Chat

- Chat with any model from OpenRouter (400+) or any OpenAI-compatible server, such as Ollama, LM Studio, vLLM and llama.cpp. Switch model in the middle of a chat.
- Answers keep streaming on the server when the tab closes, and the page resumes when you return. Stop keeps the partial answer.
- Branches: regenerate or edit a message and keep every version, with a switcher between them. Fork a chat from any message.
- Compare: send one prompt to up to four models side by side, then continue with the one you choose.
- Markdown with highlighted code (loaded on demand), math, safe links, and images that load only when you click.
- Reasoning blocks, tool call blocks, automatic chat titles, prompt snippets with variables.
- File attachments, encrypted at rest, with content checks.
- Prices on screen: the model sheet shows the price per million tokens before you send, and each message, chat and day shows its cost. A usage dashboard and budgets with warnings.

### Tools and search

- Web search with numbered citations, paginated source cards and an all-sources drawer. OpenRouter's native search, or SearXNG, Brave or Tavily for other models.
- Web page reading, with a guard against requests to private networks.
- MCP servers as a source of tools, with a policy per tool (`auto`, `ask`, `off`) and approval prompts.

### Your layout

- A sidebar you arrange: sections you order, hide or create (smart folders), on the left or right, with folders, pins and drag and drop.
- Themes (light, dark, system), accent colours, fonts, density, message width, rebindable keyboard shortcuts, a command palette, full-text search over your encrypted chats.
- Presets: a saved system prompt, model and defaults.
- English and Bahasa Indonesia.
- Settings are saved on the server in versions (the last 50 are kept) that you can restore. A bad field never wipes the rest.

### Data and safety

- Chats, titles, settings, attachments and provider keys are encrypted at rest with a key that your password (or recovery key) unlocks. See `SECURITY.md`.
- Trash with restore (30 days), automatic database backups, and a backup before every database upgrade.
- Import from ChatGPT and Claude exports and from NeoText files. Export your data as an encrypted NeoText file, Markdown or JSON.
- Sessions list with sign-out for other devices, and an audit log of account events.

### Community mode

- Invite-based registration (also closed or open), roles, and an admin panel for users, invites and instance settings.
- Providers an admin shares with everyone, with the key hidden from members.
- Per-user daily and monthly budgets on shared models.
- Optional password escrow, off by default, so an admin can reset a password without losing the user's chats.

### Running it

- `npm run build` and `npm start` for production; a Dockerfile and Compose file; an example Caddy configuration for HTTPS.
- Compressed JSON and precompressed static files; timings for each generation in the log (never content).
- GitHub Actions: lint, types and unit tests on Linux and Windows, browser tests, the bundle budget, and a Docker build. Dependabot for npm and Actions.

### Known gaps

These are known and honest limits of 0.1.0. None of them loses data silently.

- **The first page load is larger than the target.** The initial JavaScript is 326.6 KiB gzipped. The design target is 180 KiB. About 165 KiB is the framework floor; the rest is the chat screen. CI enforces a 330 KiB ceiling so the size cannot grow, and getting under 180 KiB is planned work.
- **Attached files are not included in NeoText exports.** Chats, folders, presets and settings are. The export dialog says how many files were left out, and you can still download each file from its chat.
- **Provider ids are not remapped on import.** Imported chats remember which model they used, but not which of your providers. After an import you choose a model for them again.
- **There is no account deletion yet.** You can delete chats and export your data. An operator can remove a user's data by deleting the database.
- **The model provider sees your prompts.** This is by design (the model has to read them) and is stated in `SECURITY.md`. Encryption at rest protects the stored copy, not what you send.
- **Only OpenRouter and OpenAI-compatible endpoints** are supported directly. Native adapters for APIs that are not OpenAI-compatible (for example Anthropic's or Gemini's own) are not included, though both are reachable through OpenRouter.
- **The Docker image is built only in CI.** It was not built on the maintainer's machine for this release, because Docker was not installed there.
- **Installing with plain `npm ci` can fail on a machine with no C++ build tools**, because npm tries to compile better-sqlite3 although it ships binaries. Use `npm ci --ignore-scripts`, as the README says.
