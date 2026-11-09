/**
 * Traditional → Simplified Chinese normalisation.
 *
 * WHY THIS EXISTS
 * ---------------
 * The name heuristics in `analyze.ts` are written against simplified
 * characters: the surname list contains 贾 and not 賈, the verb-tail list
 * contains 兴 and not 興. A traditional-Chinese novel therefore produces
 * almost no people — 紅樓夢 mentions 賈寶玉 18 times and 贾宝玉 0 times,
 * and the surname 賈 is not in the list at all, so the single most
 * important character in the book is invisible to the extractor.
 *
 * The fix is to normalise the text ONCE at ingest, before any analysis
 * runs. Everything downstream then only ever sees simplified characters,
 * and the output the agent receives is simplified too — which is what a
 * Seedance prompt wants.
 *
 * `opencc-js/t2cn` is the small (109 KB) traditional→simplified build. The
 * full `opencc-js` entry point is 1.2 MB because it also ships the
 * cn2t direction, which we never use.
 */

import { Converter } from "opencc-js/t2cn";

type ConverterFn = (input: string) => string;

let converter: ConverterFn | null = null;

function getConverter(): ConverterFn | null {
  if (converter) return converter;
  try {
    converter = Converter({ from: "tw", to: "cn" }) as ConverterFn;
  } catch {
    // A missing converter must never break ingestion — the text is still
    // usable, it just will not have been normalised.
    converter = null;
  }
  return converter;
}

/**
 * A cheap pre-check: if the text contains no characters that differ
 * between traditional and simplified, skip the conversion entirely.
 *
 * The check looks for the most common traditional-only forms. It is a
 * heuristic and can produce a false negative (a rare traditional character
 * that is not in the probe list would be missed) — but a false negative
 * only means we skip the conversion for text that was already simplified,
 * and a false positive only costs a few milliseconds.
 */
const TRADITIONAL_MARKERS = /[賈賴陳鄭馮韓楊趙許羅謝蕭嚴歐龔譚廖彭崔陸盧傅鍾萬簡柯紀薛白繆干閻歐]/;

/** True when the text appears to contain traditional Chinese. */
export function hasTraditionalChinese(text: string): boolean {
  return TRADITIONAL_MARKERS.test(text);
}

/**
 * Normalise traditional Chinese to simplified.
 *
 * Returns the input unchanged when the text has no traditional characters
 * or when the converter is unavailable.
 */
export function toSimplified(text: string): string {
  if (!text) return text;
  if (!hasTraditionalChinese(text)) return text;
  const fn = getConverter();
  if (!fn) return text;
  try {
    return fn(text);
  } catch {
    return text;
  }
}
