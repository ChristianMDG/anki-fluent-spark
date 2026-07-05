// Parses Groq/LLM-style structured card responses using strict header markers.
// Also transforms parsed fields into HTML for display.

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
}

// Ignore parenthesised hints like "(simple English)".
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
];

function stripParens(line: string): string {
  return line.replace(/\([^)]*\)/g, "").trim();
}

function matchesHeader(line: string, label: string): boolean {
  const t = stripParens(line).toUpperCase();
  return t === label || t.startsWith(label + " ");
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

  const get = (k: string) => (buckets[k] || []).join("\n").trim();
  const speakingText = get("SPEAKING");
  const { q1, a1, q2, a2 } = parseSpeaking(speakingText);

  return {
    word: get("word"),
    level: get("level"),
    ipa: get("ipa"),
    pos: get("pos"),
    definition: get("definition"),
    french: get("french"),
    grammar: get("grammar"),
    examples: get("examples"),
    cloze: get("cloze"),
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
    if (q) qs.push(q[1].trim());
    else if (a) as.push(a[1].trim());
  }
  return {
    q1: qs[0] || "",
    a1: as[0] || "",
    q2: qs[1] || "",
    a2: as[1] || "",
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function grammarToHtml(grammar: string): string {
  const out: string[] = [];
  const lines = grammar.split(/\r?\n/);
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (/^(Structure|Used to|Common forms)\s*:/i.test(line)) {
      closeList();
      out.push(`<p class="mini-title">${escapeHtml(line.replace(/:\s*$/, ""))}</p>`);
    } else if (line.startsWith("*")) {
      if (!inList) {
        out.push('<ul class="list-disc pl-5 space-y-1 text-sm">');
        inList = true;
      }
      out.push(`<li>${escapeHtml(line.replace(/^\*\s*/, ""))}</li>`);
    } else {
      closeList();
      out.push(`<p class="text-sm">${escapeHtml(line)}</p>`);
    }
  }
  closeList();
  return out.join("\n");
}

export function examplesToHtml(examples: string): string {
  const items = examples
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d+[\.\)]|\-|\*)\s*/, "").trim())
    .filter(Boolean);
  return `<ol class="list-decimal pl-5 space-y-2">${items
    .map((i) => `<li>${escapeHtml(i)}</li>`)
    .join("")}</ol>`;
}

export function clozeToHtml(cloze: string): string {
  const items = cloze
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(\d+[\.\)]|\-|\*)\s*/, "").trim())
    .filter(Boolean);
  return `<ol class="list-decimal pl-5 space-y-2">${items
    .map((i) => {
      const idx = i.indexOf("→");
      if (idx >= 0) {
        const q = escapeHtml(i.slice(0, idx).trim());
        const a = escapeHtml(i.slice(idx + 1).trim());
        return `<li>${q} <span class="answer-highlight">→ ${a}</span></li>`;
      }
      return `<li>${escapeHtml(i)}</li>`;
    })
    .join("")}</ol>`;
}
