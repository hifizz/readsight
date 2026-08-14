import { useState, useRef, useEffect } from "react";
import {
  Puzzle,
  History,
  Pin,
  X,
  Volume2,
  ChevronDown,
  Plus,
  ArrowUp,
} from "lucide-react";

// ── 模拟数据（真实环境里来自 /lookup + SelectionContext）────────────────
const SELECTION = {
  type: "word",
  source: "techcrunch.com",
  title: "Nuclear startup Deep Fission says it's going public…",
  selected: "changed",
  sentence:
    'One thing that hasn\u2019t changed: The new S-1 statement contains the same \u201Cgoing concern\u201D language\u2026',
};

// 词典结果：简体统一（修掉繁简混用），例句拆行
const ENTRY = {
  surface: "changed",
  lemma: "change",
  ipa: "/t\u0283e\u026And\u0292/",
  senses: [
    {
      pos: "\u540D\u8BCD",
      items: [
        {
          def: "The process of becoming different.",
          zh: "\u53D8\u5316\uFF1B\u53D8\u5316\u8FC7\u7A0B",
          ex: ["The product is undergoing a change in order to improve it."],
        },
        {
          def: "Money given back when a payment exceeds the price.",
          zh: "\u96F6\u94B1\uFF1B\u627E\u96F6",
          ex: ["Can I get change for this $100 bill please?"],
        },
      ],
    },
    {
      pos: "\u52A8\u8BCD",
      items: [
        {
          def: "To become something different.",
          zh: "\u6539\u53D8\uFF1B\u53D8\u5F97\u4E0D\u540C",
          ex: [
            "The tadpole changed into a frog.",
            "Stock prices are constantly changing.",
          ],
        },
        {
          def: "To make something into something else.",
          zh: "\u628A\u2026\u2026\u53D8\u6210\uFF1B\u66F4\u6539",
          ex: [
            "The fairy changed the frog into a prince.",
            "I had to change the wording of the ad so it would fit.",
          ],
        },
      ],
    },
  ],
};

// 种子化追问建议：贴着 changed 这个词 + 本句语境
const SEEDS = [
  "\u5728\u8FD9\u53E5\u91CC changed \u662F\u4EC0\u4E48\u610F\u601D\uFF1F",
  "hasn\u2019t changed \u7684\u8A00\u4E0B\u4E4B\u610F",
  "\u8FA8\u6790\uFF1Achange / alter / modify",
  "\u7528 change \u9020\u4E2A\u7C7B\u4F3C\u8BED\u5883\u7684\u53E5\u5B50",
];

const C = {
  page: "#f4f4f3",
  panel: "#ffffff",
  text: "#1d1d1b",
  sub: "#6c6c6a",
  faint: "#9a9a97",
  border: "#ececea",
  badge: "#f3f3f1",
  green: "#16a34a",
  ctx: "#fafaf9",
  bubble: "#f3f3f1",
  font: '"Inter", -apple-system, "Segoe UI", system-ui, sans-serif',
  mono: '"SF Mono", "JetBrains Mono", ui-monospace, monospace',
};

function speak(word) {
  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(word));
  }
}

export default function SidePanelChatPreview() {
  const [tab, setTab] = useState("chat");
  const [dictOpen, setDictOpen] = useState(true);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const threadRef = useRef(null);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, pending]);

  function send(text) {
    const t = (text ?? input).trim();
    if (!t || pending) return;
    setMessages((m) => [...m, { role: "user", text: t }]);
    setInput("");
    setPending(true);
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            "\uFF08\u6F14\u793A\u56DE\u590D\uFF09\u5728\u672C\u53E5 \u201Chasn\u2019t changed\u201D \u91CC\uFF0Cchanged \u662F\u52A8\u8BCD change \u7684\u8FC7\u53BB\u5206\u8BCD\uFF0C\u8868\u793A\u201C\uFF08\u72B6\u51B5\uFF09\u53D1\u751F\u53D8\u5316\u201D\u3002\u8FDE\u63A5\u5230\u4F60\u7684 /chat \u540E\uFF0C\u8FD9\u91CC\u4F1A\u6D41\u5F0F\u8FD4\u56DE\u7ED3\u5408\u8BED\u5883\u7684\u5730\u9053\u89E3\u91CA\u3002",
        },
      ]);
      setPending(false);
    }, 450);
  }

  return (
    <div
      style={{
        minHeight: 820,
        background: C.page,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: "24px 0",
        fontFamily: C.font,
      }}
    >
      {/* 侧栏外框（窄高，模拟 Chrome side panel）*/}
      <div
        style={{
          width: 392,
          height: 760,
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        {/* ── 单一顶栏（砍掉重复那层）── */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "13px 15px",
            borderBottom: `1px solid ${C.border}`,
            flexShrink: 0,
          }}
        >
          <Puzzle size={19} color={C.green} strokeWidth={2} />
          <span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>
            English Agent
          </span>
          <div style={{ flex: 1 }} />
          <IconBtn title="历史记录">
            <History size={17} color={C.sub} />
          </IconBtn>
          <IconBtn title="钉住">
            <Pin size={16} color={C.faint} />
          </IconBtn>
          <IconBtn title="关闭">
            <X size={17} color={C.sub} />
          </IconBtn>
        </header>

        {/* ── 标签栏 ── */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: "8px 12px 0",
            flexShrink: 0,
          }}
        >
          <Tab active={tab === "chat"} onClick={() => setTab("chat")}>
            当前对话
          </Tab>
          <Tab active={tab === "records"} onClick={() => setTab("records")}>
            学习记录
          </Tab>
        </div>
        <div style={{ borderBottom: `1px solid ${C.border}`, marginTop: -1 }} />

        {tab === "chat" ? (
          <>
            {/* ── 滚动区：语境卡 + 词典卡 + 线程 ── */}
            <div
              ref={threadRef}
              style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}
            >
              {/* 语境卡（钉住，不进对话流）*/}
              <div
                style={{
                  background: C.ctx,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      color: C.sub,
                      background: C.badge,
                      padding: "1px 7px",
                      borderRadius: 5,
                    }}
                  >
                    {SELECTION.type}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: C.faint,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {SELECTION.title}
                  </span>
                </div>
                <div
                  style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 3 }}
                >
                  “{SELECTION.selected}”
                </div>
                <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.5 }}>
                  {SELECTION.sentence}
                </div>
              </div>

              {/* 词典卡（线程首卡，可折叠）*/}
              <DictCard open={dictOpen} onToggle={() => setDictOpen((o) => !o)} />

              {/* 线程 / 种子化空态 */}
              {messages.length === 0 && !pending ? (
                <div style={{ marginTop: 16 }}>
                  <div
                    style={{ fontSize: 12.5, color: C.faint, marginBottom: 9 }}
                  >
                    想就 “{ENTRY.lemma}” 接着问点什么？
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                    {SEEDS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        style={{
                          textAlign: "left",
                          fontSize: 13,
                          color: C.text,
                          background: C.panel,
                          border: `1px solid ${C.border}`,
                          borderRadius: 9,
                          padding: "9px 12px",
                          cursor: "pointer",
                          fontFamily: C.font,
                        }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12,
                  }}
                >
                  {messages.map((m, i) =>
                    m.role === "user" ? (
                      <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                        <div
                          style={{
                            maxWidth: "82%",
                            background: C.bubble,
                            borderRadius: 14,
                            padding: "8px 13px",
                            fontSize: 13.5,
                            color: C.text,
                            lineHeight: 1.5,
                          }}
                        >
                          {m.text}
                        </div>
                      </div>
                    ) : (
                      <div
                        key={i}
                        style={{
                          fontSize: 13.5,
                          color: C.text,
                          lineHeight: 1.65,
                          padding: "0 2px",
                        }}
                      >
                        {m.text}
                      </div>
                    )
                  )}
                  {pending && (
                    <div style={{ fontSize: 13, color: C.faint, padding: "0 2px" }}>
                      正在思考…
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── 输入框（Assistant UI 风）── */}
            <div style={{ padding: "10px 14px 14px", flexShrink: 0 }}>
              <div
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 16,
                  padding: "10px 12px 8px",
                  background: C.panel,
                }}
              >
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && send()}
                  placeholder="问点关于这个词的用法…"
                  style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    fontSize: 14,
                    color: C.text,
                    background: "transparent",
                    fontFamily: C.font,
                    marginBottom: 8,
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <IconBtn title="附加">
                    <Plus size={18} color={C.sub} />
                  </IconBtn>
                  <button
                    onClick={() => send()}
                    disabled={!input.trim()}
                    title="发送"
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      border: "none",
                      background: input.trim() ? C.text : "#c9c9c6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: input.trim() ? "pointer" : "default",
                      transition: "background 0.15s",
                    }}
                  >
                    <ArrowUp size={17} color="#fff" />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          // ── 学习记录：头顶干净，无词典残留 ──
          <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px" }}>
            {[
              { w: "changed", l: "change", pos: "动", n: 4, tags: ["查询"] },
              { w: "hydraulic", l: "hydraulic", pos: "形", n: 14, tags: ["查询"] },
              { w: "refused", l: "refuse", pos: "动", n: 4, tags: ["查询"] },
              { w: "according", l: "accord", pos: "动", n: 3, tags: ["查询"] },
              { w: "Capital", l: "capital", pos: "名", n: 6, tags: ["查询", "深聊"] },
            ].map((r) => (
              <div
                key={r.w}
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "11px 13px",
                  marginBottom: 9,
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.text }}>
                    {r.w}
                  </span>
                  <span style={{ fontSize: 12, color: C.faint }}>
                    ({r.l}) · {r.pos}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 7 }}>
                  <Pill>{r.n} 次</Pill>
                  {r.tags.map((t) => (
                    <Pill key={t}>{t}</Pill>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DictCard({ open, onToggle }) {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "11px 13px",
          cursor: "pointer",
          background: C.ctx,
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 600, color: C.text }}>
          {ENTRY.lemma}
        </span>
        <span style={{ fontSize: 12, color: C.faint }}>
          来自 “{ENTRY.surface}”
        </span>
        <div style={{ flex: 1 }} />
        <ChevronDown
          size={17}
          color={C.sub}
          style={{
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.18s",
          }}
        />
      </div>

      {open && (
        <div style={{ padding: "4px 13px 13px" }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}
          >
            <span style={{ fontFamily: C.mono, fontSize: 14, color: C.text }}>
              {ENTRY.ipa}
            </span>
            <button
              onClick={() => speak(ENTRY.lemma)}
              title="发音（Tier 0）"
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                padding: 2,
                display: "flex",
              }}
            >
              <Volume2 size={17} color={C.sub} />
            </button>
          </div>

          {ENTRY.senses.map((s) => (
            <div key={s.pos} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.faint,
                  letterSpacing: 0.4,
                  marginBottom: 7,
                }}
              >
                {s.pos}
              </div>
              {s.items.map((it, i) => (
                <div key={i} style={{ marginBottom: 11, display: "flex", gap: 8 }}>
                  <span style={{ fontSize: 13, color: C.faint, flexShrink: 0 }}>
                    {i + 1}.
                  </span>
                  <div>
                    <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.5 }}>
                      {it.def}
                    </div>
                    <div style={{ fontSize: 13, color: C.sub, margin: "2px 0 5px" }}>
                      {it.zh}
                    </div>
                    {it.ex.map((e, j) => (
                      <div
                        key={j}
                        style={{
                          fontSize: 12.5,
                          color: C.faint,
                          fontStyle: "italic",
                          lineHeight: 1.55,
                        }}
                      >
                        — {e}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({ children, title }) {
  return (
    <button
      title={title}
      style={{
        border: "none",
        background: "transparent",
        cursor: "pointer",
        padding: 4,
        display: "flex",
        alignItems: "center",
        borderRadius: 6,
      }}
    >
      {children}
    </button>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: C.font,
        fontSize: 13.5,
        fontWeight: active ? 600 : 400,
        color: active ? C.text : C.sub,
        background: "transparent",
        border: "none",
        borderBottom: `2px solid ${active ? C.text : "transparent"}`,
        padding: "7px 10px 9px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Pill({ children }) {
  return (
    <span
      style={{
        fontSize: 11.5,
        color: C.sub,
        background: C.badge,
        padding: "2px 9px",
        borderRadius: 6,
      }}
    >
      {children}
    </span>
  );
}