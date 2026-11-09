import type { Chapter } from "./types";

/**
 * Chapter segmentation. Purely structural: we look for heading patterns and
 * fall back to even splitting when a book has no recognisable headings.
 */

const CN_NUM = "〇零一二三四五六七八九十百千万两";

/**
 * Matches 第N章 / 第N节 / 第N回 / 第N卷 / 第N篇 and their Chinese numerals.
 *
 * The trailing boundary matters. Without it, a prose line like
 * "第四回中既將薛家母子在榮府內寄居等事略已表明" — which is a sentence
 * talking ABOUT a chapter, not a chapter title — is read as a heading and
 * truncates the real chapter into a 91-character stub. A heading must be
 * followed by a separator or by nothing at all.
 */
const CN_HEADING = new RegExp(
  `^\\s*(?:第\\s*[0-9０-９${CN_NUM}]+\\s*[章回节卷篇幕折](?![${CN_NUM}一-鿿])|Chapter\\s+\\d+|CHAPTER\\s+\\d+|卷[0-9０-９${CN_NUM}]+(?![${CN_NUM}])|楔\\s*子|序章|序言|序(?![${CN_NUM}一-鿿])|引子|尾声|尾聲|后记|後記|番外)`,
);

/** Matches a markdown ATX heading. */
const MD_HEADING = /^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$/;

/** Matches "1." / "一、" style numbered headings. */
const NUMBERED_HEADING = /^\s*(?:\d{1,3}[.、)]\s*\S|[0-9]{1,3}\s+[^\s].{0,40})$/;

/**
 * Front-matter headings — a preface, a prologue, a table of contents.
 *
 * These are the ONLY headings that may be folded into the following chapter.
 * A plain short chapter ("第一章" with three paragraphs) is a real chapter
 * and must survive segmentation: folding it away silently drops a chapter
 * from the book, and with it the beats an agent would have illustrated.
 */
const FRONT_MATTER_HEADING =
  /^(?:序章|序言|序|楔子|引子|前言|内容提要|目录|扉页|书前语|自序|后序)/;

interface Heading {
  title: string;
  /** Offset of the heading line itself. */
  at: number;
}

function findHeadings(text: string): Heading[] {
  const headings: Heading[] = [];
  let offset = 0;
  const lines = text.split("\n");
  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 60) continue;

    const md = trimmed.match(MD_HEADING);
    if (md) {
      headings.push({ title: md[1].trim(), at: lineStart });
      continue;
    }
    if (CN_HEADING.test(trimmed)) {
      headings.push({ title: trimmed, at: lineStart });
      continue;
    }
    // Numbered headings are only trusted when they are short and not a
    // sentence — otherwise ordinary prose gets mistaken for a heading.
    if (NUMBERED_HEADING.test(trimmed) && trimmed.length <= 40) {
      headings.push({ title: trimmed, at: lineStart });
    }
  }
  return headings;
}

/** Even-split fallback so every book yields a usable chapter list. */
function fallbackChapters(text: string, target = 12): Chapter[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];
  const size = Math.max(1, Math.ceil(paragraphs.length / target));
  for (let i = 0; i < paragraphs.length; i += size) {
    chunks.push(paragraphs.slice(i, i + size).join("\n\n"));
  }
  const chapters: Chapter[] = [];
  let cursor = 0;
  chunks.forEach((chunk, index) => {
    const at = text.indexOf(chunk, cursor);
    const start = at >= 0 ? at : cursor;
    const end = start + chunk.length;
    cursor = end;
    chapters.push({
      index,
      title: `Chapter ${index + 1}`,
      start,
      end,
      length: chunk.length,
      preview: chunk.slice(0, 300),
    });
  });
  return chapters;
}

/** Split a novel into chapters. */
export function segmentChapters(text: string): Chapter[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const headings = findHeadings(trimmed);
  // A book needs at least two headings to be considered structurally divided.
  if (headings.length < 2) return fallbackChapters(trimmed);

  const chapters: Chapter[] = [];
  for (let i = 0; i < headings.length; i += 1) {
    const start = headings[i].at;
    const end = i + 1 < headings.length ? headings[i + 1].at : trimmed.length;
    const body = trimmed.slice(start, end);
    chapters.push({
      index: i,
      title: headings[i].title,
      start,
      end,
      length: body.length,
      preview: body.slice(0, 300),
    });
  }
  // Fold a leading front-matter heading (序章 / 楔子 / 目录 …) into the
  // chapter that follows it. Only front matter is folded — a short *real*
  // chapter stays a chapter, because dropping it would lose story beats.
  if (chapters.length > 1 && FRONT_MATTER_HEADING.test(chapters[0].title.trim())) {
    const [front, first] = chapters;
    chapters.splice(0, 2, {
      index: 0,
      title: first.title,
      start: front.start,
      end: first.end,
      length: first.end - front.start,
      preview: trimmed.slice(front.start, front.start + 300),
    });
  }
  return chapters.map((c, i) => ({ ...c, index: i }));
}

/** Detect the dominant language of a text. */
export function detectLanguage(text: string): "zh" | "en" | "mixed" | "unknown" {
  const sample = text.slice(0, 20000);
  const han = (sample.match(/[一-鿿]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  if (han === 0 && latin === 0) return "unknown";
  if (han === 0) return "en";
  if (latin === 0) return "zh";
  const total = han + latin;
  return han / total > 0.15 ? "mixed" : "en";
}
