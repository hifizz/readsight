/**
 * BYOK 配置。API Key 只放 chrome.storage.local：
 * sync 会进 Google 账号，而且配额很小。明文存储，设置页里写清楚。
 */

export type LLMPresetId = 'deepseek' | 'openai' | 'openrouter' | 'siliconflow' | 'custom';

export interface LLMConfig {
  preset: LLMPresetId;
  baseURL: string;
  apiKey: string;
  chatModel: string;
  textModel: string;
  /** 为 true 时在请求体注入 thinking: { type: 'disabled' }。只对 DeepSeek 有意义。 */
  disableThinking: boolean;
  /** 侧边栏对话是否把工具传给模型。没有 tool calling 的端点关掉。 */
  enableTools: boolean;
  /**
   * 为 true 时翻译 / 批量 JSON 走 response_format: json_object。
   * 不发 json_schema：DeepSeek 的兼容端点不接受它。
   * 为 false 时退回纯文本，再从回复里截取 JSON。
   */
  supportsStructuredOutputs: boolean;
}

export interface LLMPreset {
  label: string;
  baseURL: string;
  chatModel: string;
  textModel: string;
  disableThinking: boolean;
  supportsStructuredOutputs: boolean;
}

export const LLM_PRESETS: Record<LLMPresetId, LLMPreset> = {
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    chatModel: 'deepseek-v4-pro',
    textModel: 'deepseek-v4-flash',
    disableThinking: true,
    supportsStructuredOutputs: true,
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    chatModel: 'gpt-4o-mini',
    textModel: 'gpt-4o-mini',
    disableThinking: false,
    supportsStructuredOutputs: true,
  },
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    chatModel: 'deepseek/deepseek-chat',
    textModel: 'deepseek/deepseek-chat',
    disableThinking: false,
    supportsStructuredOutputs: false,
  },
  siliconflow: {
    label: 'SiliconFlow',
    baseURL: 'https://api.siliconflow.cn/v1',
    chatModel: 'deepseek-ai/DeepSeek-V3',
    textModel: 'deepseek-ai/DeepSeek-V3',
    disableThinking: false,
    supportsStructuredOutputs: false,
  },
  custom: {
    label: '自定义',
    baseURL: '',
    chatModel: '',
    textModel: '',
    disableThinking: false,
    supportsStructuredOutputs: false,
  },
};

/**
 * manifest host_permissions 里已经声明的 origin。
 * 这些地址保存时不用再弹权限。localhost / 127.0.0.1 放进声明列表，
 * 这样本机 OpenAI 兼容服务（Ollama、LM Studio、验收用的 mock）不用点一次授权。
 * 其它域名走 optional_host_permissions，必须在点击回调里同步 request。
 */
export const DECLARED_HOST_PATTERNS = [
  'https://api.deepseek.com/*',
  'https://api.dictionaryapi.dev/*',
  'http://127.0.0.1/*',
  'http://localhost/*',
];

export const LLM_STORAGE_KEY = 'readsight:llm';
export const PENDING_TAB_KEY = 'readsight:pending-tab';

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  preset: 'deepseek',
  baseURL: LLM_PRESETS.deepseek.baseURL,
  apiKey: '',
  chatModel: LLM_PRESETS.deepseek.chatModel,
  textModel: LLM_PRESETS.deepseek.textModel,
  disableThinking: true,
  enableTools: true,
  supportsStructuredOutputs: true,
};

function isPresetId(value: unknown): value is LLMPresetId {
  return value === 'deepseek' || value === 'openai' || value === 'openrouter' || value === 'siliconflow' || value === 'custom';
}

export function normalizeLLMConfig(raw: unknown): LLMConfig {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LLM_CONFIG };
  const obj = raw as Partial<LLMConfig>;
  const preset = isPresetId(obj.preset) ? obj.preset : DEFAULT_LLM_CONFIG.preset;
  return {
    preset,
    baseURL: typeof obj.baseURL === 'string' ? obj.baseURL.trim() : DEFAULT_LLM_CONFIG.baseURL,
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey.trim() : '',
    chatModel: typeof obj.chatModel === 'string' && obj.chatModel.trim()
      ? obj.chatModel.trim()
      : DEFAULT_LLM_CONFIG.chatModel,
    textModel: typeof obj.textModel === 'string' && obj.textModel.trim()
      ? obj.textModel.trim()
      : DEFAULT_LLM_CONFIG.textModel,
    disableThinking: obj.disableThinking === true,
    enableTools: obj.enableTools !== false,
    supportsStructuredOutputs: obj.supportsStructuredOutputs === true,
  };
}

/** `https://host/v1` → `https://host/*`。端口省略，和 manifest 里的 host pattern 对齐。 */
export function originPattern(baseURL: string): string | null {
  try {
    const url = new URL(baseURL);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

export function isDeclaredHost(pattern: string): boolean {
  return DECLARED_HOST_PATTERNS.includes(pattern);
}

export async function getLLMConfig(): Promise<LLMConfig> {
  try {
    const stored = await chrome.storage.local.get(LLM_STORAGE_KEY);
    return normalizeLLMConfig(stored[LLM_STORAGE_KEY]);
  } catch {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

export async function setLLMConfig(config: LLMConfig): Promise<void> {
  await chrome.storage.local.set({ [LLM_STORAGE_KEY]: normalizeLLMConfig(config) });
}

export function subscribeLLMConfig(cb: (config: LLMConfig) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName) => {
    if (area !== 'local' || !(LLM_STORAGE_KEY in changes)) return;
    cb(normalizeLLMConfig(changes[LLM_STORAGE_KEY]?.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * 必须从点击事件里同步调用。非声明域名会立刻 chrome.permissions.request，
 * 不能先 await，否则用户手势失效，弹窗出不来。
 */
export function requestOriginAccess(
  baseURL: string,
  onResult: (granted: boolean, pattern: string | null) => void,
): void {
  const pattern = originPattern(baseURL);
  if (!pattern) {
    onResult(false, null);
    return;
  }
  if (isDeclaredHost(pattern)) {
    onResult(true, pattern);
    return;
  }
  try {
    chrome.permissions.request({ origins: [pattern] }, (granted) => {
      onResult(Boolean(granted), pattern);
    });
  } catch (err) {
    console.warn('[readsight] permissions.request failed', err);
    onResult(false, pattern);
  }
}

export async function testLLMConnection(config: LLMConfig): Promise<{ ok: boolean; detail: string }> {
  const base = config.baseURL.replace(/\/$/, '');
  if (!base || !config.apiKey) return { ok: false, detail: '请先填写 Base URL 和 API Key' };
  const headers = { Authorization: `Bearer ${config.apiKey}` };
  try {
    const models = await fetch(`${base}/models`, { headers });
    if (models.ok) return { ok: true, detail: '已连通 /models' };
  } catch (err) {
    console.warn('[readsight] GET /models failed', err);
  }
  try {
    const chat = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.chatModel || config.textModel,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });
    if (!chat.ok) {
      const body = await chat.text().catch(() => '');
      return { ok: false, detail: `HTTP ${chat.status} ${body.slice(0, 180)}` };
    }
    return { ok: true, detail: '对话接口可用' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
