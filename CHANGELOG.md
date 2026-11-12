# Changelog

All notable changes to NeoText are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [semantic versioning](https://semver.org/).

## Unreleased

### Added

- **Project preview.** A chat can hold a small web project.
  - The model creates and edits its HTML, CSS and JavaScript files through tools. Models without tools use code blocks named after the file.
  - Every change becomes a numbered version you can compare with the one before.
  - A panel beside the chat runs the page in your browser, offline and isolated from NeoText. A full HTML page in a code block opens there too.
  - Data the page saves stays with the chat until you reset it, and the project downloads as one `.html` file.

### Changed

- **Time so far.** "Working…", "Searching the web…" and a tool call still running show how long they have taken, counting up every second, so a long step no longer looks stuck.
- **Agent menu.** Each agent shows its "When to use it" line, and the menu ends with "Manage agents".
- **New chat page.** Model facts the provider does not list are left out instead of reading "Not listed".
- **Usage.** A range with no recorded cost shows a short note instead of an empty chart.
- **Sidebar.** The search shortcut appears only when the row is pointed at or focused.
- **Chat.** An answer now sits closer to its question.
- **Faster first load.** The JavaScript loaded before the first page is 288 KiB gzip, down from 335 KiB. The rest now loads beside the page:
  - the sidebar (with drag and drop);
  - the reasoning effort menu;
  - the sign-up page;
  - the select and switch controls;
  - the Settings and Admin text.

  The build ceiling is lowered to 290 KiB.

### Fixed

- **Docker.** The image builds again: the build now copies the script that precompresses the web files.
- **Project preview.**
  - A page that moves itself with `location.href` to another page of the project opens that page; one the project lacks is named under "Missing from the project:" and the page stays.
  - Pressing Escape twice inside the page, when the page does not take it, moves focus back to the panel; one more Escape closes it. A single Escape stays with the page.
  - CSS containing `</style` and scripts containing `<!--` no longer break the page.
  - File changes the model asks for run in the order it asked, even when you approve them out of order, so the next turn sees the same files.
  - Deleting a chat for good from the trash in this browser also deletes what its preview saved here.
  - The panel no longer rebuilds the project while only text streams in, and the download link is freed after the download starts.
- **Fields and choices.** A focused text field, select or dialog field shows one ring on its own edge instead of a doubled white frame, which scrolling dialogs also cut off. The chosen option in a row of choices sits inside the frame with a gap instead of merging with its edge, and the chosen accent swatch has a single frame.
- **Compare.** While one model is still thinking, its caret and Stop button stay under its own text instead of sinking to the bottom of the tallest column.
- **Math.** `\[ … \]` written in the middle of a sentence now renders as display math; before, it showed as raw text with its backslashes lost.
- **Compare.** A picked "Continue with this answer" now stays picked after a reload, in that browser. Regenerating or editing follows the version on screen, so regenerating a picked answer goes to its own model.
- **Drafts.** An unsent message comes back after a reload (the composer used to read it before the browser storage was open), together with the agent chosen for it.
- **Sub-agent card.** Rows no longer overflow the card on a phone.
- **Phones and small windows.**
  - Tables in answers scroll sideways instead of splitting numbers and words letter by letter.
  - The Admin → Users page no longer makes the whole page scroll sideways.
  - On Android the keyboard shrinks the page, so the message box stays above it.
  - Fields are 16px on touch screens, so iPhones no longer zoom in when one is tapped.
  - Sliders have a bigger touch area.
  - Keyboard hints like "Ctrl Shift F" are hidden on touch screens.
  - Settings, Usage and Admin pages have a single main heading.

## 0.3.0

### Added

- **Agent knowledge base.** In Settings → Agents, an agent can hold up to 20 files (PDF, Word, TXT, Markdown, CSV or HTML, 10 MB each). When that agent answers, called directly or as a sub-agent, it searches its files and cites them as `[file name, p. N]`. NeoText keeps only the extracted text, split into pieces and encrypted with your key, and searches it on your own server with no embeddings model. Scanned PDFs without text are refused.
- **Tool.** "Knowledge base" appears in Settings → Tools, where it can be turned off or set to ask first.

### Not included yet

- Knowledge files are not part of exports.
- No OCR for scanned PDFs.

## 0.2.0

### Changed

- **Web search.** The model decides when to search. Turn search off with the web search tool's policy in Settings → Tools. The "Web" toggle and the "search by default" setting are gone.
- **Bundle size.** The bundle ceiling rose from 330 KiB to 335 KiB. Most of the growth is English text for the new features.

### Fixed (audit of 0.2 changes)

- **Sub-agent limits.** Sub-agents share one search budget per delegation (at most 12 searches) and honour the shared-provider quota. Their own searches and page reads are listed in the card.
- **Agent switches.** An agent's "web search off" switch is respected. An agent's own model no longer changes the chat's model. Regenerating an answer from a deleted agent works.
- **Context meter.** It reads the last model call instead of adding up every tool step.
- **Accessibility.** The selected row in the palette and search is clearly visible in dark mode, and the copy button announces "Copied".

### Added

- **Sub-agents.** For a big job that splits into independent parts, the chat model can run up to 6 sub-agents in parallel and merge their reports into one answer. A card in the answer shows each task live. Small questions are answered directly.
- **Custom agents.** Settings → Agents lets you write your own agents: a name, when to use them, Markdown instructions (typed or imported from a `.md` file), a model and allowed tools. Call one with the Agent button or by starting a message with `@Name`. You can also let the chat model hand tasks to it.
- **Interface.**
  - Single-column chat with an icon send button.
  - Dark theme by default and a neutral accent.
  - A context window meter.
  - Automatic web search.
  - Math in `\(…\)` and `\[…\]`. Prose that contains those characters literally now renders as math.
  - Themed form controls.
  - A copy icon on code blocks that turns into a check.

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

- Chats, titles, settings, attachments and provider keys are encrypted at rest with a key that your password (or recovery key) unlocks. See the Security section of the README.
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
- **The model provider sees your prompts.** This is by design (the model has to read them) and is stated in the README. Encryption at rest protects the stored copy, not what you send.
- **Only OpenRouter and OpenAI-compatible endpoints** are supported directly. Native adapters for APIs that are not OpenAI-compatible (for example Anthropic's or Gemini's own) are not included, though both are reachable through OpenRouter.
- **The Docker image is built only in CI.** It was not built on the maintainer's machine for this release, because Docker was not installed there.
- **Installing with plain `npm ci` can fail on a machine with no C++ build tools**, because npm tries to compile better-sqlite3 although it ships binaries. Use `npm ci --ignore-scripts`, as the README says.
