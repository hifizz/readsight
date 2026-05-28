# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chrome MV3 extension —— 对外名 **见微 Readsight**（中文主名「见微」+ 英文 wordmark「Readsight」），repo / 旧文档里的内部代号是 `English Agent`，新代码不要再用。
沉浸式英语精读：双语全页翻译 (M3) + 划词精读 (M1) + 学习记录 (M2). Built with WXT + React 19; backend is `server/` (Next.js 16). 命名决策见 `docs/09-对外宣传与上架物料.md`；里程碑状态见 `docs/PROJECT_STATUS.md`。

> 代码内一切产品名都已统一：日志前缀 `[readsight]`、storage / context-menu / shadow-host id `readsight:*` / `readsight-*`、CSS 类名 `.readsight-translation`、HTTP `X-Title: Readsight`。CSS 内部前缀仍是 `eag-`（pill / popup / immersive-reader 的 scoped 样式）—— 那是 shadow DOM 内的局部 namespace，不外泄，不算对外名。

## Commands

```bash
pnpm dev                    # WXT dev mode → .output/chrome-mv3-dev
pnpm build                  # production build → .output/chrome-mv3
pnpm compile                # TS typecheck (tsc --noEmit) — fast, run before commits

cd server && pnpm dev       # backend on localhost:4010
cd server && pnpm exec tsc --noEmit
```

After code change in `entrypoints/`, `pnpm build` to refresh the unpacked extension at `.output/chrome-mv3/`. The user reloads the extension in `chrome://extensions/` manually.

## Architecture (only what's non-obvious)

- **Strict context isolation (PRD §3.1)**: content script is the only one touching page DOM; sidepanel never reads the page directly; all cross-context traffic flows through `background.ts`. Don't break this.
- **`entrypoints/content/translate.tsx`** is the heart of M3. Two modes: `article` (Readability + ancestor blacklist, strict) and `page` (text-walker over any block-like tag, permissive). MutationObserver续翻 lives here too — see "MutationObserver 续翻" comment block.
- **Translation provider chain (`server/src/lib/translate.ts`)**: DeepSeek `deepseek-v4-flash` (thinking disabled via fetch wrapper) → Zhipu GLM-4-Flash → OpenRouter free models. Cache hash namespace is `glm-4-flash` (`CACHE_HASH_NAMESPACE`) for historical reasons — keep it so existing cache stays valid when default provider changes.
- **Translation cache** lives in Postgres `translations` table. Hash key = sha256(namespace|target_lang|text). Same English text in multiple sites = one entry.
- **AI SDK structured output**: DeepSeek doesn't support `response_format: json_schema`, only `json_object`. The "AI SDK Warning: responseFormat not supported" is benign — we're in json_object weak mode, prompt has explicit "no full-width quotes" rule, GLM/OpenRouter兜底 catches rare parse failures.

## Debugging extension behavior — use Playwright + load-extension

When the user reports an extension bug ("FAB doesn't fire", "translation incomplete", "rescan misses content"), don't ask them to reload + repro manually. Reproduce it with Playwright headed Chromium loading the unpacked extension. This is faster, deterministic, and surfaces DOM truth the user can't easily inspect.

### Setup that's already on this machine

- Playwright lives in a sibling project: `/Users/zilin/side/next.zilin.im/node_modules/playwright`. Import from there directly:
  ```js
  import { chromium } from '/Users/zilin/side/next.zilin.im/node_modules/playwright/index.mjs';
  ```
- Chromium binary auto-resolves via `chromium.executablePath()`.
- Diagnostic logs in `entrypoints/content/translate.tsx` (`[english-agent] rescan(...)`, `cachedArticleRoot detached`) are always-on in prod build. Don't gate them behind `NODE_ENV` checks.

### Recipe — load extension, drive a site, capture console

```js
import { chromium } from '/Users/zilin/side/next.zilin.im/node_modules/playwright/index.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const EXT_PATH = '/Users/zilin/side/english-agent/.output/chrome-mv3';
const USER_DATA = mkdtempSync(`${tmpdir()}/eag-debug-`);

const ctx = await chromium.launchPersistentContext(USER_DATA, {
  headless: false, // MV3 needs headed Chrome
  args: [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    '--no-first-run', '--no-default-browser-check',
  ],
  viewport: { width: 1280, height: 900 },
});

// Wait for background SW (proves extension loaded)
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 5000 }).catch(() => null);

const page = await ctx.newPage();
page.on('console', (msg) => {
  const t = `[${msg.type()}] ${msg.text()}`;
  if (t.includes('english-agent')) console.log('CONSOLE:', t);
});

await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' });

// FAB lives in shadow root attached to body — find via aria-label
await page.evaluate(() => {
  const hosts = Array.from(document.body.children).filter((el) => el.shadowRoot);
  for (const host of hosts) {
    const btn = host.shadowRoot.querySelector('button[aria-label="翻译"]');
    if (btn) { btn.click(); return; }
  }
});

// Then: scroll, click, wait, probe DOM, etc.
await ctx.close();
```

### Workflow when a bug is reported

1. **Build first**: `pnpm build` — Playwright loads `.output/chrome-mv3`, not source.
2. **Server up?** Check `curl -s -o /dev/null -w "%{http_code}" http://localhost:4010/api/translate -X POST -H 'content-type: application/json' -d '{"blocks":[]}'` returns 200. If not, `cd server && pnpm dev`.
3. **Probe DOM truth before fixing**: if the bug is "extension doesn't see X", write a small `page.evaluate(() => {...})` that returns the actual DOM structure (heading parents, `closest('main')`, body direct children). The real reason is often surprising — TC's article H1 isn't even inside `<main>`.
4. **Capture `[english-agent]` logs** to confirm hypothesis. The rescan diagnostics print `scanned=N, added=M, total=K` per rescan — `added=0` while scrollHeight grows means rescan is bounded too tightly.
5. **Fix → rebuild → rerun the script**. Same script as both repro and validation.

Existing test scripts in `/tmp/`:
- `eag-debug.mjs` — synthetic test page (`<p>` paragraphs + Load More button + simulated SPA tree replacement).
- `eag-tc-debug.mjs` — TechCrunch article, scrolls 8× to trigger infinite scroll. Use this template for "scrolling lazy-load" bugs.
- `eag-tc-probe.mjs` — read-only DOM inspector. Use first when you don't know where content lives.

Keep these patterns when adding new ones. Don't install Playwright into `english-agent` itself.

## Provider env vars (server/.env.local, gitignored)

- `DATABASE_URL` — local Postgres
- `DEEPSEEK_API_KEY` — primary translation
- `ZHIPU_API_KEY` — first兜底
- `OPENROUTER_API_KEY` — second兜底 (西方模型，绕国产内容审查)
- `TRANSLATE_PRIMARY` (optional) — `'deepseek'` (default) | `'zhipu'` | `'openrouter'` to reorder the chain
