/**
 * Deterministic analysis engine.
 *
 * Everything here is statistics over the raw text — no language model is
 * called. The output is a set of *candidates* with evidence attached, which
 * an AI agent then reviews, re-files, corrects and expands through the API.
 * The division of labour matters: the model is good at judgement and bad at
 * exhaustive counting; this module is good at counting.
 */

import type {
  Analysis,
  Entity,
  Relationship,
  Scene,
  Taxonomy,
} from "./types";
import { segmentChapters } from "./segment";
import { subcategoryIndex } from "./taxonomy";

/** Common Chinese surnames — the anchor for name detection. */
const SURNAMES = new Set(
  (
    "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻" +
    "柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤" +
    "滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛" +
    "禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童" +
    "颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣" +
    "贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴" +
    "糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖" +
    "武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能" +
    "苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀郏浦尚农温" +
    "别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇" +
    "广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须" +
    "丰巢关蒯相查后荆红游竺权逯盖益桓公"
  ).split(""),
);

/** Words that look like names but are common vocabulary. */
const NAME_STOPWORDS = new Set([
  "什么", "怎么", "这样", "那样", "这个", "那个", "我们", "你们", "他们", "她们",
  "自己", "众人", "大家", "有人", "那人", "这人", "对方", "一旁", "一声", "一句",
  "一个", "一些", "所有", "整个", "这里", "那里", "哪里", "时候", "地方", "东西",
  "声音", "眼神", "嘴角", "心中", "心里", "脑海", "身边", "面前", "身后", "眼前",
  "因为", "所以", "但是", "如果", "虽然", "然后", "于是", "不过", "只是", "已经",
  "现在", "刚才", "刚才", "片刻", "半晌", "许久", "良久", "忽然", "突然", "依然",
  "仍然", "依旧", "似乎", "仿佛", "好像", "宛如", "犹如", "一般", "一起", "一直",
  "说道", "笑道", "问道", "答道", "喝道", "骂道", "叹道", "低声道", "冷声道",
  "转向", "看向", "望向", "走向", "走去", "跑来", "站起", "坐下", "抬手", "伸手",
  "一旁", "一声", "两头", "三人", "两人", "众人", "两人", "个数", "此时", "片刻",
  "父亲", "母亲", "哥哥", "姐姐", "弟弟", "妹妹", "爷爷", "奶奶", "叔叔", "阿姨",
  "师父", "师傅", "弟子", "公子", "姑娘", "大人", "陛下", "殿下", "长老", "前辈",
]);

/** Speech-attribution verbs that follow a speaker name. */
const SPEECH_VERBS = [
  "说道", "问道", "答道", "笑道", "喝道", "骂道", "叹道", "低声道", "冷声道",
  "沉声道", "轻声", "大声", "怒道", "解释道", "补充道", "反驳道", "喃喃",
  "开口", "出声", "回答", "反问", "追问", "喊道", "怒斥", "冷笑", "沉吟",
];

/**
 * Narration verbs — the predicate of a descriptive sentence.
 *
 * Together with a surname-initial prefix these identify a subject even when
 * the sentence contains no dialogue at all, which is the common case in the
 * opening paragraphs of a novel and in every chapter that is pure scene
 * description. Matched longest-prefix-first, so "林远山坐在" yields the
 * subject "林远山" and leaves the verb alone.
 */
const NARRATION_VERBS = [
  "坐在", "站在", "躺在", "靠着", "望着", "看着", "盯着", "听着",
  "抬起头", "低下头", "转过身", "皱起眉", "摇摇头", "点点头", "站起身",
  "走上前", "走过来", "走过去", "坐下", "站起", "推开门", "走出门",
  "走向", "走到", "来到", "回到", "走进", "走出", "爬上", "下山",
  "背上", "背起", "扛着", "抱着", "握住", "拿起", "放下", "抽出",
  "端起", "松开", "摊开", "合上", "踏进", "迈出", "捂住",
  "终于", "已经", "仍然", "依然", "始终",
];

/** Location markers used to spot scene-bearing sentences. */
const PLACE_SUFFIX = [
  "房", "屋", "院", "门", "楼", "阁", "亭", "殿", "宫", "城", "镇", "村", "街",
  "路", "桥", "山", "河", "江", "湖", "海", "林", "园", "寺", "庙", "塔", "客栈",
  "酒馆", "茶楼", "书院", "学宫", "校场", "军营", "广场", "走廊", "大厅", "厨房",
  "药铺", "商铺", "码头", "渡口", "驿站", "坟场", "密室", "洞府", "丹田",
];

/** Action words that signal an event beat. */
const EVENT_WORDS = [
  "战斗", "厮杀", "大战", "决战", "偷袭", "刺杀", "逃亡", "逃亡", "出发", "归来",
  "重逢", "相遇", "离别", "背叛", "复仇", "成亲", "大婚", "登基", "加冕", "叛乱",
  "突破", "顿悟", "陨落", "身亡", "牺牲", "得救", "被抓", "逃脱", "相遇", "设宴",
];

/** Stop words for keyword extraction. */
const KEYWORD_STOP = new Set([
  "自己", "我们", "你们", "他们", "这个", "那个", "什么", "怎么", "一个", "没有",
  "可以", "因为", "所以", "但是", "如果", "虽然", "已经", "还有", "就是", "不是",
  "知道", "现在", "时候", "地方", "东西", "这样", "那样", "一起", "声音", "眼睛",
  "手", "head", "the", "and", "with", "that", "this", "from", "have", "was",
]);

function isHan(ch: string): boolean {
  return /[一-鿿]/.test(ch);
}

/** Split the text into sentence-ish units. */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;""'])\s*/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Extract quoted speech segments — used for dialogue-pair reasoning. */
function extractQuotes(
  sentence: string,
): { quote: string; start: number; end: number }[] {
  const out: { quote: string; start: number; end: number }[] = [];
  const re = /[“"「『]([^”"」』]{1,400})[”"」』]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) !== null) {
    out.push({
      quote: m[1],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

/** Adverbs / particles that sit between a name and its speech verb. */
const NAME_TAIL_NOISE = new Set([
  "缓缓", "慢慢", "淡淡", "冷冷", "轻轻", "微微", "忽然", "突然", "连忙", "急忙",
  "终于", "仍然", "依然", "还", "又", "就", "才", "便", "却", "也", "不", "没",
  "很", "太", "最", "更", "都", "再", "便又", "随即", "立刻", "接着", "然后",
  "于是", "因此", "所以", "只是", "已经", "轻轻", "低低", "缓缓地", "的", "地",
  "一声", "一句", "一遍", "一下", "抬起头", "站在", "走着", "看", "问", "说",
]);

/**
 * Compound surnames — the only names allowed to be four characters long.
 * A four-character candidate that is not one of these is a noun phrase
 * ("那份名单"), never a person.
 */
const COMPOUND_SURNAMES = new Set([
  "欧阳", "司马", "上官", "诸葛", "夏侯", "东方", "独孤", "南宫", "皇甫",
  "尉迟", "公孙", "慕容", "长孙", "宇文", "令狐", "闻人", "澹台", "轩辕",
  "太史", "仲孙", "钟离", "闾丘", "端木", "西门", "南门", "北堂",
]);

/** Words that trail a name inside a narration frame ("林远山缓缓道"). */
const TRAILING_ADVERBS = new Set([
  "缓", "轻", "冷", "淡", "沉", "突", "忽", "随", "便", "都", "也", "还",
  "又", "再", "才", "却", "静", "默", "摇", "抬", "转", "皱", "笑", "点",
  "摇", "摊", "伸", "垂", "静", "缓", "低", "高", "连", "忙", "急",
]);

/** Characters that never appear inside a person name. */
const NAME_FORBIDDEN_CHARS = new Set([
  "的", "了", "是", "在", "和", "与", "也", "就", "都", "很", "更", "不", "没",
  "我", "你", "他", "她", "它", "这", "那", "些", "个", "之", "而", "但",
]);

/**
 * Characters that a Chinese given name essentially never ends with.
 *
 * This is what separates a name from a name-plus-verb: "林远山坐在" contains
 * the subject "林远山" followed by the verb "坐在", but the naive longest-
 * prefix rule would happily produce "林远山坐". A given name ends in a
 * noun-like character, so rejecting verb tails keeps the boundary honest.
 */
const NAME_VERB_TAIL = new Set(
  (
    "站坐走跑看说听拿放握背打吃喝想问答笑哭叫喊见闻来去回到进出上下起过" +
    "开关住靠躺跨迈追逃躲藏抓推拉举挥摇转抬伸捧接抛踏踩扑闪撞碰敲拍按摸" +
    "捏提拖抱扛挑摘收摆挂贴装倒扫擦洗剪切割缝补织编折弯缓慢轻重深浅快忽" +
    "突顿渐立刻瞬时地得着了过在是和与但却就才也又再更最只曾将会要能可应" +
    "该须能愿想让使令给被让把从向往对与如同按据由至还总常常往往偶时终然"
  ).split(""),
);

/** Common nouns that read like names but describe a place. */
const COMMON_PLACE_NOUNS = new Set([
  "书房", "客厅", "卧室", "厨房", "院子", "走廊", "大厅", "广场", "校场",
  "军营", "店铺", "书房", "清风楼", "青峰山", "客栈", "酒馆", "茶楼",
  "山门", "后崖", "大厅", "密道", "名单", "信封", "箱子", "房间",
]);

/** Strip trailing adverbs from a candidate name. */
function trimNameTail(candidate: string): string {
  let name = candidate;
  let changed = true;
  while (changed) {
    changed = false;
    for (const noise of NAME_TAIL_NOISE) {
      if (name.length > noise.length && name.endsWith(noise)) {
        name = name.slice(0, -noise.length);
        changed = true;
        break;
      }
    }
    // A single trailing adverb character.
    if (name.length > 2 && TRAILING_ADVERBS.has(name[name.length - 1])) {
      name = name.slice(0, -1);
      changed = true;
    }
  }
  return name;
}

/**
 * Strip trailing adverbs from a candidate name.
 * "林远山缓缓" → "林远山", "沈墨的" → "沈墨".
 */
function trimTrailingAdverbs(candidate: string): string {
  let name = candidate;
  while (name.length > 2 && TRAILING_ADVERBS.has(name[name.length - 1])) {
    name = name.slice(0, -1);
  }
  return name;
}

/**
 * Identify candidate Chinese person names.
 *
 * Two-phase, and the phases do different jobs:
 *   1. IDENTIFY — find *where* a name is mentioned, using dialogue
 *      attribution ("X说道"), quote adjacency ("…"林远山缓缓道) and
 *      in-quote address ("沈墨，…"). This is the hard part and it needs
 *      grammar, not frequency.
 *   2. COUNT — once a name is known, count every occurrence in the text.
 *      Doing it the other way round (counting n-grams first) produces
 *      "书房里" and "山缓缓" as people.
 *
 * Splitting the phases matters because a name can be mentioned 20 times
 * without ever being followed by a speech verb.
 */
export function identifyCharacterNames(text: string): Set<string> {
  const found = new Set<string>();

  const accept = (raw: string) => {
    let name = trimNameTail(trimTrailingAdverbs(raw));
    if (name.length < 2 || name.length > 4) return;
    if (NAME_STOPWORDS.has(name)) return;
    if (!/^[一-鿿]+$/.test(name)) return;
    if (COMMON_PLACE_NOUNS.has(name)) return;
    if ([...name].some((c) => NAME_FORBIDDEN_CHARS.has(c))) return;
    if (name.length === 4 && !COMPOUND_SURNAMES.has(name.slice(0, 2))) return;
    if (!SURNAMES.has(name[0]) && !COMPOUND_SURNAMES.has(name.slice(0, 2))) {
      return;
    }
    // A personal name may legitimately end in a character that is also a
    // place suffix — "林远山" ends in 山 and is a person. Place-like words are
    // rejected by COMMON_PLACE_NOUNS instead, not by the suffix list.
    found.add(name);
  };

  /**
   * From a run of Han characters ending at a speech verb, take the LONGEST
   * plausible name that starts at a surname. Taking the longest is what
   * separates "林远山" from "林远" — both are substrings of the run, but only
   * one of them is the name.
   *
   * `rejectVerbTail` additionally refuses a candidate whose last character is
   * a verb. Without it, the run "林远山坐" (subject + verb) yields the
   * four-character non-name "林远山坐"; with it, the run yields "林远山" and
   * the verb is left where it belongs.
   */
  const acceptFromRun = (
    raw: string,
    options: { rejectVerbTail?: boolean } = {},
  ) => {
    const trimmed = trimNameTail(raw);
    for (let start = 0; start < trimmed.length - 1; start += 1) {
      if (!SURNAMES.has(trimmed[start])) continue;
      for (let len = Math.min(4, trimmed.length - start); len >= 2; len -= 1) {
        const candidate = trimmed.slice(start, start + len);
        if (len === 4 && !COMPOUND_SURNAMES.has(candidate.slice(0, 2))) continue;
        if ([...candidate].some((c) => NAME_FORBIDDEN_CHARS.has(c))) continue;
        if (options.rejectVerbTail && NAME_VERB_TAIL.has(candidate[candidate.length - 1])) {
          continue;
        }
        // Only the longest valid candidate counts — accepting every length
        // would register "林远" alongside "林远山".
        accept(candidate);
        return;
      }
      return;
    }
  };

  // 1a) Dialogue attribution: 1-6 Han characters before a speech verb.
  for (const verb of SPEECH_VERBS) {
    const re = new RegExp(`([\\u4e00-\\u9fff]{1,6})${verb}`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      acceptFromRun(m[1]);
    }
  }

  // 1b) Possessive narration: "沈墨的声音很轻"
  const voiceRe = /([一-鿿]{2,4})的声音/g;
  let vm: RegExpExecArray | null;
  while ((vm = voiceRe.exec(text)) !== null) {
    acceptFromRun(vm[1]);
  }

  // 1c) Quote adjacency: "…"X说道 / "…"X缓缓道
  const quoteRe = /[”"」』]\s*，?\s*([一-鿿]{1,6})(说道|问道|答道|笑道|喝道|骂道|叹道|冷笑道|低声道|开口道|回答|反问|追问|喊道|怒斥|道|说|问|答)/g;
  let qm: RegExpExecArray | null;
  while ((qm = quoteRe.exec(text)) !== null) {
    acceptFromRun(qm[1]);
  }

  // 1d) Address inside a quote: "沈墨，…"
  const addrRe = /[“"「『]([一-鿿]{2,3})[，,]/g;
  let am: RegExpExecArray | null;
  while ((am = addrRe.exec(text)) !== null) {
    accept(am[1]);
  }

  // 1e) Narration frame: the subject of a descriptive sentence.
  //
  // Chinese puts the subject at the front of a clause, so "林远山坐在书房里"
  // identifies its subject without any speech verb at all. This is the frame
  // that keeps short chapters — which often contain no dialogue — from
  // yielding zero people.
  //
  // The candidate is the longest surname-initial prefix of the run that does
  // not END in a verb character, which is what keeps "林远山坐" (subject +
  // verb) from being read as a four-syllable name.
  for (const verb of NARRATION_VERBS) {
    const re = new RegExp(`([\\u4e00-\\u9fff]{1,6})${verb}`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      acceptFromRun(m[1], { rejectVerbTail: true });
    }
  }

  // Resolve overlaps: if one candidate is a proper prefix of another, the
  // longer one wins — "林远" is a prefix of "林远山", and only one of them
  // is a person.
  const all = [...found];
  return new Set(
    all.filter(
      (name) =>
        !all.some(
          (other) => other !== name && other.startsWith(name) && other.length > name.length,
        ),
    ),
  );
}

/**
 * Identify English/Latin person names.
 *
 * Latin fiction capitalises names and rarely capitalises anything else in
 * narrative prose, so a capitalised word that recurs and is not a common
 * word is a strong candidate.
 */
export function identifyLatinNames(text: string): Set<string> {
  const common = new Set([
    "The", "A", "An", "He", "She", "It", "They", "We", "I", "But", "And", "Then",
    "When", "Chapter", "Book", "Part", "Volume", "One", "Two", "Three", "This",
    "That", "There", "Here", "Now", "So", "If", "As", "At", "In", "On", "Of",
    "His", "Her", "My", "Your", "Our", "Their", "Was", "Were", "Had", "Has",
    "Not", "No", "Yes", "For", "With", "From", "Into", "Out", "Up", "Down",
    "Over", "Under", "After", "Before", "But", "Who", "What", "Why", "How",
  ]);
  const candidates = new Map<string, number>();
  const re = /\b([A-Z][a-z]{1,15})\b(?:\s+([A-Z][a-z]{1,15}))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const first = m[1];
    if (common.has(first)) continue;
    const full = m[2] ? `${first} ${m[2]}` : first;
    if (full.length < 3 || full.length > 30) continue;
    candidates.set(full, (candidates.get(full) ?? 0) + 1);
  }
  const found = new Set<string>();
  for (const [name, count] of candidates) {
    if (count >= 2) found.add(name);
  }
  return found;
}

/** Count how often each surface form occurs in the text. */
export function countOccurrences(
  text: string,
  names: Iterable<string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) {
    let at = text.indexOf(name);
    let n = 0;
    while (at !== -1) {
      n += 1;
      at = text.indexOf(name, at + name.length);
    }
    if (n > 0) counts.set(name, n);
  }
  return counts;
}

/** Build a per-chapter name index so we can measure spread and co-occurrence. */
function buildChapterIndex(
  chapters: { index: number; text: string }[],
  names: string[],
): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();
  for (const chapter of chapters) {
    for (const name of names) {
      if (!chapter.text.includes(name)) continue;
      if (!index.has(name)) index.set(name, new Set());
      index.get(name)!.add(chapter.index);
    }
  }
  return index;
}

/** Extract up to `limit` evidence quotes for a name. */
function collectEvidence(text: string, name: string, limit = 4): string[] {
  const out: string[] = [];
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    if (!sentence.includes(name)) continue;
    out.push(sentence.length > 160 ? `${sentence.slice(0, 160)}…` : sentence);
    if (out.length >= limit) break;
  }
  return out;
}

/** Build a one-line deterministic summary from the sentences around a name. */
function summarise(name: string, evidence: string[]): string {
  if (evidence.length === 0) return "";
  const first = evidence[0];
  return first.length > 120 ? `${first.slice(0, 120)}…` : first;
}

/**
 * Compute relationships between characters.
 *
 * Two signals:
 *  - co-occurrence inside a character window (two people mentioned within
 *    ~350 characters of each other are in the same scene);
 *  - dialogue pair: a quoted line whose speaker is one character and whose
 *    text addresses another.
 */
export function extractRelationships(
  text: string,
  characters: { id: string; name: string }[],
): Relationship[] {
  const byName = new Map(characters.map((c) => [c.name, c]));
  const nameSet = new Set(byName.keys());
  const pairs = new Map<
    string,
    { weight: number; kinds: Set<string>; evidence: string[] }
  >();

  const bump = (a: string, b: string, kind: string, evidence: string) => {
    if (a === b) return;
    // Canonicalise the direction: a pair is one edge, not two. Sorting by
    // name keeps the edge stable no matter which side the text mentioned
    // first.
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `${x}|${y}`;
    const entry =
      pairs.get(key) ?? { weight: 0, kinds: new Set<string>(), evidence: [] };
    entry.weight += kind === "dialogue" ? 3 : 1;
    entry.kinds.add(kind);
    if (entry.evidence.length < 3) {
      entry.evidence.push(
        evidence.length > 140 ? `${evidence.slice(0, 140)}…` : evidence,
      );
    }
    pairs.set(key, entry);
  };

  // ── co-occurrence inside a character window
  const WINDOW = 350;
  const positions: { name: string; at: number }[] = [];
  for (const name of nameSet) {
    let at = text.indexOf(name);
    while (at !== -1) {
      positions.push({ name, at });
      at = text.indexOf(name, at + name.length);
    }
  }
  positions.sort((a, b) => a.at - b.at);
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      if (positions[j].at - positions[i].at > WINDOW) break;
      const a = positions[i].name;
      const b = positions[j].name;
      const snippet = text.slice(
        Math.max(0, positions[i].at - 60),
        positions[j].at + 60,
      );
      bump(a, b, "co-occurrence", snippet);
    }
  }

  // ── dialogue pairs
  for (const sentence of splitSentences(text)) {
    const quotes = extractQuotes(sentence);
    if (quotes.length === 0) continue;
    for (let q = 0; q < quotes.length; q += 1) {
      const { quote, start, end } = quotes[q];
      const outside = sentence.slice(0, start) + sentence.slice(end);
      const speaker = [...nameSet]
        .filter((n) => outside.includes(n))
        .sort(
          (a, b) =>
            outside.lastIndexOf(b) - outside.lastIndexOf(a),
        )[0];
      if (!speaker) continue;
      const addressed = [...nameSet].filter(
        (n) => quote.includes(n) && n !== speaker,
      );
      for (const target of addressed) {
        bump(speaker, target, "dialogue", sentence);
      }
    }
  }

  const out: Relationship[] = [];
  let id = 0;
  for (const [key, value] of pairs) {
    const [a, b] = key.split("|");
    const source = byName.get(a);
    const target = byName.get(b);
    if (!source || !target) continue;
    out.push({
      id: `rel-${id++}`,
      sourceId: source.id,
      targetId: target.id,
      weight: value.weight,
      kinds: [...value.kinds],
      evidence: value.evidence,
    });
  }
  return out.sort((x, y) => y.weight - x.weight);
}
/**
 * Extract location / scene candidates.
 *
 * Two independent patterns, because Chinese fiction names places in two ways:
 *   - with a locative: 在书房里 / 走进清风楼 / 回到青峰山
 *   - bare, immediately after a movement verb: 走出书房 / 上青峰山
 */
export function extractSceneCandidates(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const suffixAlternation = PLACE_SUFFIX.join("|");

  // 在X里 / 在X中 / 在X上 …
  const locRe = new RegExp(
    `(?:在|来到|走进|回到|前往|离开|站在|坐在|躺在|走出|走进|登上|赶到|潜入|逃出)\\s*([一-鿿]{1,4}(?:${suffixAlternation}))(?=[里中上内外前后，,。、！？\\s]|$)`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = locRe.exec(text)) !== null) {
    const name = m[1];
    if (name.length < 2) continue;
    if (NAME_STOPWORDS.has(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  // Bare place names after a movement / position verb: 走出书房, 上青峰山.
  const bareRe = new RegExp(
    `(?:走出|走进|回到|来到|登上|上了|站在|坐在|住在|身在|身处|到了|进了|出了)\\s*([一-鿿]{1,4}(?:${suffixAlternation}))(?=[里中上内外前后，,。、！？\\s]|$)`,
    "g",
  );
  while ((m = bareRe.exec(text)) !== null) {
    const name = m[1];
    if (name.length < 2) continue;
    if (NAME_STOPWORDS.has(name)) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  // Nouns that are unambiguously places, wherever they appear.
  const strongPlace = new Set([
    "书房", "清风楼", "青峰山", "客栈", "酒馆", "茶楼", "山门", "客栈", "后崖",
    "书房", "庭院", "院子", "大殿", "广场", "校场", "军营", "走廊", "大厅",
  ]);
  for (const place of strongPlace) {
    let at = text.indexOf(place);
    while (at !== -1) {
      counts.set(place, (counts.get(place) ?? 0) + 1);
      at = text.indexOf(place, at + place.length);
    }
  }

  // Latin places: "in the Garden" / "the Castle"
  const latinPlace = /\b(?:in|at|into|from)\s+the\s+([A-Z][a-zA-Z]{2,20})/g;
  let lm: RegExpExecArray | null;
  while ((lm = latinPlace.exec(text)) !== null) {
    const name = lm[1];
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return counts;
}

/** Extract event keywords. */
export function extractEventCandidates(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of EVENT_WORDS) {
    let at = text.indexOf(word);
    while (at !== -1) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
      at = text.indexOf(word, at + word.length);
    }
  }
  return counts;
}

/** Rank characters by weighted score = mentions × spread factor. */
function rankCharacters(
  counts: Map<string, number>,
  chapterIndex: Map<string, Set<number>>,
): { name: string; mentions: number; spread: number; score: number }[] {
  const total = Math.max(1, chapterIndex.size);
  const rows: { name: string; mentions: number; spread: number; score: number }[] = [];
  for (const [name, mentions] of counts) {
    if (mentions < 2) continue;
    const chapters = chapterIndex.get(name) ?? new Set<number>();
    const spread = chapters.size / total;
    // A name that shows up in many chapters is a real character; a name that
    // repeats 40 times inside one chapter is usually a local object.
    const score = mentions * (0.35 + spread);
    rows.push({ name, mentions, spread, score });
  }
  return rows.sort((a, b) => b.score - a.score);
}


/** Function words and particles that make an n-gram a word fragment. */
const GRAM_FORBIDDEN = [
  "的", "了", "着", "过", "是", "在", "和", "与", "也", "就", "都", "而",
  "又", "还", "把", "被", "给", "让", "从", "向", "对", "为", "之", "其",
  "此", "那", "这", "一", "不", "没", "很", "更", "最", "只", "但", "却",
];

/**
 * Extract recurring keywords.
 *
 * Chinese has no whitespace, so without a segmenter the candidates are
 * n-grams of 2–4 Han characters. Three filters keep the list useful:
 *   - a gram that contains a character name is a name fragment, not a theme;
 *   - a gram that appears fewer times than the text's density warrants is
 *     noise (the threshold scales with the text length, so a short story is
 *     not left with an empty list);
 *   - a gram that is contained in a longer, more frequent gram is redundant.
 */
export function extractKeywords(
  text: string,
  limit = 40,
  exclude: string[] = [],
): { term: string; count: number }[] {
  const counts = new Map<string, number>();

  // Chinese has no whitespace, so the candidates are n-grams of 2–4 Han
  // characters. They must be generated per length: a greedy /{2,4}/ match
  // consumes four characters at a time and never produces a single 2-gram.
  for (const run of text.match(/[一-鿿]+/g) ?? []) {
    for (let n = 2; n <= 4; n += 1) {
      for (let i = 0; i + n <= run.length; i += 1) {
        const gram = run.slice(i, i + n);
        if (KEYWORD_STOP.has(gram)) continue;
        if (NAME_STOPWORDS.has(gram)) continue;
        // A gram that carries a particle is a fragment of two words
        // ("山" + "的"), not a word itself.
        if (GRAM_FORBIDDEN.some((c) => gram.includes(c))) continue;
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
      }
    }
  }
  for (const word of text.match(/\b[a-z]{4,12}\b/gi) ?? []) {
    const lower = word.toLowerCase();
    if (KEYWORD_STOP.has(lower)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  // Density-aware threshold: a 600-character chapter legitimately contains
  // terms that occur only twice, while a 300k-character epic needs more.
  const minCount = Math.max(2, Math.floor(text.length / 2500));

  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length,
  );
  const kept: { term: string; count: number }[] = [];
  for (const [term, count] of sorted) {
    if (count < minCount) continue;
    // Skip fragments of a character name.
    if (exclude.some((name) => name.includes(term) || term.includes(name))) {
      continue;
    }
    // Skip a term already covered by a longer, more frequent kept term.
    if (kept.some((k) => k.term.includes(term) && k.count >= count)) continue;
    kept.push({ term, count });
    if (kept.length >= limit) break;
  }
  return kept;
}

/** Run the full deterministic analysis over a novel. */
export function analyze(
  novelId: string,
  text: string,
  taxonomy: Taxonomy,
): Analysis {
  const chapters = segmentChapters(text);
  const chapterTexts = chapters.map((c) => text.slice(c.start, c.end));

  // Phase 1 — identify the names.
  const cnNames = identifyCharacterNames(text);
  const latinNames = identifyLatinNames(text);

  // Phase 2 — count every occurrence of the names we identified.
  const cnCounts = countOccurrences(text, cnNames);
  const latinCounts = countOccurrences(text, latinNames);

  const allCounts = new Map<string, number>([...cnCounts, ...latinCounts]);
  const allNames = [...allCounts.keys()];
  const chapterIndex = buildChapterIndex(
    chapters.map((c, i) => ({ index: i, text: chapterTexts[i] })),
    allNames,
  );

  const ranked = rankCharacters(allCounts, chapterIndex).slice(0, 40);

  const subIndex = subcategoryIndex(taxonomy);
  const entities: Entity[] = [];
  const totalChars = Math.max(1, text.length);

  for (const row of ranked) {
    const evidence = collectEvidence(text, row.name);
    const summary = summarise(row.name, evidence);
    // Assign a subcategory deterministically: protagonist is simply the
    // highest-scoring name; the rest are "supporting" until an agent files
    // them properly.
    const subcategory =
      entities.length === 0
        ? "protagonist"
        : row.spread > 0.4
          ? "ally"
          : "supporting";
    entities.push({
      id: `ent-${entities.length}`,
      name: row.name,
      category: "character",
      subcategory: subIndex.has(subcategory) ? subcategory : "supporting",
      mentions: row.mentions,
      chapterSpread: Number(row.spread.toFixed(3)),
      evidence,
      summary,
      attributes: {},
    });
  }

  // Scenes.
  const sceneCounts = extractSceneCandidates(text);
  const scenes: Scene[] = [];
  for (const [name, count] of [...sceneCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)) {
      if (count < 2) continue;
      const chaptersHere: number[] = [];
      chapters.forEach((chapter, i) => {
        if (chapterTexts[i].includes(name)) chaptersHere.push(i);
      });
      const evidence = collectEvidence(text, name, 3);
      scenes.push({
        id: `scn-${scenes.length}`,
        title: name,
        subcategory: classifyScene(name),
        chapters: chaptersHere,
        mentions: count,
        summary: summarise(name, evidence),
        attributes: {},
      });
    }

  // Events become entities in the "event" category so agents can build beats.
  const eventCounts = extractEventCandidates(text);
  for (const [name, count] of [...eventCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)) {
    if (count < 2) continue;
    const evidence = collectEvidence(text, name, 3);
    entities.push({
      id: `ent-${entities.length}`,
      name,
      category: "event",
      subcategory: "discovery",
      mentions: count,
      chapterSpread: 0,
      evidence,
      summary: summarise(name, evidence),
      attributes: {},
    });
  }

  const characters = entities.filter((e) => e.category === "character");
  const relationships = extractRelationships(text, characters);

  const keywords = extractKeywords(text, 40, [
    ...characters.map((c) => c.name),
    ...entities.map((e) => e.name),
  ]).map((k) => ({
    term: k.term,
    count: k.count,
    category: "theme" as const,
  }));

  return {
    novelId,
    generatedAt: new Date().toISOString(),
    stats: {
      characters: characters.length,
      scenes: scenes.length,
      relationships: relationships.length,
      chapters: chapters.length,
      totalChars,
    },
    entities,
    scenes,
    relationships,
    keywords,
  };
}

/** Map a place name to a scene subcategory using its suffix. */
export function classifyScene(name: string): string {
  if (/山|林|野|漠|原|野地|谷/.test(name)) return "wilderness";
  if (/海|江|河|湖|泉|溪|池|塘/.test(name)) return "water";
  if (/城|镇|村|乡|市|坊|街|巷/.test(name)) return "settlement";
  if (/寺|庙|宫|殿|阁|塔|观|祠|堂/.test(name)) return "temple";
  if (/校|学|塾|院|书院/.test(name)) return "school";
  if (/楼|馆|店|铺|馆|坊|市|场|厅|堂|阁/.test(name)) return "interior-public";
  if (/房|屋|室|寝|厢|阁/.test(name)) return "interior-room";
  if (/街|路|巷|桥|道|途/.test(name)) return "street";
  if (/营|阵|场|塞|关|隘/.test(name)) return "battlefield";
  return "settlement";
}
