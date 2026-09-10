export interface ClozeItem {
  sentence: string;
  answer: string;
}

/**
 * Parses cloze text/HTML into a list of { sentence, answer } items.
 * Sentence is guaranteed to contain a blank marker '______'.
 */
export function parseClozeItems(cloze: string | null, fallbackWord: string): ClozeItem[] {
  if (!cloze || !cloze.trim()) {
    return [
      {
        sentence: `Complete the sentence using "${fallbackWord}": She wanted to ______ the project on time.`,
        answer: fallbackWord.trim(),
      },
    ];
  }

  // Split by <li> tags if present, otherwise by line breaks
  const rawItems = cloze.includes("<li")
    ? cloze.split(/<\/?li>/i).map((s) => s.trim()).filter(Boolean)
    : cloze.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  const items: ClozeItem[] = [];

  for (const raw of rawItems) {
    // Strip container HTML tags (ol, ul, p, span) while keeping inner text
    let text = raw.replace(/<\/?(ol|ul|p|span|div)[^>]*>/gi, " ").replace(/\s+/g, " ").trim();
    if (!text || text === "<ol>" || text === "</ol>") continue;

    let answer = fallbackWord.trim();
    let sentence = text;

    // Check for arrow marker (→ or ->)
    if (text.includes("→")) {
      const parts = text.split("→");
      sentence = parts[0].trim();
      answer = parts[1].trim();
    } else if (text.includes("->")) {
      const parts = text.split("->");
      sentence = parts[0].trim();
      answer = parts[1].trim();
    }

    // Strip leading numbers or bullets like "1. ", "• "
    sentence = sentence.replace(/^[\d.)\s\-*•]+/, "").trim();

    // Ensure sentence has a blank marker ______
    if (!/_{2,}/.test(sentence)) {
      if (answer && sentence.toLowerCase().includes(answer.toLowerCase())) {
        const reg = new RegExp(answer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        sentence = sentence.replace(reg, "______");
      } else {
        sentence = `${sentence} (______)`;
      }
    }

    // Clean up answer from any remaining tag snippets or trailing punctuation
    answer = answer.replace(/<[^>]*>/g, "").replace(/[.,!?;:]+$/, "").trim();
    if (!answer) answer = fallbackWord.trim();

    if (sentence && sentence.length > 5) {
      items.push({ sentence, answer });
    }
  }

  if (items.length === 0) {
    return [
      {
        sentence: `Complete the sentence: She tried to ______ the situation.`,
        answer: fallbackWord.trim(),
      },
    ];
  }

  return items;
}
