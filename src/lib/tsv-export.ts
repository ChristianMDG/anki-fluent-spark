// Anki TSV export with dynamic filename.

export interface ExportableCard {
  word: string;
  ipa: string;
  pos: string;
  level: string;
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

const HEADER = [
  "#separator:tab",
  "#html:true",
  "#columns:Word\tIPA\tPOS\tLevel\tDefinition\tFrench\tGrammar\tExamples\tCloze\tSpeakingQ1\tSpeakingA1\tSpeakingQ2\tSpeakingA2",
].join("\n");

function esc(s: string): string {
  // Anki TSV: tabs delimit; newlines inside a field must become <br>.
  return (s || "").replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
}

export function buildTsv(cards: ExportableCard[]): string {
  const rows = cards.map((c) =>
    [
      c.word,
      c.ipa,
      c.pos,
      c.level,
      c.definition,
      c.french,
      c.grammar,
      c.examples,
      c.cloze,
      c.speaking_q1,
      c.speaking_a1,
      c.speaking_q2,
      c.speaking_a2,
    ]
      .map(esc)
      .join("\t"),
  );
  return HEADER + "\n" + rows.join("\n") + "\n";
}

export function slugify(s: string): string {
  return (s || "card")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "card";
}

export function filenameFor(cards: ExportableCard[]): string {
  if (cards.length === 0) return "vocab.tsv";
  const first = slugify(cards[0].word);
  if (cards.length === 1) return `${first}.tsv`;
  return `${first}-et-${cards.length - 1}-autres.tsv`;
}

export function downloadTsv(cards: ExportableCard[]): void {
  const blob = new Blob([buildTsv(cards)], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFor(cards);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
