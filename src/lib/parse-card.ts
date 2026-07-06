// Parses the LLM structured card response into 13 fields.
// Also exposes formatters that produce the EXACT HTML expected by the Anki
// note type "English Expression Master" (13 fields, #html:true).
//
// Stored HTML uses only tags/classes referenced by the Anki templates:
//   <p class="mini-title">…</p>
//   <ul><li>…</li></ul>
//   <ol><li>…</li></ol>
//   <span class="answer-highlight">→ …</span>
//   <br> (only inside French for multi-translations)
//
// The same HTML is rendered inside the app via dangerouslySetInnerHTML — the
// classes .mini-title and .answer-highlight are defined in src/styles.css.

export interface ParsedCard {
  word: string;
  level: string;
  ipa: string;
  pos: string;
  definition: string;
  french: string;
  grammar: string;
  examples: string;
  cloze: string;
  speaking_q1: string;
  speaking_a1: string;
  speaking_q2: string;
  speaking_a2: string;
  tags: string[];
}

const HEADERS: { key: keyof ParsedCard | "SPEAKING"; label: string }[] = [
  { key: "word", label: "WORD" },
  { key: "level", label: "LEVEL" },
  { key: "ipa", label: "IPA" },
  { key: "pos", label: "PART OF SPEECH" },
  { key: "definition", label: "DEFINITION" },
  { key: "french", label: "FRENCH" },
  { key: "grammar", label: "GRAMMAR" },
  { key: "examples", label: "EXAMPLES" },
  { key: "cloze", label: "CLOZE" },
  { key: "SPEAKING", label: "SPEAKING" },
  { key: "tags", label: "TAGS" },
];

function stripParens(line: string): string {
  return line.replace(/\([^)]*\)/g, "").trim();
}

function matchesHeader(line: string, label: string): boolean {
  const t = stripParens(line).toUpperCase();
  return t === label || t.startsWith(label + " ");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Convert raw grammar lines into Anki-compatible HTML.
 * Rules:
 *  - a line ending with ":" becomes <p class="mini-title">Label:</p>
 *  - every following non-empty line (with or without leading *, -, •) becomes
 *    an <li> inside a <ul> opened right after the mini-title and closed
 *    before the next mini-title.
 */
export function formatGrammar(rawLines: string[]): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    if (/:\s*$/.test(line) && !/^\s*[*\-•]/.test(line)) {
      closeList();
      out.push(`<p class="mini-title">${escapeHtml(line.replace(/\s*:\s*$/, ""))}:</p>`);
      out.push("<ul>");
      inList = true;
    } else {
      const cleaned = line.replace(/^\s*[*\-•]\s*/, "").replace(/^\s*\d+[.)]\s*/, "");
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${escapeHtml(cleaned)}</li>`);
    }
  }
  closeList();
  return out.join("");
}

/**
 * Convert raw lines into an ordered list <ol><li>…</li></ol>.
 * When highlightArrow is true, any text after the first "→" in a line is
 * wrapped in <span class="answer-highlight">→ …</span>.
 */
export function formatOrderedList(rawLines: string[], highlightArrow = false): string {
  const items = rawLines
    .map((l) =>
      l.trim().replace(/^\s*(\d+[.)]|[-*•])\s*/, ""),
    )
    .filter(Boolean);
  const lis = items.map((raw) => {
    if (highlightArrow) {
      const idx = raw.indexOf("→");
      if (idx >= 0) {
        const q = escapeHtml(raw.slice(0, idx).trim());
        const a = escapeHtml(raw.slice(idx + 1).trim());
        return `<li>${q} <span class="answer-highlight">→ ${a}</span></li>`;
      }
    }
    return `<li>${escapeHtml(raw)}</li>`;
  });
  return `<ol>${lis.join("")}</ol>`;
}

function formatFrench(raw: string): string {
  const parts = raw
    .split(/\r?\n|;|\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return parts.map((p) => escapeHtml(p)).join("<br>");
}

export function parseCard(raw: string): ParsedCard {
  const lines = raw.split(/\r?\n/);
  const buckets: Record<string, string[]> = {};
  let current: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    let matched = false;
    for (const h of HEADERS) {
      if (matchesHeader(line, h.label)) {
        current = h.key as string;
        buckets[current] = [];
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (current) buckets[current].push(line);
  }

  const getLines = (k: string): string[] => (buckets[k] || []).map((l) => l);
  const getText = (k: string): string => getLines(k).join("\n").trim();
  const cleanInline = (s: string) => s.replace(/\r/g, "").trim();

  const speakingText = getText("SPEAKING");
  const { q1, a1, q2, a2 } = parseSpeaking(speakingText);

  return {
    word: cleanInline(getText("word")),
    level: cleanInline(getText("level")).replace(/[^A-Za-z0-9+]/g, ""),
    ipa: cleanInline(getText("ipa")),
    pos: cleanInline(getText("pos")),
    definition: cleanInline(getText("definition")),
    french: formatFrench(getText("french")),
    grammar: formatGrammar(getLines("grammar")),
    examples: formatOrderedList(getLines("examples"), false),
    cloze: formatOrderedList(getLines("cloze"), true),
    speaking_q1: q1,
    speaking_a1: a1,
    speaking_q2: q2,
    speaking_a2: a2,
  };
}

function parseSpeaking(text: string): { q1: string; a1: string; q2: string; a2: string } {
  const qs: string[] = [];
  const as: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const l of lines) {
    const q = l.match(/^\s*Question\s*:?\s*(.*)$/i);
    const a = l.match(/^\s*Answer\s*:?\s*(.*)$/i);
    if (q && q[1].trim()) qs.push(q[1].trim());
    else if (a && a[1].trim()) as.push(a[1].trim());
  }
  return {
    q1: qs[0] || "",
    a1: as[0] || "",
    q2: qs[1] || "",
    a2: as[1] || "",
  };
}

// -------- Display helpers (backwards-compatible) --------
// Fields are now stored already as HTML, so these helpers only re-format if
// they still contain raw markers (legacy rows created before this change).

function looksLikeHtml(s: string): boolean {
  return /<(ul|ol|p|span|br)\b/i.test(s);
}

export function grammarToHtml(grammar: string): string {
  if (looksLikeHtml(grammar)) return grammar;
  return formatGrammar(grammar.split(/\r?\n/));
}

export function examplesToHtml(examples: string): string {
  if (looksLikeHtml(examples)) return examples;
  return formatOrderedList(examples.split(/\r?\n/), false);
}

export function clozeToHtml(cloze: string): string {
  if (looksLikeHtml(cloze)) return cloze;
  return formatOrderedList(cloze.split(/\r?\n/), true);
}
