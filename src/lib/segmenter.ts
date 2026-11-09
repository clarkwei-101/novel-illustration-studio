/**
 * Chinese word segmentation, backed by jieba (node-rs / Rust).
 *
 * Why this exists: the keyword extractor used to work on raw character
 * n-grams, which is the only option when you have no segmenter. The
 * result was garbage that no amount of stopword tuning could fix —
 * the twenty most frequent n-grams of any Chinese novel are grammar
 * (起来, 出来, 里头, 瞧瞧, 点头), because Chinese has no whitespace and
 * a character slicer cannot tell a word from a piece of a word.
 *
 * With a real segmenter the same statistics become useful: in 红楼梦
 * the top nouns are 银子 347, 怡红院 78, 大观园 49, 眼泪 58,
 * 省亲 24, 诗社 18, 灯谜 6 — which is precisely the list an illustrator
 * needs, and which no stopword list could have produced.
 *
 * The dependency is a native Rust module, so it must stay on the server:
 * it is listed in `serverExternalPackages` in `next.config.mjs` and is
 * only ever imported from API routes and the MCP server, never from a
 * client component.
 */

import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";

/**
 * A lazily created, process-wide segmenter.
 *
 * Building it loads the ~5 MB dictionary, and every extra instance is a
 * fresh copy of it. One shared instance keeps that cost to once per
 * process.
 */
let segmenter: Jieba | null = null;

function getSegmenter(): Jieba {
  if (!segmenter) segmenter = Jieba.withDict(dict);
  return segmenter;
}

/** A word with its part-of-speech tag. */
export interface TaggedWord {
  word: string;
  tag: string;
}

/**
 * Segment and tag a whole text.
 *
 * jieba handles a multi-hundred-thousand-character string in a few
 * hundred milliseconds, so the whole novel is segmented in one call —
 * no chunking, no state to reset.
 */
export function tagText(text: string): TaggedWord[] {
  if (!text) return [];
  const raw = getSegmenter().tag(text);
  const out: TaggedWord[] = new Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = { word: raw[i].word, tag: raw[i].tag };
  }
  return out;
}

/**
 * Segment a text into words only.
 */
export function segmentText(text: string): string[] {
  if (!text) return [];
  return getSegmenter().cut(text);
}

/**
 * Part-of-speech tags that can plausibly be a *theme*.
 *
 * `n` covers 普通名词 (银子, 眼泪, 主意); `ns` 专名地点 (潇湘馆);
 * `nz` 其他专名 (香菱, 晴雯 when the dictionary treats them as names);
 * `nt` 机构 (怡红院); `nl` 机构名; `ng` 名词性语素 (the head of a
 * compound the dictionary does not know as a whole, such as 园 in
 * 潇湘馆); `vn` 名动词 (the noun-ish half of 调查); `an` 形容词性
 * 名词 (shapes and colours an illustrator needs); `s` 处所词 and
 * `f` 方位词 for the scene layer.
 *
 * Verbs are deliberately excluded: 瞧瞧, 点头, 知道 are grammar, not
 * theme.
 */
export const THEME_TAGS = new Set([
  "n", "ns", "nz", "nl", "ng", "nt", "an", "vn", "s", "f",
]);

/**
 * Tags that mark a person, used to keep character names out of the
 * keyword list even when the caller does not pass an exclusion list.
 */
export const PERSON_TAGS = new Set(["nr", "nrt", "nrfg", "nrf"]);

/**
 * Merge tokens that together spell a known proper noun.
 *
 * The dictionary jieba ships knows a few hundred thousand common words,
 * but it knows almost nothing about a specific novel. It cuts 清风楼 into
 * 清风 + 楼 and 林远山 into 林 + 远山, which means the keyword layer sees
 * "清风" (and files it as nature, because 风 is a weather morpheme) and
 * misses the place entirely.
 *
 * The name engine, on the other hand, already found 清风楼 as a scene and
 * 林远山 as a character. So the two results are recombined here: the
 * token stream is walked, and any run of adjacent tokens whose
 * concatenation is a known proper noun is merged back into one token.
 *
 * The merge is greedy over the longest match, because a novel's names
 * frequently nest (大观园 contains 园; 怡红院 contains 院).
 */
export function mergeKnownNames(
  tokens: TaggedWord[],
  known: Iterable<string>,
): TaggedWord[] {
  const names = [...known]
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (names.length === 0) return tokens;

  // A lookup keyed by the FIRST CHARACTER, so the scan only considers
  // names that could actually start at the current position.
  //
  // The key is the character, not the token: the token at this position
  // may be "清风" (two characters) while the name is "清风楼" (three),
  // so the token's own text is not a usable key.
  const byFirst = new Map<string, string[]>();
  for (const name of names) {
    const first = name[0];
    const list = byFirst.get(first);
    if (list) list.push(name);
    else byFirst.set(first, [name]);
  }

  const out: TaggedWord[] = [];
  let i = 0;
  while (i < tokens.length) {
    const candidates = byFirst.get(tokens[i].word[0]);
    let matched: string | null = null;
    if (candidates) {
      const rest = tokens
        .slice(i, i + 6)
        .map((t) => t.word)
        .join("");
      for (const name of candidates) {
        if (rest.startsWith(name)) {
          matched = name;
          break;
        }
      }
    }
    if (matched) {
      // The merged token takes the tag of its FIRST character, which is
      // where the noun-ness of a Chinese proper noun lives.
      out.push({ word: matched, tag: tokens[i].tag });
      // Advance past the tokens that were consumed. The count is derived
      // from the character length of the name, since the tokens may have
      // been split in arbitrary places.
      let consumed = 0;
      let chars = 0;
      while (i + consumed < tokens.length && chars < matched.length) {
        chars += tokens[i + consumed].word.length;
        consumed += 1;
      }
      i += consumed;
      continue;
    }
    out.push(tokens[i]);
    i += 1;
  }
  return out;
}
