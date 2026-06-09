import { useState, useRef, useCallback } from "react";

const ACCENT = "#6C63FF";
const ACCENT_SOFT = "#EEF0FF";
const DARK = "#0F0E17";
const MID = "#4A4869";
const LIGHT = "#F7F7FC";
const BORDER = "#E2E2F0";

// ─── PDF TEXT EXTRACTION ──────────────────────────────────────────────────────

async function extractTextFromPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const typedArray = new Uint8Array(e.target.result);
        const pdfjsLib = window.pdfjsLib;
        if (!pdfjsLib) { reject(new Error("PDF library not loaded")); return; }
        pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          fullText += content.items.map((item) => item.str).join(" ") + "\n";
        }
        resolve(fullText.trim());
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

// ─── NLP UTILITIES ────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with",
  "is","are","was","were","be","been","being","have","has","had","do","does",
  "did","will","would","could","should","may","might","this","that","these",
  "those","it","its","we","you","he","she","they","their","our","your","my",
  "his","her","i","not","no","so","if","as","by","from","about","also","into",
  "more","can","all","just","than","then","when","which","who","what","how",
]);

function tokenize(text) { return text.toLowerCase().match(/\b[a-z]{3,}\b/g) || []; }

function sentences(text) {
  return text.replace(/\n+/g, " ").split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 30);
}

function wordFreq(text) {
  const freq = {};
  tokenize(text).forEach(w => { if (!STOP_WORDS.has(w)) freq[w] = (freq[w] || 0) + 1; });
  return freq;
}

function scoresentence(sent, freq) {
  const words = tokenize(sent).filter(w => !STOP_WORDS.has(w));
  if (!words.length) return 0;
  return words.reduce((sum, w) => sum + (freq[w] || 0), 0) / words.length;
}

function summarizeText(text, numSentences = 4) {
  const sents = sentences(text);
  if (sents.length <= numSentences) return sents.join(" ");
  const freq = wordFreq(text);
  const scored = sents.map((s, i) => ({ s, score: scoresentence(s, freq), i }));
  const top = scored.sort((a, b) => b.score - a.score).slice(0, numSentences).sort((a, b) => a.i - b.i);
  return top.map(t => t.s).join(" ");
}

function extractKeywords(text, n = 8) {
  const freq = wordFreq(text);
  return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w);
}

function answerQuestion(question, text) {
  const q = question.toLowerCase();
  const sents = sentences(text);
  const freq = wordFreq(text);

  if (q.includes("key") || q.includes("takeaway") || q.includes("main point") || q.includes("important")) {
    const top = [...sents].map((s, i) => ({ s, score: scoresentence(s, freq), i })).sort((a, b) => b.score - a.score).slice(0, 4).sort((a, b) => a.i - b.i);
    return "Key points:\n" + top.map((t, i) => `${i + 1}. ${t.s}`).join("\n");
  }
  if (q.includes("bullet") || q.includes("list") || q.includes("points")) {
    const top = [...sents].map((s, i) => ({ s, score: scoresentence(s, freq), i })).sort((a, b) => b.score - a.score).slice(0, 5).sort((a, b) => a.i - b.i);
    return top.map(t => `• ${t.s}`).join("\n");
  }
  if (q.includes("about") || q.includes("topic") || q.includes("what is") || q.includes("what does")) {
    const keywords = extractKeywords(text, 6);
    return `This document is about: ${keywords.join(", ")}.\n\n${summarizeText(text, 2)}`;
  }
  if (q.includes("action") || q.includes("recommend") || q.includes("suggest") || q.includes("should")) {
    const actionSents = sents.filter(s => /should|must|need|recommend|suggest|action|step|improve|consider/i.test(s));
    if (actionSents.length) return actionSents.slice(0, 3).join("\n\n");
    return "No explicit action items found.\n\n" + summarizeText(text, 2);
  }
  if (q.includes("problem") || q.includes("challenge") || q.includes("issue") || q.includes("solve")) {
    const problemSents = sents.filter(s => /problem|challenge|issue|difficult|fail|lack|limit|risk|concern/i.test(s));
    if (problemSents.length) return problemSents.slice(0, 3).join("\n\n");
    return "No explicit problems found.\n\n" + summarizeText(text, 2);
  }
  const qWords = tokenize(q).filter(w => !STOP_WORDS.has(w));
  if (qWords.length) {
    const matches = sents.map(s => { const sl = s.toLowerCase(); const hits = qWords.filter(w => sl.includes(w)).length; return { s, hits }; }).filter(m => m.hits > 0).sort((a, b) => b.hits - a.hits).slice(0, 3);
    if (matches.length) return "Most relevant sections:\n\n" + matches.map(m => m.s).join("\n\n");
  }
  return "I couldn't find a direct answer. Here's the summary:\n\n" + summarizeText(text, 3);
}

// ─── STYLES ───────────────────────────────────────────────────────────────────

const S = {
  root: { fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100vh", background: LIGHT, color: DARK, display: "flex", flexDirection: "column" },
  nav: { padding: "18px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${BORDER}`, background: "#fff" },
  logo: { fontWeight: 800, fontSize: 20, letterSpacing: "-0.5px", color: DARK, display: "flex", alignItems: "center", gap: 8 },
  logoAccent: { color: ACCENT },
  freeBadge: { background: "#E6FAF0", color: "#1A8A50", fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20 },
  main: { flex: 1, maxWidth: 760, margin: "0 auto", width: "100%", padding: "40px 20px", display: "flex", flexDirection: "column", gap: 24 },
  hero: { textAlign: "center", marginBottom: 4 },
  h1: { fontSize: 32, fontWeight: 800, letterSpacing: "-0.8px", lineHeight: 1.2, margin: "0 0 10px" },
  sub: { color: MID, fontSize: 14, margin: 0, lineHeight: 1.6 },
  freeNote: { display: "inline-flex", alignItems: "center", gap: 6, marginTop: 10, background: "#E6FAF0", color: "#1A8A50", fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20 },
  dropzone: (d) => ({ border: `2px dashed ${d ? ACCENT : BORDER}`, borderRadius: 14, padding: "32px 20px", textAlign: "center", cursor: "pointer", background: d ? ACCENT_SOFT : "#fff", transition: "all 0.2s", position: "relative" }),
  fileInput: { position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" },
  dropIcon: { fontSize: 32, marginBottom: 10, display: "block" },
  dropTitle: { fontWeight: 700, fontSize: 15, marginBottom: 4 },
  dropSub: { color: MID, fontSize: 12 },
  divider: { display: "flex", alignItems: "center", gap: 10, color: MID, fontSize: 12 },
  line: { flex: 1, height: 1, background: BORDER },
  textarea: { width: "100%", minHeight: 130, padding: 14, borderRadius: 12, border: `1px solid ${BORDER}`, fontFamily: "inherit", fontSize: 14, color: DARK, resize: "vertical", background: "#fff", outline: "none", lineHeight: 1.7, boxSizing: "border-box" },
  row: { display: "flex", gap: 10, flexWrap: "wrap" },
  btn: (primary, disabled) => ({ padding: "10px 22px", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: disabled ? "not-allowed" : "pointer", border: primary ? "none" : `1px solid ${BORDER}`, background: primary ? (disabled ? "#C5C4E8" : ACCENT) : "#fff", color: primary ? "#fff" : disabled ? "#bbb" : DARK, flex: primary ? 1 : "none", opacity: disabled ? 0.7 : 1 }),
  card: { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20 },
  cardHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 14, paddingBottom: 12, borderBottom: `1px solid ${BORDER}` },
  cardTitle: { fontWeight: 700, fontSize: 15, margin: 0 },
  summaryText: { fontSize: 14, lineHeight: 1.8, color: DARK, margin: 0, whiteSpace: "pre-wrap" },
  keywords: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 },
  kw: { background: ACCENT_SOFT, color: ACCENT, fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 20 },
  chatList: { display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, maxHeight: 300, overflowY: "auto" },
  bubble: (u) => ({ alignSelf: u ? "flex-end" : "flex-start", background: u ? ACCENT : ACCENT_SOFT, color: u ? "#fff" : DARK, padding: "10px 14px", borderRadius: u ? "16px 16px 4px 16px" : "16px 16px 16px 4px", fontSize: 13, maxWidth: "88%", lineHeight: 1.65, whiteSpace: "pre-wrap" }),
  inputRow: { display: "flex", gap: 8 },
  chatInput: { flex: 1, padding: "10px 13px", borderRadius: 10, border: `1px solid ${BORDER}`, fontFamily: "inherit", fontSize: 13, outline: "none", color: DARK },
  sendBtn: (d) => ({ padding: "10px 16px", background: d ? "#C5C4E8" : ACCENT, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: d ? "not-allowed" : "pointer" }),
  tips: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 },
  tip: { background: ACCENT_SOFT, color: ACCENT, fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 20, cursor: "pointer", border: "none", fontFamily: "inherit" },
  stats: { display: "flex", gap: 16, marginTop: 6, flexWrap: "wrap" },
  stat: { fontSize: 12, color: MID },
  statVal: { fontWeight: 700, color: DARK },
  errorMsg: { background: "#FFF0F0", border: "1px solid #FFD6D6", borderRadius: 10, padding: "12px 16px", color: "#C0392B", fontSize: 13 },
};

const SUGGESTED = [
  "What are the key takeaways?",
  "List the main points as bullets",
  "What problems are mentioned?",
  "What actions are recommended?",
];

export default function DocMind() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [summary, setSummary] = useState("");
  const [keywords, setKeywords] = useState([]);
  const [chat, setChat] = useState([]);
  const [question, setQuestion] = useState("");
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef();
  const chatEnd = useRef();

  const handleFile = async (file) => {
    if (!file) return;
    setError("");
    setSummary(""); setChat([]); setKeywords([]);
    setFileName(file.name);

    if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
      setProcessing(true);
      try {
        const extracted = await extractTextFromPDF(file);
        if (!extracted || extracted.length < 50) {
          setError("Could not extract text from this PDF. It may be scanned or image-based.");
        } else {
          setText(extracted);
        }
      } catch (e) {
        setError("Failed to read PDF. Please try a different file.");
      } finally {
        setProcessing(false);
      }
    } else {
      const reader = new FileReader();
      reader.onload = (e) => setText(e.target.result);
      reader.readAsText(file);
    }
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, []);

  const doSummarize = () => {
    if (!text.trim()) return;
    setProcessing(true);
    setTimeout(() => {
      setSummary(summarizeText(text, 4));
      setKeywords(extractKeywords(text, 8));
      setChat([]);
      setProcessing(false);
    }, 400);
  };

  const doAsk = (q) => {
    const userQ = (q || question).trim();
    if (!userQ || !text.trim()) return;
    setQuestion("");
    const answer = answerQuestion(userQ, text);
    const newChat = [...chat, { role: "user", text: userQ }, { role: "bot", text: answer }];
    setChat(newChat);
    setTimeout(() => chatEnd.current?.scrollIntoView({ behavior: "smooth" }), 50);
  };

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const sentCount = text.trim() ? sentences(text).length : 0;
  const hasDoc = text.trim().length > 0;

  return (
    <div style={S.root}>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" />
      <style>{`textarea:focus,input:focus{border-color:${ACCENT}!important;box-shadow:0 0 0 3px ${ACCENT_SOFT}} button:hover:not(:disabled){filter:brightness(0.93)}`}</style>

      <nav style={S.nav}>
        <div style={S.logo}>⚡ Doc<span style={S.logoAccent}>Mind</span></div>
        <span style={S.freeBadge}>✓ 100% Free</span>
      </nav>

      <main style={S.main}>
        <div style={S.hero}>
          <h1 style={S.h1}>Understand any document<br /><span style={{ color: ACCENT }}>instantly. No API needed.</span></h1>
          <p style={S.sub}>Paste text or upload a file — get a smart summary and ask questions about it.</p>
          <span style={S.freeNote}>🔒 Works offline · No API key · No sign-up</span>
        </div>

        <div style={S.dropzone(dragging)} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} onClick={() => fileRef.current.click()}>
          <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json,.pdf" style={S.fileInput} onChange={(e) => handleFile(e.target.files[0])} onClick={(e) => e.stopPropagation()} />
          <span style={S.dropIcon}>{processing ? "⏳" : "📄"}</span>
          <div style={S.dropTitle}>{processing ? "Reading PDF..." : fileName ? `✓ ${fileName}` : "Drop a file here"}</div>
          <div style={S.dropSub}>Supports .pdf · .txt · .md · .csv · .json</div>
        </div>

        {error && <div style={S.errorMsg}>⚠️ {error}</div>}

        <div style={S.divider}><div style={S.line} /><span>or paste text</span><div style={S.line} /></div>

        <textarea style={S.textarea} placeholder="Paste your document, article, essay, report or any text here…" value={text} onChange={(e) => { setText(e.target.value); setSummary(""); setChat([]); setKeywords([]); }} rows={6} />

        {wordCount > 0 && (
          <div style={S.stats}>
            <span style={S.stat}><span style={S.statVal}>{wordCount.toLocaleString()}</span> words</span>
            <span style={S.stat}><span style={S.statVal}>{sentCount}</span> sentences</span>
            <span style={S.stat}><span style={S.statVal}>{Math.ceil(wordCount / 200)}</span> min read</span>
          </div>
        )}

        <div style={S.row}>
          <button style={S.btn(true, !hasDoc || processing)} disabled={!hasDoc || processing} onClick={doSummarize}>
            {processing ? "⏳ Processing…" : "✨ Summarize"}
          </button>
          <button style={S.btn(false, !hasDoc)} disabled={!hasDoc} onClick={() => { setText(""); setFileName(""); setSummary(""); setChat([]); setKeywords([]); setError(""); }}>
            Clear
          </button>
        </div>

        {summary && (
          <div style={S.card}>
            <div style={S.cardHeader}><span>📝</span><h3 style={S.cardTitle}>Summary</h3></div>
            <p style={S.summaryText}>{summary}</p>
            {keywords.length > 0 && <div style={S.keywords}>{keywords.map(k => <span key={k} style={S.kw}>{k}</span>)}</div>}
          </div>
        )}

        {summary && (
          <div style={S.card}>
            <div style={S.cardHeader}><span>💬</span><h3 style={S.cardTitle}>Ask about this document</h3></div>
            {chat.length === 0 && <div style={S.tips}>{SUGGESTED.map(q => <button key={q} style={S.tip} onClick={() => doAsk(q)}>{q}</button>)}</div>}
            {chat.length > 0 && (
              <div style={S.chatList}>
                {chat.map((m, i) => <div key={i} style={S.bubble(m.role === "user")}>{m.text}</div>)}
                <div ref={chatEnd} />
              </div>
            )}
            <div style={S.inputRow}>
              <input style={S.chatInput} placeholder="Ask a question…" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doAsk()} />
              <button style={S.sendBtn(!question.trim())} disabled={!question.trim()} onClick={() => doAsk()}>Send</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
