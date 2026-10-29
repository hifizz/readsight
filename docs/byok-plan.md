# 见微 Readsight 纯前端 BYOK

扩展在浏览器里自己调用用户的 OpenAI 兼容接口。对话、查词、整页翻译、学习记录都不再依赖 `server/`。`server/` 先留在仓库里，不删除、不部署。

词典不打包 ECDICT。查词顺序是：IndexedDB 缓存 → Free Dictionary API → 文本模型估计。没有 Key 时，Free Dictionary 的英文释义仍然可以显示。

## 和原稿不一致的地方

这些是对照 `ai@6.0.191` 和现有代码之后改的，不是原稿里的写法。

- `convertToModelMessages` 在这个版本里是 **async**。多步工具循环还要把 `tools` 传进去，否则下一轮历史里的 tool part 转不回模型消息。
- `generateObject` 已标记废弃。翻译在「JSON 模式」打开时用 `generateText` + `Output.object`。`@ai-sdk/openai-compatible` 的 `supportsStructuredOutputs: true` 会发送 `json_schema`，DeepSeek 兼容接口不接受，所以 provider 上保持 `false`，实际发出的是 `response_format: json_object`。关掉 JSON 模式时，从文本里截取 JSON。
- `localhost` 和 `127.0.0.1` 写在 `host_permissions` 里，而不是只放 optional。本机兼容服务（Ollama、LM Studio、验收 mock）不用再点一次授权。其它域名仍在点击保存时同步调用 `chrome.permissions.request`。
- 不打包 ECDICT，也没有 `scripts/build-ecdict-lite.mjs`。
- Agent 循环放在侧边栏页面，不放 service worker。`translate` / `lookup` 是短请求，放在 background，避免 content script 撞上页面 CORS。

## 数据

IndexedDB（Dexie，库名 `readsight`）存选区、学习事件、对话、词典缓存、翻译缓存。每一行有 `updatedAt`、`deletedAt`、`dirty`。content script 不直接碰这个库，经 `chrome.runtime.sendMessage` 交给 background。

API Key 在 `chrome.storage.local` 的 `readsight:llm`，明文。设置页写明了这一点。

## 验收标准

`pnpm test:e2e` 用 Playwright 把 `.output/chrome-mv3` 载入 Chromium，对本地 mock（流式 tool call + 非流式 JSON）跑下面各项。不需要真实 Key。

| ID | 标准 |
| --- | --- |
| A1 | 侧边栏没有登录 / 注册 / 退出。未填 Key 时有「去设置」。 |
| A2 | 设置页可保存 Base URL、API Key、对话模型、文本模型，并测试连接成功。 |
| A3 | 自定义公网 Base URL 在点击保存时同步申请该 origin；用户拒绝则不保存。 |
| A4 | 测试页划词后弹层给出释义（Free Dictionary 未命中时走模型）。 |
| A5 | 整页翻译不请求旧后端，译文出现在页面上。 |
| A6 | 侧边栏对话跑多步循环：`get_page_content` 读到当前页，回复里包含文章标题。 |
| A7 | `save_word_card` 和查词都会写入学习记录，记录列表能看到该词。 |
| A8 | 导出 JSON（不含 API Key），清空后导入，记录恢复。 |
| A9 | 刷新侧边栏，记录还在。 |
| A10 | 关掉浏览器再打开同一用户目录，Key 和记录都还在。 |
| A11 | mock 收到 models、查词、翻译、两次工具调用和最终回复。 |

## 本地用真实 DeepSeek Key

```bash
pnpm install
pnpm build
```

在 `chrome://extensions` 打开开发者模式，加载 `.output/chrome-mv3`。打开侧边栏 → 设置：

- 预设保持 DeepSeek
- Base URL `https://api.deepseek.com/v1`
- API Key 填自己的 `sk-...`
- 对话模型 `deepseek-v4-pro`，文本模型 `deepseek-v4-flash`
- 「关闭 thinking」保持打开
- 保存，再点「测试连接」

然后打开任意英文页：划词、点右下角「翻译」、在侧边栏里让它读取当前页面。Key 只留在这台浏览器里。

开发时也可以 `pnpm dev`，加载 `.output/chrome-mv3-dev`。

## 重跑验收

```bash
pnpm test:e2e
# 没有 DISPLAY 时
xvfb-run -a pnpm test:e2e
```

脚本会先 `pnpm build`。已经构建过可以 `BYOK_SKIP_BUILD=1 pnpm test:e2e`。需要本机有 Playwright Chromium（`pnpm exec playwright install chromium`）。
