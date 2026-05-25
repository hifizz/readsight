/**
 * SeedSuggestions —— Thread 空态下的种子化追问条。
 *
 * 何时出现：当前 thread 无消息 且 selection 存在。点击 = 代用户发一条消息
 * （走 composer.setText + composer.send，跟用户手打按 Send 完全等价）。
 *
 * 非消息：列表本身不进 history，只是占位提示；只有用户点击之后的那条消息
 * 才进 messages。
 *
 * 对齐 docs/sidepanel-main.jsx 的 SEEDS 区。
 */
import { useAssistantRuntime } from '@assistant-ui/react';
import type { SelectionContext } from '@/lib/messaging';

interface SeedSuggestionsProps {
  selection: SelectionContext;
}

export function SeedSuggestions({ selection }: SeedSuggestionsProps) {
  const runtime = useAssistantRuntime();
  const seeds = seedsFor(selection);
  const anchor = displayAnchor(selection);

  function send(text: string) {
    runtime.thread.composer.setText(text);
    runtime.thread.composer.send();
  }

  return (
    <div className="mt-2">
      <div className="mb-2 text-[12px] text-muted-foreground/80">
        想就 "{anchor}" 接着问点什么？
      </div>
      <div className="flex flex-col gap-1.5">
        {seeds.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            className="rounded-[9px] border bg-background px-3 py-2 text-left text-[12.5px] text-foreground transition-colors hover:bg-muted/50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function displayAnchor(s: SelectionContext): string {
  const text = s.selection.text;
  if (text.length <= 22) return text;
  return text.slice(0, 20) + '…';
}

function seedsFor(s: SelectionContext): string[] {
  const t = s.selection.text;
  switch (s.selection.type) {
    case 'word':
      return [
        `在这句里 ${t} 是什么意思？`,
        `${t} 的言下之意`,
        `辨析：${t} 与近义词的差别`,
        `用 ${t} 造个类似语境的句子`,
      ];
    case 'phrase':
      return [
        `这个短语在本句里怎么理解？`,
        `${t} 的言下之意`,
        `更地道的说法是什么？`,
        `用 ${t} 造个类似语境的句子`,
      ];
    case 'sentence':
      return [
        `翻译这一句`,
        `拆解语法 / 难点`,
        `改写得更地道`,
        `背后的语义和言下之意`,
      ];
    case 'multi':
    default:
      return [`翻译这一段`, `这段在说什么？`, `挑出我可能不懂的难点`];
  }
}
