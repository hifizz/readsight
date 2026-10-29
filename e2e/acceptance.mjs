/**
 * BYOK 验收：真实 Chromium + 未打包扩展 + 本地 OpenAI 兼容 mock。
 *
 *   pnpm test:e2e
 *   # 没有图形界面时：
 *   xvfb-run -a pnpm test:e2e
 *
 * 不需要真实 API Key。Chrome 用 Playwright 自带的 Chromium（支持 --load-extension）。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startMockServer } from './mock-openai.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extPath = resolve(root, '.output/chrome-mv3');
const shots = resolve('/opt/cursor/artifacts');
mkdirSync(shots, { recursive: true });

const results = [];

function pass(id, detail) {
  results.push({ id, pass: true, detail });
  console.log(`PASS ${id} — ${detail}`);
}

function fail(id, detail) {
  results.push({ id, pass: false, detail });
  console.error(`FAIL ${id} — ${detail}`);
}

async function launch(userDataDir) {
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
}

async function extensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  return { worker, id: new URL(worker.url()).host };
}

async function openSidePanel(context, id) {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 860 });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await panel.getByTestId('sidepanel-app').waitFor();
  return panel;
}

async function shot(page, name) {
  const file = join(shots, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('SHOT', file);
  return file;
}

const mock = await startMockServer();
console.log('[e2e] mock', mock.baseURL);

if (process.env.BYOK_SKIP_BUILD !== '1') {
  execSync('pnpm build', { cwd: root, stdio: 'inherit' });
}

const userDataDir = mkdtempSync(join(tmpdir(), 'readsight-byok-'));
let context = await launch(userDataDir);
let panel;
let page;

try {
  const { id } = await extensionId(context);
  panel = await openSidePanel(context, id);
  panel.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('readsight') || text.includes('AI SDK')) {
      console.log('[panel]', msg.type(), text);
    }
  });

  const loginCount = await panel.getByText('登录', { exact: true }).count();
  const signOutCount = await panel.getByText('退出登录').count();
  if (loginCount !== 0 || signOutCount !== 0) {
    throw new Error(`auth UI still present login=${loginCount} signOut=${signOutCount}`);
  }
  await panel.getByTestId('no-key-banner').waitFor();
  await shot(panel, 'byok-00-no-login');
  pass('A1', '侧边栏没有登录门，未配置 Key 时给出设置入口');

  await panel.getByRole('button', { name: '设置', exact: true }).click();
  await panel.waitForFunction(() =>
    document.querySelector('[data-testid="llm-settings"]')?.getAttribute('data-ready') === 'true',
  );
  const hook = await panel.evaluate(() => {
    try {
      chrome.permissions.request = (req, cb) => {
        globalThis.__permRequest = req;
        if (typeof cb === 'function') cb(false);
        return Promise.resolve(false);
      };
      return 'ok';
    } catch (err) {
      return String(err);
    }
  });
  if (hook !== 'ok') throw new Error(`cannot hook permissions.request: ${hook}`);
  await panel.getByTestId('llm-base-url').fill('https://example.com/v1');
  await panel.getByTestId('llm-save').click();
  await panel.getByTestId('llm-save-error').waitFor();
  const requested = await panel.evaluate(() => globalThis.__permRequest?.origins ?? null);
  if (!requested || requested[0] !== 'https://example.com/*') {
    throw new Error(`expected permission request for example.com, got ${JSON.stringify(requested)}`);
  }
  pass('A3', '自定义 Base URL 在点击保存时同步申请 https://example.com/*，拒绝后不保存');

  await panel.getByTestId('llm-base-url').fill(mock.baseURL);
  await panel.getByTestId('llm-api-key').fill('sk-test');
  await panel.getByTestId('llm-chat-model').fill('mock-chat');
  await panel.getByTestId('llm-text-model').fill('mock-text');
  await panel.getByTestId('llm-save').click();
  await panel.getByTestId('llm-save-status').filter({ hasText: '已保存到本机' }).waitFor();
  await panel.getByTestId('llm-test').click();
  await panel.getByTestId('llm-save-status').filter({ hasText: '已连通' }).waitFor();
  await shot(panel, 'byok-01-settings');
  pass('A2', `设置已保存并连通 ${mock.baseURL}`);

  page = await context.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('readsight')) console.log('[page]', msg.type(), text);
  });
  await page.goto(mock.pageURL, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '翻译', exact: true }).waitFor({ timeout: 15000 });
  await page.evaluate(() => {
    const el = document.querySelector('#qorvex');
    if (!el) throw new Error('missing #qorvex');
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Look up with Readsight' }).click();
  await page.getByText('验收测试词').first().waitFor({ timeout: 20000 });
  await shot(page, 'byok-02-lookup');
  pass('A4', '测试页划词 qorvex，弹层显示模型释义「验收测试词」');

  await page.getByRole('button', { name: '翻译', exact: true }).click();
  await page.waitForFunction(() => {
    const nodes = [...document.querySelectorAll('.readsight-translation')];
    return nodes.some((node) => (node.textContent ?? '').includes('译:'));
  }, null, { timeout: 30000 });
  await shot(page, 'byok-03-translate');
  pass('A5', '整页翻译由本地 mock 返回，页面上出现「译:」译文');

  await panel.getByRole('button', { name: '当前对话', exact: true }).click();
  await panel.getByTestId('no-key-banner').waitFor({ state: 'hidden' });
  await panel.getByLabel('Message input').fill('请用工具读取当前页面正文，然后把单词 qorvex 存进学习记录，最后复述文章标题。');
  await panel.getByRole('button', { name: 'Send message' }).click();
  await panel.getByText('文章标题是 BYOK Acceptance Article').first().waitFor({ timeout: 30000 });
  await panel.getByRole('button', { name: '2 tool calls' }).click();
  await panel.getByText('get_page_content', { exact: true }).first().waitFor();
  await panel.getByText('save_word_card', { exact: true }).first().waitFor();
  await shot(panel, 'byok-04-chat-tools');
  pass('A6', '侧边栏多步工具：读取页面正文，并在回复里复述标题');

  await panel.getByRole('button', { name: '学习记录', exact: true }).click();
  await panel.getByText('qorvex').first().waitFor();
  await shot(panel, 'byok-05-records');
  pass('A7', '查词和 save_word_card 写入的单词卡出现在学习记录');

  await panel.getByRole('button', { name: '设置', exact: true }).click();
  const [download] = await Promise.all([
    panel.waitForEvent('download'),
    panel.getByTestId('records-export').click(),
  ]);
  const exportedPath = await download.path();
  if (!exportedPath) throw new Error('export download has no path');
  const exported = JSON.parse(readFileSync(exportedPath, 'utf8'));
  if (exported.version !== 1 || !Array.isArray(exported.encounterEvents) || exported.encounterEvents.length === 0) {
    throw new Error('export JSON missing encounter events');
  }
  if (JSON.stringify(exported).includes('sk-test')) throw new Error('export leaked the API key');
  await panel.getByTestId('records-clear').click();
  await panel.getByTestId('records-clear').click();
  await panel.getByTestId('records-import-status').filter({ hasText: '已清空学习记录' }).waitFor();
  await panel.getByRole('button', { name: '学习记录', exact: true }).click();
  await panel.getByText('还没有学习记录').waitFor();
  await panel.getByRole('button', { name: '设置', exact: true }).click();
  await panel.getByTestId('records-import').setInputFiles(exportedPath);
  await panel.getByTestId('records-import-status').filter({ hasText: '已导入' }).waitFor();
  await panel.getByRole('button', { name: '学习记录', exact: true }).click();
  await panel.getByText('qorvex').first().waitFor();
  pass('A8', `导出 ${exported.encounterEvents.length} 条事件，清空后导入恢复`);

  await panel.reload();
  await panel.getByTestId('sidepanel-app').waitFor();
  await panel.getByRole('button', { name: '学习记录', exact: true }).click();
  await panel.getByText('qorvex').first().waitFor();
  await shot(panel, 'byok-06-reload');
  pass('A9', '刷新侧边栏后学习记录仍在');

  await context.close();
  context = await launch(userDataDir);
  const restarted = await extensionId(context);
  const panel2 = await openSidePanel(context, restarted.id);
  await panel2.getByRole('button', { name: '学习记录', exact: true }).click();
  await panel2.getByText('qorvex').first().waitFor();
  await panel2.getByRole('button', { name: '设置', exact: true }).click();
  await panel2.waitForFunction(() =>
    document.querySelector('[data-testid="llm-settings"]')?.getAttribute('data-ready') === 'true',
  );
  const key = await panel2.getByTestId('llm-api-key').inputValue();
  const base = await panel2.getByTestId('llm-base-url').inputValue();
  if (key !== 'sk-test') throw new Error('API key did not survive browser restart');
  if (base !== mock.baseURL) throw new Error(`base URL changed across restart: ${base}`);
  await shot(panel2, 'byok-07-restart');
  pass('A10', '关掉浏览器再打开，API Key 和学习记录都还在');

  const kinds = mock.requests.map((item) => item.kind);
  if (!kinds.includes('models')) throw new Error('mock never saw GET /models');
  if (!kinds.includes('translate')) throw new Error(`mock never saw translate: ${kinds.join(',')}`);
  if (!kinds.includes('lookup') && !kinds.includes('gloss')) {
    throw new Error(`mock never saw lookup: ${kinds.join(',')}`);
  }
  if (!kinds.includes('tool:get_page_content') || !kinds.includes('tool:save_word_card') || !kinds.includes('chat-final')) {
    throw new Error(`agent loop incomplete: ${kinds.join(',')}`);
  }
  pass('A11', `mock 收到 ${kinds.join(' → ')}，扩展没有再依赖后端`);
} catch (err) {
  fail('RUN', err instanceof Error ? err.stack ?? err.message : String(err));
  if (panel) await shot(panel, 'byok-failure-panel').catch(() => {});
  if (page) await shot(page, 'byok-failure-page').catch(() => {});
  throw err;
} finally {
  writeFileSync(join(shots, 'byok-results.json'), JSON.stringify({ results, requests: mock.requests }, null, 2));
  await context.close().catch(() => {});
  await new Promise((resolve) => mock.server.close(resolve));
}
