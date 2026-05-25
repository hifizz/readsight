import React, { useState, useRef, useEffect, useCallback } from "react";

/* ------------------------------------------------------------------ *
 * 划词精读 · 气泡 + Dialog + 侧栏 seeding 行为  —— 可交互 Demo
 * 原则:
 *   - 气泡(Look up pill): 选区出现即浮现,单一动作,贴着选区上方。
 *   - Dialog: 只内联"零成本本地词典事实"(词命中才有: 音标/释义/发音)。
 *       发音 = 原地播(Tier0),不开面板。
 *       其余(语境义/用法/翻句…/深聊) = 路由进 sidePanel。
 *   - sidePanel 两种 seeding:
 *       载入·未发送 → 结构卡(WordQuick / SentenceQuick),不发对话。
 *       载入·已发送 → 组装 prompt 作为首条消息发出,流式回复。
 *   - 命门三: 选区一出现就捕获并缓存,之后只引用缓存,不再碰原生选区。
 * ------------------------------------------------------------------ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap');

:root{
  --ink:#101012; --ink-soft:#3b3b40; --muted:#8a897f; --faint:#b6b4a8;
  --line:#e9e6df; --line-2:#ddd9d0; --paper:#fbfaf6; --panel:#ffffff;
  --sel:#cfe0ff; --sel-strong:#a9c6ff; --sand:#9a7330; --sand-bg:#f6efe1;
  --good:#3a6f53; --good-bg:#eaf2ec; --chat:#3a5394; --chat-bg:#eaeef7;
  --ui:'Schibsted Grotesk','PingFang SC','Hiragino Sans GB','Microsoft YaHei',system-ui,sans-serif;
  --read:'Newsreader','Songti SC',Georgia,serif;
}
*{box-sizing:border-box;}
.app{min-height:100vh;background:
  radial-gradient(1200px 600px at 80% -10%, #f4f1ea 0%, transparent 60%),
  var(--paper);
  font-family:var(--ui);color:var(--ink);-webkit-font-smoothing:antialiased;}
.reader{max-width:680px;margin:0 auto;padding:56px 28px 160px;}
.hint{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted);
  background:#fff;border:1px solid var(--line);border-radius:999px;padding:7px 14px;margin-bottom:38px;}
.hint b{color:var(--ink-soft);font-weight:600;}
.kicker{font-size:11px;font-weight:700;letter-spacing:.22em;color:#0b8f5a;text-transform:uppercase;margin-bottom:14px;}
.headline{font-family:var(--read);font-weight:600;font-size:40px;line-height:1.12;letter-spacing:-.01em;margin:0 0 16px;}
.byline{font-size:13px;color:var(--muted);margin-bottom:34px;}
.byline span{color:var(--ink-soft);font-weight:600;}
.prose p{font-family:var(--read);font-size:20px;line-height:1.72;color:var(--ink-soft);margin:0 0 26px;}
.prose ::selection{background:var(--sel);color:var(--ink);}

/* ---- Look up pill ---- */
.pill{position:fixed;z-index:80;display:inline-flex;align-items:center;gap:7px;
  background:var(--ink);color:#fff;border:none;border-radius:999px;
  padding:8px 14px 8px 12px;font-family:var(--ui);font-size:13px;font-weight:600;cursor:pointer;
  box-shadow:0 6px 20px rgba(16,16,18,.28),0 1px 3px rgba(16,16,18,.4);
  transform:translateX(-50%);transform-origin:50% 120%;
  animation:pill-in .16s cubic-bezier(.2,.8,.3,1.1) both;}
.pill:hover{background:#26262a;}
.pill:active{transform:translateX(-50%) scale(.96);}
@keyframes pill-in{from{opacity:0;transform:translateX(-50%) translateY(5px) scale(.92);}
  to{opacity:1;transform:translateX(-50%) translateY(0) scale(1);}}

/* ---- Dialog ---- */
.dialog{position:fixed;z-index:90;width:340px;background:var(--panel);
  border:1px solid var(--line);border-radius:16px;overflow:hidden;
  box-shadow:0 18px 50px rgba(20,18,12,.16),0 2px 8px rgba(20,18,12,.08);
  animation:dlg-in .17s cubic-bezier(.2,.8,.3,1.05) both;}
@keyframes dlg-in{from{opacity:0;transform:translateY(-6px) scale(.97);}
  to{opacity:1;transform:translateY(0) scale(1);}}
.dlg-head{display:flex;align-items:center;gap:10px;padding:14px 14px 11px;}
.badge{font-size:10.5px;font-weight:700;letter-spacing:.1em;color:var(--muted);
  background:#f1efe9;border:1px solid var(--line);padding:3px 8px;border-radius:7px;text-transform:uppercase;flex:none;}
.dlg-title{font-size:18px;font-weight:600;color:var(--ink);flex:1;font-family:var(--read);
  letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.icon-btn{flex:none;display:grid;place-items:center;width:26px;height:26px;border:none;background:transparent;
  color:var(--faint);border-radius:7px;cursor:pointer;}
.icon-btn:hover{color:var(--ink);background:#f3f1eb;}

.dict{padding:0 14px 13px;}
.ipa-row{display:flex;align-items:center;gap:10px;margin-bottom:11px;flex-wrap:wrap;}
.ipa{display:flex;align-items:baseline;gap:6px;font-size:14px;color:var(--ink-soft);}
.ipa em{font-style:normal;font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--faint);text-transform:uppercase;}
.speak{display:grid;place-items:center;width:30px;height:30px;border-radius:9px;border:1px solid var(--line);
  background:#faf8f3;color:var(--ink);cursor:pointer;position:relative;flex:none;transition:.12s;}
.speak:hover{border-color:var(--line-2);background:#f4f1ea;}
.speak.on::after{content:"";position:absolute;inset:-4px;border-radius:12px;border:2px solid var(--sel-strong);
  animation:ring 1s ease-out infinite;}
@keyframes ring{0%{opacity:.9;transform:scale(.85);}100%{opacity:0;transform:scale(1.25);}}
.defs{font-size:13.5px;line-height:1.6;color:var(--ink-soft);}
.defs .pos{color:var(--muted);font-style:italic;margin-right:6px;}
.defs div{margin-bottom:2px;}
.tags{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}
.tag{font-size:10.5px;font-weight:600;letter-spacing:.02em;color:var(--sand);background:var(--sand-bg);
  border-radius:6px;padding:3px 7px;}
.miss{padding:2px 14px 12px;font-size:13px;color:var(--muted);display:flex;align-items:center;gap:8px;}
.miss .est{font-size:10.5px;font-weight:700;color:#a06b1f;background:#f7eede;border-radius:6px;padding:2px 7px;letter-spacing:.04em;}

.divider{height:1px;background:var(--line);margin:0 14px;}
.sec-label{font-size:11.5px;color:var(--muted);padding:11px 14px 0;}
.actions{display:flex;flex-wrap:wrap;gap:8px;padding:8px 14px 13px;}
.act{border:1px solid var(--line);background:#fff;border-radius:10px;padding:7px 12px;font-size:13px;
  font-weight:500;color:var(--ink);cursor:pointer;font-family:var(--ui);transition:.12s;}
.act:hover{background:#faf8f3;border-color:var(--line-2);transform:translateY(-1px);}
.act:active{transform:translateY(0);}

.input-row{display:flex;gap:8px;align-items:center;padding:11px;border-top:1px solid var(--line);background:#fcfbf7;}
.input{flex:1;border:1px solid var(--line);border-radius:10px;padding:8px 11px;font-size:13px;font-family:var(--ui);
  outline:none;background:#fff;color:var(--ink);transition:.12s;}
.input::placeholder{color:var(--faint);}
.input:focus{border-color:var(--ink);}
.send{display:inline-flex;align-items:center;gap:6px;background:var(--ink);color:#fff;border:none;border-radius:10px;
  padding:8px 13px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--ui);transition:.12s;flex:none;}
.send:hover{background:#26262a;}

/* ---- Side panel ---- */
.scrim{position:fixed;inset:0;background:rgba(20,18,12,.12);z-index:65;opacity:0;pointer-events:none;transition:.3s;}
.scrim.show{opacity:1;pointer-events:auto;}
.panel{position:fixed;top:0;right:0;bottom:0;width:392px;max-width:92vw;z-index:70;background:var(--panel);
  border-left:1px solid var(--line);display:flex;flex-direction:column;
  box-shadow:-24px 0 60px rgba(20,18,12,.12);transform:translateX(100%);transition:transform .34s cubic-bezier(.25,.9,.3,1);}
.panel.open{transform:translateX(0);}
.p-head{display:flex;align-items:center;gap:10px;padding:16px 16px 14px;border-bottom:1px solid var(--line);}
.p-head .t{font-size:15px;font-weight:700;letter-spacing:-.01em;flex:1;}
.tab{font-size:12.5px;color:var(--faint);font-weight:600;}
.tab.active{color:var(--ink);}
.behav{font-size:10.5px;font-weight:700;letter-spacing:.03em;border-radius:7px;padding:4px 9px;}
.behav.card{color:var(--good);background:var(--good-bg);}
.behav.chat{color:var(--chat);background:var(--chat-bg);}
.p-body{flex:1;overflow:auto;padding:16px;}

.ctx{border:1px solid var(--line);border-radius:13px;padding:13px 14px;background:#fbfaf6;margin-bottom:16px;}
.ctx .lab{font-size:10.5px;font-weight:700;letter-spacing:.1em;color:var(--faint);text-transform:uppercase;margin-bottom:8px;}
.ctx .sent{font-family:var(--read);font-size:15px;line-height:1.62;color:var(--ink-soft);}
.ctx mark{background:var(--sel);color:var(--ink);border-radius:3px;padding:0 2px;}
.ctx .src{display:flex;align-items:center;gap:6px;font-size:11.5px;color:var(--muted);margin-top:11px;
  padding-top:10px;border-top:1px dashed var(--line);}
.ctx .cap{font-size:10.5px;color:var(--faint);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;margin-top:7px;}

.card .row{padding:11px 0;border-bottom:1px solid var(--line);}
.card .row:last-child{border-bottom:none;}
.card .k{font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--muted);text-transform:uppercase;margin-bottom:5px;}
.card .v{font-size:14px;line-height:1.6;color:var(--ink-soft);}
.card .v .en{font-family:var(--read);color:var(--ink);}
.chip-en{display:inline-block;font-size:12.5px;background:#f3f1eb;border:1px solid var(--line);border-radius:7px;
  padding:3px 8px;margin:0 6px 6px 0;color:var(--ink-soft);}

.msg{margin-bottom:14px;display:flex;}
.msg.user{justify-content:flex-end;}
.bubble{max-width:84%;padding:10px 13px;border-radius:14px;font-size:14px;line-height:1.6;}
.msg.user .bubble{background:var(--ink);color:#fff;border-bottom-right-radius:5px;}
.msg.bot .bubble{background:#f4f2ec;color:var(--ink-soft);border-bottom-left-radius:5px;font-family:var(--ui);}
.caret{display:inline-block;width:7px;height:15px;background:var(--ink);margin-left:1px;vertical-align:-2px;animation:bl .9s steps(2) infinite;}
@keyframes bl{50%{opacity:0;}}
.p-empty{color:var(--muted);font-size:13.5px;text-align:center;margin-top:40px;line-height:1.6;}
`;

/* ---------- icons ---------- */
const Sparkle = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}>
    <path d="M12 2l1.9 5.6L19.5 9.5 13.9 11.4 12 17l-1.9-5.6L4.5 9.5 10.1 7.6 12 2z" />
    <path d="M19 14l.8 2.4L22 17.2l-2.2.8L19 20l-.8-2L16 17.2l2.2-.8L19 14z" opacity=".85" />
  </svg>
);
const Speaker = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7" /><path d="M18.5 5.5a9 9 0 010 13" />
  </svg>
);
const Close = (p) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const Chat = (p) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d="M21 11.5a8.5 8.5 0 01-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1121 11.5z" />
  </svg>
);
const Globe = (p) => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
    <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
  </svg>
);

/* ---------- mock ECDICT ---------- */
const DICT = {
  expansive: {
    us: "/ɪkˈspænsɪv/", uk: "/ɪkˈspænsɪv/", pos: "adj.",
    defs: ["广阔的；辽阔的", "（范围、程度）广泛的；可扩张的", "（人）健谈的；豪爽的"],
    tags: ["CET6", "TOEFL", "考研"],
    ctx: {
      meaning: "形容权限“范围广、覆盖面大”，不是字面的“开阔的”。",
      trans: "宽泛的、范围很大的（权限）→ 这里可译“广泛的访问权限”。",
      example: { en: "Bee needs expansive mobile permissions.", zh: "Bee 需要范围很广的手机权限。" },
      collo: ["expansive permissions", "expansive access", "an expansive view"],
      near: ["broad（中性最常用）", "wide-ranging（强调涉及面）", "sweeping（偏“大刀阔斧”）"],
    },
    chat: "在这句话里，expansive 不是字面的“开阔的”，而是形容 Bee 索取的权限范围很广、覆盖面很大——位置、照片、通讯录、日历、通知几乎样样都要。\n\n想更地道，可以用 broad / wide-ranging / sweeping permissions。要我把整句也顺一遍吗？",
  },
  permissions: {
    us: "/pərˈmɪʃənz/", uk: "/pəˈmɪʃ(ə)nz/", pos: "n.",
    defs: ["许可；准许", "（计算机/App）权限"], tags: ["CET4"],
  },
  notifications: {
    us: "/ˌnoʊtɪfɪˈkeɪʃənz/", uk: "/ˌnəʊtɪfɪˈkeɪʃ(ə)nz/", pos: "n.",
    defs: ["通知；通告", "（手机）推送通知"], tags: ["CET4"],
  },
  accumulation: {
    us: "/əˌkjuːmjəˈleɪʃən/", uk: "/əˌkjuːmjʊˈleɪʃ(ə)n/", pos: "n.",
    defs: ["积累；累积", "积聚物"], tags: ["CET6", "考研"],
  },
  enthusiast: {
    us: "/ɪnˈθuːziæst/", uk: "/ɪnˈθjuːziæst/", pos: "n.",
    defs: ["热衷者；爱好者", "狂热分子"], tags: ["CET6", "TOEFL"],
  },
};

function classify(text) {
  const t = text.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 1 && /^[A-Za-z][A-Za-z'’-]*$/.test(t)) return "word";
  const sentences = (t.match(/[.!?。！？]/g) || []).length;
  if (sentences >= 2 || words.length > 26) return "multi";
  if (words.length <= 4 && sentences === 0) return "phrase";
  return "sentence";
}

const TYPE_BADGE = { word: "WORD", phrase: "PHRASE", sentence: "SENTENCE", multi: "PARAGRAPH" };
const TYPE_ACTIONS = {
  word: [{ k: "ctx", label: "本句义", seed: "card" }, { k: "usage", label: "用法搭配", seed: "card" }],
  phrase: [{ k: "ctx", label: "整体含义", seed: "card" }, { k: "usage", label: "地道用法", seed: "chat" }],
  sentence: [{ k: "trans", label: "翻句", seed: "chat" }, { k: "grammar", label: "析语法", seed: "card" }, { k: "rewrite", label: "改写", seed: "chat" }, { k: "hard", label: "难点", seed: "chat" }],
  multi: [{ k: "trans", label: "翻译", seed: "chat" }, { k: "glossary", label: "术语表", seed: "card" }],
};

function ulid() {
  const c = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let s = "01J";
  for (let i = 0; i < 7; i++) s += c[Math.floor(Math.random() * 32)];
  return s;
}

const SENTENCE = "Indeed, to work well, Bee needs expansive mobile permissions — including access to your location, photos, phone contacts, calendar, and mobile notifications.";

export default function App() {
  const articleRef = useRef(null);
  const dialogRef = useRef(null);
  const pillRef = useRef(null);
  const streamRef = useRef(null);

  const [cap, setCap] = useState(null);      // 捕获并缓存的 SelectionContext (简版)
  const [pill, setPill] = useState(false);
  const [dlg, setDlg] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [draft, setDraft] = useState("");

  const [panel, setPanel] = useState({ open: false, mode: null, seed: null, sel: null });
  const [stream, setStream] = useState({ target: "", shown: "", done: true });

  /* ---- 选区捕获(命门三: 立刻抓、缓存,之后只引用) ---- */
  const onUp = useCallback(() => {
    setTimeout(() => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) return;
      const text = s.toString().trim();
      if (!text) return;
      const range = s.getRangeAt(0);
      if (!articleRef.current || !articleRef.current.contains(range.commonAncestorContainer)) return;
      const r = range.getBoundingClientRect();
      setCap({
        id: ulid(),
        text,
        type: classify(text),
        rect: { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width },
      });
      setPill(true);
      setDlg(false);
    }, 0);
  }, []);

  useEffect(() => {
    const onDown = (e) => {
      if (dialogRef.current && dialogRef.current.contains(e.target)) return;
      if (pillRef.current && pillRef.current.contains(e.target)) return;
      setDlg(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  /* ---- 发音: 原地播(Tier0) ---- */
  const speak = (word) => {
    setSpeaking(true);
    try {
      const synth = window.speechSynthesis;
      if (synth) {
        synth.cancel();
        const u = new SpeechSynthesisUtterance(word);
        u.lang = "en-US"; u.rate = 0.95;
        u.onend = () => setSpeaking(false);
        u.onerror = () => setSpeaking(false);
        synth.speak(u);
        setTimeout(() => setSpeaking(false), 2200);
        return;
      }
    } catch (e) { /* noop */ }
    setTimeout(() => setSpeaking(false), 900);
  };

  /* ---- 路由进 sidePanel ---- */
  const route = (action, message) => {
    if (!cap) return;
    setDlg(false);
    const seed = action.seed; // 'card' | 'chat'
    setPanel({ open: true, mode: action.k, seed, sel: cap });
    if (seed === "chat") {
      const entry = DICT[cap.text.toLowerCase()];
      const target = entry?.chat ||
        `好的，我来结合这句话讲讲「${cap.text}」。\n\n（这是 demo 的占位回复，真实里走 /chat mode=chat，带着语境卡里的所在句流式返回。）`;
      const userMsg = message || `“${cap.text}” 在这句里怎么理解？`;
      setStream({ target, shown: "", done: false, userMsg });
    } else {
      setStream({ target: "", shown: "", done: true, userMsg: null });
    }
  };

  /* ---- 流式打字机 ---- */
  useEffect(() => {
    if (stream.done || !stream.target) return;
    let i = 0;
    streamRef.current = setInterval(() => {
      i += 1;
      setStream((s) => {
        if (i >= s.target.length) { clearInterval(streamRef.current); return { ...s, shown: s.target, done: true }; }
        return { ...s, shown: s.target.slice(0, i) };
      });
    }, 18);
    return () => clearInterval(streamRef.current);
  }, [stream.target, stream.done]);

  /* ---- 几何 ---- */
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const pillStyle = cap ? {
    left: Math.min(Math.max(cap.rect.left + cap.rect.width / 2, 60), vw - 60),
    top: Math.max(cap.rect.top - 44, 8),
  } : {};
  const DLG_W = 340;
  const dlgStyle = cap ? {
    left: Math.min(Math.max(cap.rect.left, 12), vw - DLG_W - 12),
    top: cap.rect.bottom + 12 + 360 > vh ? Math.max(cap.rect.top - 372, 12) : cap.rect.bottom + 12,
  } : {};

  const word = cap?.text.toLowerCase();
  const entry = cap?.type === "word" ? DICT[word] : null;
  const actions = cap ? TYPE_ACTIONS[cap.type] : [];

  return (
    <div className="app">
      <style>{CSS}</style>

      <div className="reader">
        <div className="hint">
          <Sparkle style={{ color: "#0b8f5a" }} />
          试试在文中划选 <b>expansive</b> / <b>permissions</b>（有词典）、一个生僻词（看未命中），或<b>整句</b>。
        </div>
        <div className="kicker">AI · Wearables</div>
        <h1 className="headline">The Bee AI wearable wants to hear everything you say</h1>
        <div className="byline">By <span>Maxwell Zeff</span> · TechCrunch</div>

        <div className="prose" ref={articleRef} onMouseUp={onUp}>
          <p>
            Indeed, to work well, Bee needs expansive mobile permissions — including
            access to your location, photos, phone contacts, calendar, and mobile
            notifications. You can also share your health data with it — should you,
            for whatever reason, want it to know about your sleep patterns or your
            resting heart rate.
          </p>
          <p>
            The large accumulation of data Bee collects is stored in the cloud, which —
            again, for the digital privacy enthusiast — presents its own concerns. In a
            world of constant breaches, more data simply means more risk.
          </p>
        </div>
      </div>

      {/* ---- 气泡 ---- */}
      {pill && cap && !dlg && (
        <button ref={pillRef} className="pill" style={pillStyle} onClick={() => { setDlg(true); setPill(false); }}>
          <Sparkle /> Look up
        </button>
      )}

      {/* ---- Dialog ---- */}
      {dlg && cap && (
        <div ref={dialogRef} className="dialog" style={dlgStyle}>
          <div className="dlg-head">
            <span className="badge">{TYPE_BADGE[cap.type]}</span>
            <span className="dlg-title">{cap.text}</span>
            <button className="icon-btn" onClick={() => setDlg(false)} aria-label="close"><Close /></button>
          </div>

          {/* 词命中 → 内联词典事实 */}
          {cap.type === "word" && entry && (
            <div className="dict">
              <div className="ipa-row">
                <span className="ipa"><em>US</em>{entry.us}</span>
                <span className="ipa"><em>UK</em>{entry.uk}</span>
                <button className={"speak" + (speaking ? " on" : "")} onClick={() => speak(cap.text)} aria-label="play">
                  <Speaker />
                </button>
              </div>
              <div className="defs">
                {entry.defs.map((d, i) => (
                  <div key={i}>{i === 0 && <span className="pos">{entry.pos}</span>}{d}</div>
                ))}
              </div>
              {entry.tags && (
                <div className="tags">{entry.tags.map((t) => <span className="tag" key={t}>{t}</span>)}</div>
              )}
            </div>
          )}

          {/* 词未命中 → estimated, 仅分流 */}
          {cap.type === "word" && !entry && (
            <div className="miss"><span className="est">词典未命中</span>音标/释义将走 G2P 兜底并标“估计”。</div>
          )}

          <div className="divider" />
          <div className="sec-label">
            {cap.type === "word" ? "结合本句继续 →" : "这段选区可以 →"}
          </div>
          <div className="actions">
            {actions.map((a) => (
              <button className="act" key={a.k} onClick={() => route(a)}>{a.label}</button>
            ))}
          </div>

          <div className="input-row">
            <input
              className="input"
              placeholder="自由提问…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { route({ k: "freechat", seed: "chat" }, draft.trim()); setDraft(""); } }}
            />
            <button className="send" onClick={() => { route({ k: "freechat", seed: "chat" }, draft.trim() || undefined); setDraft(""); }}>
              <Chat /> 深聊
            </button>
          </div>
        </div>
      )}

      {/* ---- side panel ---- */}
      <div className={"scrim" + (panel.open ? " show" : "")} onClick={() => setPanel((p) => ({ ...p, open: false }))} />
      <aside className={"panel" + (panel.open ? " open" : "")}>
        <div className="p-head">
          <span className="tab active">当前对话</span>
          <span className="tab">学习记录</span>
          <span style={{ flex: 1 }} />
          {panel.seed === "card" && <span className="behav card">结构卡 · 未发送</span>}
          {panel.seed === "chat" && <span className="behav chat">对话 · 已发送</span>}
          <button className="icon-btn" onClick={() => setPanel((p) => ({ ...p, open: false }))}><Close /></button>
        </div>

        <div className="p-body">
          {panel.sel && (
            <div className="ctx">
              <div className="lab">语境卡</div>
              <div className="sent" dangerouslySetInnerHTML={{ __html: highlight(SENTENCE, panel.sel.text) }} />
              <div className="src"><Globe /> techcrunch.com · The Bee AI wearable…</div>
              <div className="cap">capture() ✓ · type={panel.sel.type} · {panel.sel.id}</div>
            </div>
          )}

          {panel.open && panel.seed === "card" && <StructuredCard sel={panel.sel} mode={panel.mode} entry={DICT[panel.sel?.text.toLowerCase()]} />}

          {panel.open && panel.seed === "chat" && (
            <>
              <div className="msg user"><div className="bubble">{stream.userMsg}</div></div>
              <div className="msg bot">
                <div className="bubble">
                  {stream.shown.split("\n").map((line, i) => <div key={i} style={{ minHeight: line ? "auto" : 8 }}>{line}</div>)}
                  {!stream.done && <span className="caret" />}
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function highlight(sentence, sel) {
  if (!sel) return sentence;
  const i = sentence.toLowerCase().indexOf(sel.toLowerCase());
  if (i < 0) return sentence;
  return sentence.slice(0, i) + "<mark>" + sentence.slice(i, i + sel.length) + "</mark>" + sentence.slice(i + sel.length);
}

function StructuredCard({ sel, mode, entry }) {
  if (!sel) return null;
  const c = entry?.ctx;
  if (!c) {
    return (
      <div className="card">
        <div className="row"><div className="k">说明</div><div className="v">这是 mode=quick 的结构卡占位。真实里由 /lookup + /chat(quick) 填 WordQuick / SentenceQuick，不触发对话轮。</div></div>
      </div>
    );
  }
  if (mode === "usage") {
    return (
      <div className="card">
        <div className="row"><div className="k">高频搭配</div><div className="v">{c.collo.map((x) => <span className="chip-en" key={x}>{x}</span>)}</div></div>
        <div className="row"><div className="k">近义辨析</div><div className="v">{c.near.map((x, i) => <div key={i} style={{ marginBottom: 3 }}>{x}</div>)}</div></div>
        <div className="row"><div className="k">语域</div><div className="v">中性偏书面。</div></div>
      </div>
    );
  }
  return (
    <div className="card">
      <div className="row"><div className="k">语境义</div><div className="v">{c.meaning}</div></div>
      <div className="row"><div className="k">词性</div><div className="v">{entry.pos}</div></div>
      <div className="row"><div className="k">地道译法</div><div className="v">{c.trans}</div></div>
      <div className="row"><div className="k">例句</div><div className="v"><span className="en">{c.example.en}</span><br />{c.example.zh}</div></div>
      <div className="row"><div className="k">搭配</div><div className="v">{c.collo.map((x) => <span className="chip-en" key={x}>{x}</span>)}</div></div>
    </div>
  );
}