/**
 * 全局设置面板（sidepanel 设置标签的内容）。
 *
 * 现仅含一项：划词指示样式（dot / pill）。后续可以堆别的全局偏好。
 *
 * 写入逻辑：直接 patchSettings → chrome.storage.sync.set。content script 通过
 * subscribeSettings 自动同步，无需 messaging 中转。
 */
import { Circle, Tag } from 'lucide-react';
import {
  DEFAULT_SETTINGS,
  LANG_FALLBACK_KEY,
  patchSettings,
  resolveLangBehavior,
  useSettings,
  type LangBehavior,
  type ReadsightSettings,
  type SelectionIndicator,
} from '@/lib/settings';

export function SettingsPanel() {
  const settings = useSettings();
  const current = settings.selectionIndicator ?? DEFAULT_SETTINGS.selectionIndicator;

  return (
    <div className="flex flex-col gap-6 p-4">
      <section>
        <div className="mb-3">
          <h2 className="text-[14px] font-semibold text-foreground">外语页面默认行为</h2>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            打开外语网页时怎么处理。<b>自动翻</b>＝直接双语对照；<b>手动</b>＝安静待命，需要时点右下角按钮。
            单个网站可在该站右键菜单 / 浮动按钮菜单里单独覆盖。
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <LangBehaviorRow settings={settings} langKey="en" title="英文页面" />
          <LangBehaviorRow
            settings={settings}
            langKey={LANG_FALLBACK_KEY}
            title="其他语言"
          />
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-[14px] font-semibold text-foreground">划词指示样式</h2>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            选中文本后浮现的提示样式。圆点更安静，胶囊提示更显眼。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <IndicatorOption
            value="dot"
            current={current}
            icon={<Circle className="size-3.5 fill-current" />}
            title="圆点"
            desc="选区右上角 · 默认 · 干扰最小"
          />
          <IndicatorOption
            value="pill"
            current={current}
            icon={<Tag className="size-3.5" />}
            title="胶囊"
            desc="选区上方 · 显眼 · 老视觉"
          />
        </div>
      </section>
    </div>
  );
}

/** 单行语言行为选择：语言名 + auto/manual 二选一段控件。 */
function LangBehaviorRow({
  settings,
  langKey,
  title,
}: {
  settings: ReadsightSettings;
  langKey: string;
  title: string;
}) {
  const current = resolveLangBehavior(settings, langKey);

  function set(value: LangBehavior) {
    if (current === value) return;
    patchSettings({
      langBehavior: { ...settings.langBehavior, [langKey]: value },
    }).catch((err) => console.warn('[readsight] patchSettings failed', err));
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <span className="text-[13px] font-medium text-foreground">{title}</span>
      <div className="flex rounded-md border border-border p-0.5">
        <LangBehaviorSeg active={current === 'manual'} onClick={() => set('manual')}>
          手动
        </LangBehaviorSeg>
        <LangBehaviorSeg active={current === 'auto'} onClick={() => set('auto')}>
          自动翻
        </LangBehaviorSeg>
      </div>
    </div>
  );
}

function LangBehaviorSeg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-3 py-1 text-[12px] font-medium transition-colors ${
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function IndicatorOption({
  value,
  current,
  icon,
  title,
  desc,
}: {
  value: SelectionIndicator;
  current: SelectionIndicator;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => {
        if (active) return;
        patchSettings({ selectionIndicator: value }).catch((err) =>
          console.warn('[readsight] patchSettings failed', err),
        );
      }}
      className={`flex flex-col items-start gap-1.5 rounded-md border p-3 text-left transition-colors ${
        active
          ? 'border-foreground bg-muted'
          : 'border-border hover:bg-muted/60'
      }`}
      aria-pressed={active}
    >
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        <span className={active ? 'text-foreground' : 'text-muted-foreground'}>
          {icon}
        </span>
        {title}
      </div>
      <div className="text-[11px] leading-snug text-muted-foreground">{desc}</div>
    </button>
  );
}
