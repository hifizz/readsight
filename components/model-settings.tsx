/**
 * 模型、学习记录导入导出。Key 只存在本机 chrome.storage.local。
 */
import { useEffect, useState } from 'react';
import {
  LLM_PRESETS,
  requestOriginAccess,
  setLLMConfig,
  testLLMConnection,
  type LLMConfig,
  type LLMPresetId,
} from '@/lib/llm-config';
import { useLLMConfig } from '@/lib/use-llm-config';
import {
  clearLearningData,
  exportLearningData,
  importLearningData,
} from '@/lib/records';

export function ModelSettings() {
  const { config, ready } = useLLMConfig();
  const [draft, setDraft] = useState<LLMConfig>(config);
  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    if (!ready || hydrated) return;
    setDraft(config);
    setHydrated(true);
  }, [ready, hydrated, config]);

  function patch(partial: Partial<LLMConfig>) {
    setDraft((current) => ({ ...current, ...partial }));
    setStatus(null);
    setError(null);
  }

  function onPreset(preset: LLMPresetId) {
    const next = LLM_PRESETS[preset];
    setDraft((current) => ({
      ...current,
      preset,
      baseURL: preset === 'custom' ? current.baseURL : next.baseURL,
      chatModel: preset === 'custom' ? current.chatModel : next.chatModel,
      textModel: preset === 'custom' ? current.textModel : next.textModel,
      disableThinking: preset === 'custom' ? current.disableThinking : next.disableThinking,
      supportsStructuredOutputs: preset === 'custom' ? current.supportsStructuredOutputs : next.supportsStructuredOutputs,
    }));
    setStatus(null);
    setError(null);
  }

  function onSaveClick() {
    setError(null);
    setStatus(null);
    requestOriginAccess(draft.baseURL, (granted) => {
      if (!granted) {
        setError('未授权访问该地址，浏览器会拦截请求。请允许后再保存。');
        return;
      }
      void setLLMConfig(draft)
        .then(() => setStatus('已保存到本机'))
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    });
  }

  function onTestClick() {
    setError(null);
    setStatus(null);
    requestOriginAccess(draft.baseURL, (granted) => {
      if (!granted) {
        setError('未授权访问该地址，无法测试连接。');
        return;
      }
      setTesting(true);
      void testLLMConnection(draft)
        .then((result) => {
          if (result.ok) setStatus(result.detail);
          else setError(result.detail);
        })
        .finally(() => setTesting(false));
    });
  }

  async function onExport() {
    const json = await exportLearningData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `readsight-records-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function onImport(file: File | undefined) {
    if (!file) return;
    setImportMsg(null);
    try {
      const counts = await importLearningData(await file.text());
      setImportMsg(`已导入 ${counts.encounterEvents} 条学习事件`);
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : '导入失败');
    }
  }

  return (
    <div data-testid="llm-settings" data-ready={hydrated ? 'true' : 'false'} className="flex flex-col gap-6">
      <section>
        <div className="mb-3">
          <h2 className="text-[14px] font-semibold text-foreground">模型</h2>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            对话、翻译和词典中文释义都发往你填写的 OpenAI 兼容接口。API Key 只存在这台浏览器的本地存储里，明文保存，不会上传到见微的服务器。
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <label className="block text-[13px]">
            <span className="mb-1 block font-medium">预设</span>
            <select
              data-testid="llm-preset"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5"
              value={draft.preset}
              onChange={(event) => onPreset(event.target.value as LLMPresetId)}
            >
              {(Object.keys(LLM_PRESETS) as LLMPresetId[]).map((id) => (
                <option key={id} value={id}>{LLM_PRESETS[id].label}</option>
              ))}
            </select>
          </label>
          <label className="block text-[13px]">
            <span className="mb-1 block font-medium">Base URL</span>
            <input
              data-testid="llm-base-url"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5"
              value={draft.baseURL}
              spellCheck={false}
              onChange={(event) => {
                const baseURL = event.target.value;
                patch({
                  baseURL,
                  preset: LLM_PRESETS[draft.preset].baseURL === baseURL ? draft.preset : 'custom',
                });
              }}
            />
          </label>
          <label className="block text-[13px]">
            <span className="mb-1 block font-medium">API Key</span>
            <input
              data-testid="llm-api-key"
              type="password"
              autoComplete="off"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5"
              value={draft.apiKey}
              onChange={(event) => patch({ apiKey: event.target.value })}
            />
          </label>
          <label className="block text-[13px]">
            <span className="mb-1 block font-medium">对话模型</span>
            <input
              data-testid="llm-chat-model"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5"
              value={draft.chatModel}
              spellCheck={false}
              onChange={(event) => patch({ chatModel: event.target.value })}
            />
          </label>
          <label className="block text-[13px]">
            <span className="mb-1 block font-medium">文本模型</span>
            <input
              data-testid="llm-text-model"
              className="w-full rounded-md border border-border bg-background px-2 py-1.5"
              value={draft.textModel}
              spellCheck={false}
              onChange={(event) => patch({ textModel: event.target.value })}
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">翻译和词典释义用这个模型。</span>
          </label>
          <ToggleRow
            testId="llm-disable-thinking"
            label="关闭 thinking"
            checked={draft.disableThinking}
            onChange={(disableThinking) => patch({ disableThinking })}
          />
          <ToggleRow
            testId="llm-enable-tools"
            label="启用工具"
            checked={draft.enableTools}
            onChange={(enableTools) => patch({ enableTools })}
          />
          <ToggleRow
            testId="llm-structured"
            label="JSON 模式"
            checked={draft.supportsStructuredOutputs}
            onChange={(supportsStructuredOutputs) => patch({ supportsStructuredOutputs })}
          />
          <p className="text-[11px] leading-snug text-muted-foreground">
            JSON 模式让翻译走 response_format: json_object。这里不会发送 json_schema，因为 DeepSeek 的兼容接口不接受它。关掉之后改为从回复文本里截取 JSON。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="llm-save"
              className="rounded-md bg-foreground px-3 py-1.5 text-[12px] font-medium text-background"
              onClick={onSaveClick}
            >
              保存
            </button>
            <button
              type="button"
              data-testid="llm-test"
              className="rounded-md border border-border px-3 py-1.5 text-[12px] font-medium"
              onClick={onTestClick}
              disabled={testing}
            >
              {testing ? '测试中…' : '测试连接'}
            </button>
          </div>
          {status && <p data-testid="llm-save-status" className="text-[12px] text-foreground">{status}</p>}
          {error && <p data-testid="llm-save-error" role="alert" className="text-[12px] text-destructive">{error}</p>}
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-[14px] font-semibold text-foreground">学习记录</h2>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            记录存在本机 IndexedDB。导出的 JSON 不含 API Key。每条记录带 updatedAt、deletedAt、dirty，方便以后做云同步。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="records-export" className="rounded-md border border-border px-3 py-1.5 text-[12px]" onClick={() => void onExport()}>
            导出 JSON
          </button>
          <label className="rounded-md border border-border px-3 py-1.5 text-[12px]">
            导入 JSON
            <input
              data-testid="records-import"
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                void onImport(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </label>
          <button
            type="button"
            data-testid="records-clear"
            className="rounded-md border border-border px-3 py-1.5 text-[12px]"
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              void clearLearningData().then(() => {
                setConfirmClear(false);
                setImportMsg('已清空学习记录');
              });
            }}
          >
            {confirmClear ? '确认清空' : '清空学习记录'}
          </button>
        </div>
        {importMsg && <p data-testid="records-import-status" className="mt-2 text-[12px] text-muted-foreground">{importMsg}</p>}
      </section>
    </div>
  );
}

function ToggleRow({
  testId,
  label,
  checked,
  onChange,
}: {
  testId: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-[13px]">
      <span className="font-medium">{label}</span>
      <input
        data-testid={testId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
