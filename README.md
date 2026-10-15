<p align="center"><img src="public/icon/128.png" width="96" alt="Readsight logo" /></p>

<h1 align="center">见微 Readsight</h1>

<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a></p>

> An immersive English-reading companion for Chrome — bilingual full-page translation, selection close-reading with an AI tutor in the side panel, and a structured record of every word you meet.

Readsight is for readers who can follow most of an English article but keep getting stuck on a word, phrase, or construction. The original text stays front and center: translation is layered underneath each paragraph, and explanations arrive only where you ask for them. Unlike dictionary overlays or full-replacement translators, the side panel treats the LLM as a tutor — it sees the sentence and paragraph you selected, so it can explain *this* usage rather than recite a dictionary entry. Every lookup and chat becomes a structured encounter event, ready for a spaced-repetition model (FSRS) later.

## Features

| Area | What you get |
| --- | --- |
| Bilingual page translation | Floating button / context menu / `Alt+T`; article extraction via Readability with a permissive page mode fallback; viewport-driven progressive batching; inline `<code>` identifiers protected from translation; one-click undo; dark-mode adaptive |
| Selection close-reading | Select a word / phrase / sentence → a pill appears → the side panel opens with that exact context pinned; word cards with IPA, audio, EN/ZH definitions; each selection starts a fresh thread |
| Context-aware chat | The tutor prompt injects your sentence and paragraph, then branches on selection type — "special usage here" vs. plain usage |
| Learning records | Every lookup / chat auto-recorded as encounter events; passive re-encounter detection while you browse; Records tab with jump-back-to-source highlighting |
| Accounts & privacy | Email + password sign-in; learning data isolated per account; daily usage quotas; the translation cache is shared and content-addressed |
| Speech | Sentence / phrase playback via local `speechSynthesis` (en-US) — no cloud TTS |

## Use it

1. **Translate a page** — open any English article, hit the floating button (or `Alt+T`, or right-click → 翻译). Chinese appears under each paragraph as you scroll; new content on scroll-loaded pages keeps filling in.
2. **Interrogate a selection** — select a word or phrase, click the pill above it. The side panel opens with a dictionary card and a chat thread that already knows the sentence you are in.
3. **Review** — the Records tab lists everything you have looked up, with encounter counts, recency, and a link back to where you met it.

## Install

No store listing yet — build from source. You need a backend URL (yours below, or an existing instance).

### Extension

```bash
pnpm install
WXT_BACKEND_URL=https://your-api.example.com pnpm build
# then load .output/chrome-mv3 as an unpacked extension at chrome://extensions
```

A plain `pnpm dev` builds a dev bundle pointing at `http://localhost:4010`.

### Backend (self-host)

Requires Node 20+ and `pnpm` (10.x pinned in `server/`), a PostgreSQL database, and a DeepSeek API key.

```bash
cd server
pnpm install

# server/.env.local
# DATABASE_URL=postgres://...
# DEEPSEEK_API_KEY=...        (required)
# ZHIPU_API_KEY=...           (optional fallback)
# OPENROUTER_API_KEY=...      (optional fallback)

pnpm db:push     # create tables in the "readsight" schema
pnpm dev         # http://localhost:4010
```

Optional: drop an ECDICT sqlite (~100 MB, 770k words) at `server/data/ecdict.sqlite` for instant offline dictionary lookups; without it the lookup pipeline degrades gracefully to Free Dictionary + LLM. For production deployment (Coolify, TLS, backups, quotas), see [docs/deploy-vps.md](docs/deploy-vps.md).

## Configuration

| Variable | Where | Meaning |
| --- | --- | --- |
| `WXT_BACKEND_URL` | extension build | API base URL baked into the bundle |
| `DATABASE_URL` | server | PostgreSQL connection string (business tables live in the `readsight` schema) |
| `DEEPSEEK_API_KEY` | server | Required — powers chat, translation, and dictionary assist |
| `ZHIPU_API_KEY` / `OPENROUTER_API_KEY` | server | Translation fallbacks (Zhipu GLM-4-Flash → OpenRouter) |
| `TRANSLATE_PRIMARY` | server | Reorder the fallback chain (`deepseek` \| `zhipu` \| `openrouter`) |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` | server | Auth session signing and public URL |
| `AUTH_TRUSTED_ORIGINS` | server | Comma-separated `chrome-extension://<id>` origins allowed to sign in |
| `DAILY_CHAT_REQUESTS` / `DAILY_TRANSLATION_CHARACTERS` / `DAILY_LOOKUP_REQUESTS` | server | Per-user daily quotas (default 50 / 200k / 500) |
| `CORS_ALLOW_ORIGIN` | server | Tighten the default `*` to your extension origin |

## Model routing

| Task | Model |
| --- | --- |
| Side panel / contextual chat | DeepSeek `deepseek-v4-pro` |
| Full-page translation, dictionary assist | DeepSeek `deepseek-v4-flash` |
| Translation fallback chain | DeepSeek → Zhipu GLM-4-Flash → OpenRouter |

All bindings disable thinking; repeated segments are served from a Postgres content-addressed cache (`sha256(namespace|lang|text)`).

## Caveats

- **Authentication is required** — extension builds from before the auth rollout receive `401` from a current backend.
- Accounts are email + password only: no email verification, no password recovery or change in this release.
- The translation/dictionary cache is global across users (same English text → one entry). It stores translated content only; learning records are per-account.
- English → Chinese only, for now. Speech quality depends on the browser/OS voices.
- Loading an unpacked build assigns a random extension ID — whitelist it in the backend's `AUTH_TRUSTED_ORIGINS`.

## Documentation

- [PRD.md](PRD.md) — product requirements
- [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) — architecture decisions and milestone status
- [docs/deploy-vps.md](docs/deploy-vps.md) — production deployment runbook (Coolify)
- [docs/plan-deployment.md](docs/plan-deployment.md) — deployment planning notes
- [openspec/](openspec/) — change specs (auth, data isolation, quotas)

## Development

```bash
pnpm dev          # extension dev mode
pnpm compile      # typecheck
pnpm build        # production build → .output/chrome-mv3

cd server && pnpm dev              # backend on :4010
cd server && pnpm exec tsc --noEmit
```

Reproduce extension bugs with Playwright + the unpacked build — recipes in [CLAUDE.md](CLAUDE.md).

## Status

M1 (selection close-reading), M2 (learning records), and M3 (bilingual full-page translation) are shipped. M4 — FSRS-based review scheduling, review cards, push reminders — is not started; the encounter-event data it needs is already being recorded.
