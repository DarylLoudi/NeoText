# Security

NeoText keeps your chats encrypted on the server and tries hard not to leak them, your keys or
your password. This page says how to report a problem, what NeoText protects against, what it
does not, and what you need to do as the person running a server.

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use the repository's private
vulnerability reporting (on GitHub: **Security → Report a vulnerability**). Include what you
found, how to reproduce it, and which version you ran. We aim to answer within a week and to
ship a fix, or a clear plan, within 30 days. Tell us if you want to be credited.

Never send real API keys, passwords or chat contents in a report. Fake ones are enough.

## Threat model

| Threat | What NeoText does |
|---|---|
| Stolen database file or backup | Each user's content and keys are encrypted with that user's own data key. The key can only be recovered with the user's password, their recovery key, or a live session cookie. |
| Network eavesdropping | Run behind HTTPS (the Caddy example does this). Cookies get `Secure` and the `__Host-` prefix, and the server sends `Strict-Transport-Security: max-age=31536000`, whenever the public URL is https. |
| XSS through model output or web content | Markdown is rendered without raw HTML and sanitized; a strict Content Security Policy (`script-src 'self'`) blocks injected scripts; links are limited to safe schemes; source snippets are shown as text. |
| Image-based data exfiltration through prompt injection | Remote images never load on their own; you click to load them. |
| Cross-site request forgery | `SameSite=Strict` cookie, an origin check (`Sec-Fetch-Site` / `Origin`) on every request that changes something, and JSON-only bodies. |
| Session theft | `HttpOnly` cookie holding a 256-bit token; the server stores only its SHA-256. Signing out deletes the session and its copy of the data key. You can see and end your other sessions. |
| Password guessing | Argon2id, rate limits per IP and per username, and the same timing for unknown users. |
| Server-side request forgery (custom endpoints, the fetch tool, favicons, MCP) | Only http(s); DNS is resolved and checked at connect time, so rebinding does not help; private ranges are blocked for tools always and for endpoints unless the admin's policy allows them; cloud metadata addresses are blocked always. |
| Key leakage | API keys never go back to the browser (only a short hint, and members do not get that for shared providers). Keys are redacted in logs and never committed (`.env` is ignored; `npm run lint` scans tracked files for key-shaped strings). |
| Malicious tool use through prompt injection | Per-tool policies (`auto`, `ask`, `off`), an approval prompt for MCP and write-capable tools, truncated tool results, and fetch tools that cannot reach private networks. |
| One user exhausting the server | Body size limits, per-user rate limits on the costly endpoints, a per-user storage cap for attached files, bounded import unpacking, and a cap on imports running at once (see below). |

## Keys and envelopes, in plain words

- **Your data key.** Every user has a random 32-byte key that encrypts their chats, titles,
  folders, presets, settings, attachments, and their own provider keys and headers. It is never
  stored as is.
- **Your password** is stretched with Argon2id. One half of the result proves who you are (the
  server keeps only a hash of it); the other half unlocks a sealed copy of your data key.
- **Your recovery key** (`NTXR-…`, shown once) unlocks a second sealed copy. Using it sets a new
  password, signs out every session and gives you a new recovery key. Keep it somewhere safe:
  without it, a forgotten password means lost data, unless your admin turned on escrow.
- **Each session** holds a third sealed copy, unlocked by the random token in your cookie. That is
  how the server can read your chats while you are signed in, and why signing out removes it.
- **The instance key** (`data/keys/instance.key`, or `NEOTEXT_INSTANCE_KEY`) seals keys of
  providers an admin shares with everyone, signs invite codes, and seals the optional password
  escrow. Your own data never depends on it, unless escrow is on.
- **Escrow** (off by default) stores one more copy of each user's data key, sealed with the
  instance key, so an admin can reset a password without data loss. Users are told when it is
  on. Anyone holding both the database and the instance key can then read everything.
- **The envelope.** Every sealed value is AES-256-GCM with a fresh random nonce, and is bound to
  its table, column and row, so a value cannot be moved to another row or another user.

### What is encrypted, and what is not

**Encrypted at rest:** message parts, conversation titles, folder names, presets, settings,
attachment names and bytes, provider API keys and headers, MCP headers.

**Stored in plain text:** ids, timestamps, roles, statuses, model ids, provider kinds, names and
base URLs, token counts, costs, pinned and archived flags, positions, attachment sizes and types,
usernames, and the audit log (which records events and counts, never content).

## What NeoText does not protect against

- **A malicious operator.** Whoever runs the server can change its code to capture passwords or
  data keys as people sign in. Use a server run by someone you trust, or run your own.
- **Your model provider.** Prompts and answers go to the provider you pick, in plain text. They
  can read them, and their own policy decides what they keep.
- **A compromised browser or device**, or someone with your unlocked session.
- **Traffic analysis.** Sizes, times and which models you use are visible to the server.

## Limits that protect the server

| What | Limit |
|---|---|
| Sign-in | 10 per minute per IP, 5 per minute per username |
| Setup, registration, recovery, password change, admin password reset | 5 per minute |
| All API calls | 300 per minute per user |
| Starting chats | 30 per minute per user; at most 4 answers at once per user, 64 per server |
| Search (`/api/search`) | 60 per minute per user |
| Attachment uploads | 60 per minute per user |
| Whole-account export | 5 per minute per user |
| Import | 5 per minute per user; one at a time per user, two at a time per server |
| Request bodies | 1 MiB by default, 4 MiB for chat, 25 MiB for attachments, 200 MiB for imports |
| Attachment storage | 2048 MB of files per user (`NEOTEXT_ATTACHMENT_QUOTA_MB`) |
| Import unpacking | 256 MiB of JSON at most; a zip entry is inflated in steps and stopped once it passes the size it declared, or once past 16 MiB of output it has grown more than 200 times its compressed size |

The 4, 25 and 200 MiB routes take a body only from a signed-in user, and only with a
`Content-Length` header: a chunked upload is refused (411) before it is read.

## Operator checklist

- **Use HTTPS.** Set `NEOTEXT_PUBLIC_URL=https://…`. The Caddy example in `deploy/` gets a
  certificate for you.
- **Bind to localhost unless a proxy is in front.** Keep `NEOTEXT_HOST=127.0.0.1` (the default)
  and let the reverse proxy be the only way in.
- **Only trust a proxy that overwrites `X-Forwarded-For`.** With `NEOTEXT_TRUST_PROXY=true`, rate
  limits key on the first `X-Forwarded-For` entry. A proxy that appends to the header lets a
  client choose that entry and dodge the limits. Caddy, as configured in
  `deploy/Caddyfile.example`, replaces the header with the real client address (keep its
  `trusted_proxies` unset unless a CDN sits in front). Leave the setting off when nothing proxies
  NeoText, and make sure NeoText's port is not reachable around the proxy.
- **Back up the instance key separately.** Keep a copy of `data/keys/instance.key` (or your
  `NEOTEXT_INSTANCE_KEY`) apart from the database backups in `data/backups`. Without it, shared
  provider keys and escrow cannot be opened; stored next to the backups, it opens them for
  whoever takes both.
- **Keep the server updated.** Upgrade when a release fixes a security problem, and run
  `npm run audit` to check dependencies.
- **Keep `.env` private.** It may hold `OPENROUTER_API_KEY` or `NEOTEXT_INSTANCE_KEY`. Never commit
  it or paste it into an issue.
- **Think before enabling escrow.** It lets you reset passwords, and it means the database plus
  the instance key are enough to read every user's data.
