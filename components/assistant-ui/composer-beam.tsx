import { useAuiState } from "@assistant-ui/react";
import { BorderBeam } from "border-beam";
import type { FC, ReactNode } from "react";

/**
 * 使用 border-beam 官方 pulse-inner 效果包裹 Composer。
 * 空闲时冻结色相并降低强度；assistant-ui 生成中恢复全彩流动和完整强度。
 * Sidepanel 是纯客户端 WXT 页面，主题又直接跟随系统，因此无需 Next.js PR 中的
 * hydration gate，交给 border-beam 的 `theme="auto"` 即可。
 */
export const ComposerBeam: FC<{ children: ReactNode }> = ({ children }) => {
  const isThreadRunning = useAuiState((s) => s.thread.isRunning);
  const hasDraft = useAuiState(
    (s) => s.composer.text.length > 0 || s.composer.attachments.length > 0,
  );

  // 用户编写优先级最高：已有草稿时完全停掉 beam，避免呼吸光干扰输入。
  // 发送后草稿被清空，AI 生成期间恢复全彩效果；其余时间只是低强度待机。
  const strength = hasDraft ? 0 : isThreadRunning ? 1 : 0.55;

  return (
    <BorderBeam
      size="pulse-inner"
      colorVariant="colorful"
      theme="auto"
      active={!hasDraft}
      staticColors={!isThreadRunning}
      strength={strength}
      className="prompt-input-beam w-full rounded-(--composer-radius) shadow-[0_0_25px_-10px_rgba(15,23,42,0.15),0_3px_8px_-3px_rgba(15,23,42,0.08)] transition-shadow  focus-within:ring-3 focus-within:ring-ring/20 dark:focus-within:ring-neutral-100/20 dark:shadow-[0_12px_36px_-10px_rgba(0,0,0,0.65),0_4px_10px_-3px_rgba(0,0,0,0.45)] dark:focus-within:shadow-[0_16px_44px_-10px_rgba(0,0,0,0.72),0_5px_14px_-3px_rgba(0,0,0,0.5)]"
    >
      {children}
    </BorderBeam>
  );
};
