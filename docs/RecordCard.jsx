import { Globe, ExternalLink } from "lucide-react";

const C = {
  page: "#f4f4f3",
  panel: "#ffffff",
  text: "#1d1d1b",
  sub: "#6c6c6a",
  faint: "#9a9a97",
  border: "#ececea",
  hl: "#fdeeb8",
  hlText: "#5a4300",
  font: '"Inter", -apple-system, "Segoe UI", system-ui, sans-serif',
};

const OUTCOME = {
  still_unsure: { label: "待巩固", bg: "#faeeda", fg: "#854f0b" },
  understood: { label: "已懂", bg: "#e1f5ee", fg: "#0f6e56" },
  incorrect: { label: "答错", bg: "#fcebeb", fg: "#a32d2d" },
  correct: { label: "答对", bg: "#e1f5ee", fg: "#0f6e56" },
};

function windowAround(context, selection, before = 50, after = 56) {
  if (!context || !selection) return null;
  const idx = context.toLowerCase().indexOf(selection.toLowerCase());
  if (idx === -1) return { lead: false, pre: context, match: "", post: "", trail: false };
  const start = idx, end = idx + selection.length;
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

function RecordCard({ lemma, surface, context, domain, time, outcome }) {
  const win = windowAround(context, surface);
  const oc = outcome ? OUTCOME[outcome] : null;
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 11,
        padding: "12px 14px",
        marginBottom: 10,
        cursor: "pointer",
        fontFamily: C.font,
      }}
    >
      {/* 词 + 时间 */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
          <span style={{ fontSize: 15.5, fontWeight: 600, color: C.text }}>{lemma}</span>
          {surface !== lemma && (
            <span style={{ fontSize: 12.5, color: C.faint }}>({surface})</span>
          )}
        </div>
        <span style={{ fontSize: 11.5, color: C.faint, flexShrink: 0 }}>{time}</span>
      </div>

      {/* 语境：高亮 + 开窗（卡片的真正营养）*/}
      {win && win.match && (
        <div
          style={{
            fontSize: 12.5,
            color: C.sub,
            lineHeight: 1.55,
            marginTop: 6,
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

      {/* 细 meta：来源 + 状态（仅在有产出信号时）+ 回原文 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 9,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11.5,
              color: C.faint,
            }}
          >
            <Globe size={12} color={C.faint} />
            {domain}
          </span>
          {oc && (
            <span
              style={{
                fontSize: 11,
                background: oc.bg,
                color: oc.fg,
                padding: "1px 8px",
                borderRadius: 5,
              }}
            >
              {oc.label}
            </span>
          )}
        </div>
        <button
          title="回原文"
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            padding: 3,
            display: "flex",
            color: C.faint,
          }}
        >
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}

export default function RecordsPreview() {
  const records = [
    {
      lemma: "change",
      surface: "changed",
      context:
        'One thing that hasn\u2019t changed: The new S-1 statement contains the same \u201Cgoing concern\u201D language as before.',
      domain: "techcrunch.com",
      time: "2 分钟前",
    },
    {
      lemma: "hydraulic",
      surface: "hydraulic",
      context:
        "The lander relies on hydraulic pressure to deploy its legs during the final descent.",
      domain: "techcrunch.com",
      time: "15 分钟前",
      outcome: "still_unsure",
    },
    {
      lemma: "bid shading",
      surface: "bid shading",
      context:
        "DSPs increasingly use bid shading to avoid overpaying in first-price auctions.",
      domain: "techcrunch.com",
      time: "22 分钟前",
      outcome: "understood",
    },
    {
      lemma: "refuse",
      surface: "refused",
      context: "The board refused to comment on the pending lawsuit.",
      domain: "reuters.com",
      time: "1 小时前",
    },
  ];

  return (
    <div style={{ background: C.page, padding: "24px 22px", minHeight: 600 }}>
      <div style={{ maxWidth: 380, margin: "0 auto" }}>
        {records.map((r, i) => (
          <RecordCard key={i} {...r} />
        ))}
      </div>
    </div>
  );
}