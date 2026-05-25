import { Globe } from "lucide-react";

const C = {
  page: "#f4f4f3",
  panel: "#ffffff",
  text: "#1d1d1b",
  sub: "#6c6c6a",
  faint: "#9a9a97",
  border: "#ececea",
  badge: "#f3f3f1",
  ctx: "#fafaf9",
  hl: "#fdeeb8",
  hlText: "#5a4300",
  font: '"Inter", -apple-system, "Segoe UI", system-ui, sans-serif',
};

const TYPE_LABEL = { word: "词", phrase: "短语", sentence: "句", multi: "段落" };

// 用 anchor.quote 的思路开窗：选中文本前后各截一段，两端补 …，并高亮选中文本
function windowAround(context, selection, before = 52, after = 56) {
  if (!context || !selection) return null;
  const lc = context.toLowerCase();
  const idx = lc.indexOf(selection.toLowerCase());
  if (idx === -1) return { lead: false, pre: context, match: "", post: "", trail: false };

  const start = idx;
  const end = idx + selection.length;

  let preStart = Math.max(0, start - before);
  if (preStart > 0) {
    const sp = context.indexOf(" ", preStart);
    if (sp !== -1 && sp < start) preStart = sp + 1;
  }
  let postEnd = Math.min(context.length, end + after);
  if (postEnd < context.length) {
    const sp = context.lastIndexOf(" ", postEnd);
    if (sp !== -1 && sp > end) postEnd = sp;
  }

  return {
    lead: preStart > 0,
    pre: context.slice(preStart, start),
    match: context.slice(start, end),
    post: context.slice(end, postEnd),
    trail: postEnd < context.length,
  };
}

function ContextCard({ type, selection, context, domain }) {
  const win = windowAround(context, selection);
  return (
    <div
      style={{
        width: 360,
        background: C.ctx,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "10px 13px",
        fontFamily: C.font,
      }}
    >
      {/* 来源眉：只放域名，最轻 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          fontSize: 11.5,
          color: C.faint,
          marginBottom: 8,
        }}
      >
        <Globe size={12} color={C.faint} />
        {domain}
      </div>

      {/* 选区行：类型徽章 + 选中文本（同一维度）*/}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            color: C.sub,
            background: C.badge,
            padding: "2px 7px",
            borderRadius: 5,
            flexShrink: 0,
          }}
        >
          {TYPE_LABEL[type] ?? type}
        </span>
        <span
          style={{
            fontSize: type === "word" || type === "phrase" ? 16 : 14,
            fontWeight: 600,
            color: C.text,
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {selection}
        </span>
      </div>

      {/* 语境行：高亮 + 开窗 + 两行内；没有上下文则整行不渲染 */}
      {win && win.match && (
        <div
          style={{
            fontSize: 12.5,
            color: C.sub,
            lineHeight: 1.55,
            marginTop: 7,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {win.lead && "… "}
          {win.pre}
          <span
            style={{
              background: C.hl,
              color: C.hlText,
              borderRadius: 3,
              padding: "0 2px",
              fontWeight: 600,
            }}
          >
            {win.match}
          </span>
          {win.post}
          {win.trail && " …"}
        </div>
      )}
    </div>
  );
}

function Scene({ label, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div
        style={{
          fontSize: 12,
          color: C.faint,
          marginBottom: 8,
          fontFamily: C.font,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

export default function ContextCardPreview() {
  return (
    <div
      style={{
        background: C.page,
        padding: "26px 22px",
        minHeight: 600,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div>
        <Scene label="① 词 · 有上下文 —— badge 紧跟单词，句中高亮、开窗两行">
          <ContextCard
            type="word"
            selection="changed"
            context={
              'One thing that hasn\u2019t changed: The new S-1 statement contains the same \u201Cgoing concern\u201D language as before.'
            }
            domain="techcrunch.com"
          />
        </Scene>

        <Scene label="② 词 · 上下文很长、词在靠后 —— 只开窗口、前面补 …，不铺整段">
          <ContextCard
            type="word"
            selection="shading"
            context={
              "Demand-side platforms have spent years refining their auction logic, and one of the most common techniques today is bid shading to avoid systematically overpaying in first-price auctions."
            }
            domain="techcrunch.com"
          />
        </Scene>

        <Scene label="③ 词 · 没有上下文 —— 语境行整行不渲染，卡片缩成两行">
          <ContextCard type="word" selection="serendipity" domain="en.wikipedia.org" />
        </Scene>

        <Scene label="④ 句 · 同一套规则 —— 选区是整句（clamp），所在段里高亮它">
          <ContextCard
            type="sentence"
            selection="DSPs use bid shading to avoid overpaying."
            context={
              "Auction dynamics have shifted toward first-price models. DSPs use bid shading to avoid overpaying. The net effect is lower clearing prices for the same inventory."
            }
            domain="techcrunch.com"
          />
        </Scene>
      </div>
    </div>
  );
}