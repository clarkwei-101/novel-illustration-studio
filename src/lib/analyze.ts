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
  KeywordCategory,
  Relationship,
  Scene,
  Taxonomy,
} from "./types";
import { segmentChapters } from "./segment";
import { subcategoryIndex } from "./taxonomy";
import { CHINESE_STOPWORDS } from "./stopwords";
import { THEME_TAGS, mergeKnownNames, tagText } from "./segmenter";
import {
  countOccurrences,
  identifyCharacterNames,
  identifyLatinNames,
  mergeCharacterAliases,
  NAME_STOPWORDS,
  TITLE_NOUNS,
  COMMON_WORDS,
  COMMON_NAME_LIKE_WORDS,
} from "./names";

// The name-extraction engine lives in its own module, but the rest of the
// app has always imported it from here. Re-export so both paths work.
export {
  countOccurrences,
  identifyCharacterNames,
  identifyLatinNames,
  mergeCharacterAliases,
} from "./names";
export type { CharacterCandidate } from "./names";

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

/**
 * Stop words for keyword extraction.
 *
 * Chinese has no whitespace, so the candidate set is every 2–4 character
 * n-gram. Without a real stop list, the most frequent grams are grammar,
 * not theme: 起来 (1021), 出来 (1006), 如今 (973), 两个 (762), 听见 (659),
 * 咱们 (585). A keyword list made of those tells an illustrator nothing.
 *
 * The list therefore covers three families:
 *   - pronouns and demonstratives (自己, 我们, 这个);
 *   - conjunctions and adverbs (因为, 所以, 虽然, 已经, 起来, 出来);
 *   - the generic quantifiers and measure words (两个, 三个, 一切).
 */
const KEYWORD_STOP = new Set([
  "自己", "我们", "你们", "他们", "她们", "咱们", "这个", "那个", "什么",
  "怎么", "没有", "可以", "因为", "所以", "但是", "如果", "虽然", "已经",
  "还有", "就是", "不是", "知道", "现在", "时候", "地方", "东西", "这样",
  "那样", "一起", "声音", "眼睛", "起来", "出来", "进来", "过来", "回去",
  "上来", "下来", "如今", "从来", "向来", "两个", "三个", "一个", "一些",
  "许多", "多少", "几个", "听见", "看见", "有人", "众人", "大家", "人家",
  "一直", "只管", "连忙", "急忙", "不住", "起来", "这里", "那里", "哪里",
  "什么", "两个", "一面", "一时", "越发", "更加", "越发", "从来",
  "原来", "本来", "方才", "刚刚", "立刻", "随即", "接着", "然后", "于是",
  "head", "the", "and", "with", "that", "this", "from", "have", "was",
  // Verb phrases are not themes either: 回来, 出去, 叫他, 见他, 告诉.
  "回来", "出去", "进来", "过来", "叫他", "见她", "见他", "告诉", "个人",
  "回来", "出去", "起来", "出来", "进去", "过去", "下去", "上来", "下来",
  "一回", "一时", "一直", "一面", "一半", "一起", "一遭", "一连", "一头",
  "起来", "出来", "过来", "起来", "罢了", "好些", "多少", "许多",
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
 *
 * The result is capped. In a 900k-character novel with 40 characters,
 * EVERY pair co-occurs somewhere, so an uncapped graph has 780 edges and
 * no signal at all — a relationship list that says "these two people were
 * both in the book" is worthless to an illustrator. Only the strongest
 * edges survive.
 */
export function extractRelationships(
  text: string,
  characters: { id: string; name: string }[],
  limit = 80,
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
  return out.sort((x, y) => y.weight - x.weight).slice(0, limit);
}/**
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


/**
 * Characters that end a speech or action verb.
 *
 * A keyword that ends in one of these is a name glued to its own verb —
 * "玉道" out of "宝玉道", "姐儿说", "手抬". Those belong to a person,
 * not to the theme list.
 */
const KEYWORD_VERB_TAIL = new Set("说道问答笑喝骂叫喊叹听走站坐拿放看想".split(""));

/**
 * Nouns that refer to a PERSON, not to a theme.
 *
 * jieba tags kinship nouns as 普通名词 (太太/奶奶/丫头 are all "n"), so the
 * POS tag alone cannot separate "母亲" from "账房". This list does.
 *
 * It is deliberately wider than the cast list: a keyword list that says
 * 母亲 175, 父亲 124, 父母 96 tells an illustrator nothing they did not
 * already know from the cast, while the same slots in the list should hold
 * 银子, 扇子, 荷包 — the things that can actually be drawn.
 */
const PERSON_NOUNS = new Set([
  "母亲", "父亲", "父母", "爹娘", "爹", "娘", "孩子", "儿女", "儿子", "女儿",
  "孙子", "孙女", "兄弟", "姊妹", "姐妹", "亲戚", "家人", "家族", "亲人",
  "女人", "男人", "女人家", "人家", "众人", "大家", "客人", "宾客", "客人",
  "主仆", "下人", "奴才", "小厮", "婆子", "丫鬟", "丫头", "奶妈", "奶娘",
  "媳妇", "娘子", "婶子", "婶娘", "叔叔", "伯父", "伯母", "舅舅", "舅母",
  "姑妈", "姑父", "姑母", "表兄", "表弟", "表姐", "表妹", "堂兄", "堂弟",
  "师兄", "师弟", "师叔", "师伯", "师祖", "师父", "徒弟", "先生", "大夫",
  "太爷", "大爷", "二爷", "三爷", "爷们", "哥儿", "姐儿", "小主子", "主子",
  "二姐", "三姐", "大姐", "小姐", "少爷", "少奶奶", "姑娘", "奶奶", "太太",
  "老爷", "妈妈", "嬷嬷", "师傅", "长随", "小厮们", "家人", "嫔妃", "娘娘",
  "贵妃", "妃子", "皇帝", "皇上", "圣上", "太后", "太妃", "公主", "皇子",
  "王爷", "贝勒", "将军", "元帅", "老爷们", "哥儿们",
  "小子", "姑子", "厨子", "戏子", "痞子", "呆子", "傻子", "疯子", "泼子",
  "花子", "胡子", "瘸子", "瞎子", "哑巴", "老婆子", "孩子他", "小子们",
  "侍书", "彩霞", "彩云", "琥珀", "翠缕", "紫鹃", "雪雁", "莺儿", "麝月",
  "秋纹", "碧痕", "茜雪", "司棋", "入画", "抱琴", "金钏", "玉钏", "柳家",
]);

/**
 * Suffixes that mark a concrete, drawable noun.
 *
 * This is the classical Chinese test for concreteness: a word ending in a
 * material, container, building or plant morpheme denotes a thing in the
 * world, while 主意, 光景 and 原故 denote abstractions no illustrator can
 * render at all.
 *
 * It is the filter that turns a raw noun-frequency list into a prompt
 * vocabulary. On 红楼梦 it keeps 银子 (347), 扇子 (45), 荷包 (29),
 * 胭脂 (25), 珍珠 (23), 书房 (80), 帘子 (38), 箱子 (29) and drops
 * 主意 (180), 光景 (84), 原故 (109), 好歹 (66).
 *
 * Only unambiguous morphemes are listed. 子 also forms half the kinship
 * nouns (嫂子, 小子) and 头 heads half the verbs (低头, 回头); those are
 * handled by the person-noun and verb filters, not here.
 */
const CONCRETE_SUFFIX = new Set(
  (
    // containers, furniture, tools
    "碗盘杯壶瓶罐箱笼匣盒篮筐桶缸坛炉灶锅铲刀剪针线绳索梭" +
    "桌几案椅凳床榻帐被褥席毯枕帘幕屏帏橱柜架函笺帖信札册卷书" +
    "纸笔墨砚琴笛箫鼓钟磬锣琵琶伞帽鞋袜衣裙裳袍褂甲胄钗镯环佩" +
    "珠玉金银铜铁锡铅木竹布绢锦缎绫罗纱绸棉麻瓷陶璧璎珞扇帕巾囊袋" +
    "包袱奁篥柜橱舆轿辇车船艇舟桨篙辎械弓矢刀枪剑戟矛灯烛" +
    // food
    "茶酒饭肉鸡鸭鹅蛋奶酪酥蜜饯糖盐酱醋油脂膏粥饼饽糕粽果" +
    // body and illness
    "疮伤疤疹瘤肿窍脏腑脉息泪血汗涕唾痰涎发肤" +
    // small things and materials
    "盏碟匙勺结绦网兜筒道烟心盘宝贝玩物器兵裙裤巾" +
    "银钱钞币金银铜铁锡铅木竹泥陶瓷玉石角瓣枝叶根茎蕊籽" +
    "面线绳帛绸绡绢缣縠锦缎绫罗棉絮扇笠盔舆幌" +
    // food and drink, continued
    "羹汤粥饼糖茶酒醋酱油蜡香烛药草根茎叶瓣蕊"
  ).split(""),
);

/**
 * Suffixes that mark NATURE — the world a shot takes place in.
 *
 * These are separated from the generic concrete-noun list because a
 * plant or a weather word tells an illustrator what the light and the
 * palette look like, which is a different decision from "there is a fan
 * in the shot".
 */
const NATURE_SUFFIX = new Set(
  "花草树木林苑圃畦苔萍莲菊梅兰竹荷桂桃杏梨枣枫槐松柏杨柳莺燕雀鸦雁" +
    "鹤鹿豕犬猫鱼虾蟹蛟龙蛇龟凤鸾鹰隼狐狼熊虎豹稻黍稷麦菽粟豆" +
    "薯芋藕菱荇藻茅蓬蒿棘薇萝蕙兰荞麻苇荻竹篙桨帆篷帷" +
    "风雨雷电云霞雾露霜雪冰雹虹霓日月星晨昏昼曦晖阳泉谷坡岗岭崖" +
    "壤泥沙石岩洞壑屿潭池沼湖海江河洲渚岸滩原野径陌畦垄埂",
);

/**
 * Suffixes that mark a PLACE.
 *
 * Places are separated from generic objects because they answer a
 * different question in a prompt: not "what is in the frame" but "where
 * is the camera".
 */
const CONCRETE_PLACE_SUFFIX = new Set(
  "房舍屋宅院苑园囿圃场厂坊巷街路桥亭榭台阁楼殿宫室寺观庙祠塔" +
    "府仓库塾馆铺店摊庄堡寨园囿轩斋坞陌郭闾" +
    "关厢城门墙垣径谷坡岗岭崖洞穴窟潭池沼湖海江河川溪泉岛屿洲渚岸滩",
);

/**
 * Suffixes that mark an ABSTRACTION which still frames a scene.
 *
 * A concept is worth keeping even though it cannot be drawn: 诗社 says
 * "a poetry circle", 灯谜 says "a lantern-riddle festival", 省亲 says
 * "a provincial inspection visit". Each one implies a whole composition
 * — who is gathered, where, doing what — even though the word itself is
 * not an object.
 */
const CONCEPT_SUFFIX = new Set(
  "社谜宴会赛祭庆节礼典仪局席筵集苑观会馆场坊",);

/**
 * Suffixes that make a word a LOCATIVE PHRASE rather than a thing.
 *
 * 园里, 园中, 门口, 屋内, 桌上, 床上, 心里 — these are "in/at/on X"
 * constructions. They are extremely frequent in a novel and they say
 * where the camera is pointing, but they are not themes: the scene
 * layer already extracts the places themselves.
 */
const LOCATIVE_TAIL = new Set("里中内外上下前后旁侧畔间邻".split(""));

/**
 * Abstract nouns that jieba tags as 普通名词 but that no illustrator can
 * draw.
 *
 * These are feelings, mental states and judgements. 伤心 (87) and 伤感
 * (34) in 红楼梦 are the two biggest offenders; 主意, 原故 and 好歹 are
 * already excluded by the morpheme test because they end in a
 * grammatical character.
 */
const ABSTRACT_NOUNS = new Set([
  "伤心", "伤感", "欢喜", "高兴", "生气", "担心", "喜欢", "满意", "失望",
  "得意", "后悔", "委屈", "难过", "伤心处", "开心", "伤心事", "伤心话",
  "读书", "念书", "写字", "下棋", "喝酒", "吃饭", "说话", "做事", "打算",
  "主意", "原故", "光景", "好歹", "分寸", "情面", "脸面", "体面", "腰板",
  "混帐", "胡闹", "道理", "规矩", "章程", "省亲", "省视", "故事", "新闻",
  "日子", "无法", "益发", "越发", "十分", "从来", "方才",
  "一时", "一起", "一番", "一般", "一味", "余者", "本地",
  "小心", "开心", "放心", "决心", "用心", "恶心", "寒心", "疑心", "小心眼",
  "人物", "理会", "心意", "心意儿", "道理", "理儿", "情面", "情由", "情分",
  "分内", "分外", "分毫", "分寸", "分晓", "身份", "体统", "体面", "门面",
  "恩典", "境界", "造化", "缘分", "缘法", "情景", "情境", "意境", "意趣",
  "志向", "意思", "行礼", "身子", "蹄子", "孩子们", "嫂子们", "事由",
]);

/**
 * Extract recurring keywords, classified by what an illustrator can do
 * with them.
 *
 * This used to work on raw character n-grams, which was the only option
 * without a segmenter — and it produced a list no illustrator could use.
 * The twenty most frequent n-grams of any Chinese novel are grammar
 * (起来, 出来, 里头, 瞧瞧, 点头), because Chinese has no whitespace and
 * a character slicer cannot tell a word from a piece of a word. No
 * stopword list fixes this: the list grows forever and the next fragment
 * is always waiting.
 *
 * With jieba the same statistics become meaningful, because a segmenter
 * marks word boundaries and part of speech. In 红楼梦 the top nouns are
 * 银子 347, 怡红院 78, 大观园 49, 眼泪 58, 省亲 24, 诗社 18, 灯谜 6 —
 * exactly the vocabulary an illustrator needs.
 *
 * But a raw noun-frequency list is still 60% people and 30% abstractions
 * (主意 180, 光景 84, 原故 109). A prompt needs the *drawable* nouns, so
 * every candidate is filed by category:
 *
 *   "object" — a thing with a material or shape: 银子, 扇子, 荷包, 珠子
 *   "place"  — a place: 书房, 怡红院, 衙门, 花园
 *   "nature" — the world: 海棠, 桃花, 月, 雪
 *   "concept"— an abstraction that still frames a scene: 诗社, 灯谜, 省亲
 *
 * The categories are assigned by the *morpheme* the word ends in, which
 * is the classical Chinese test for concreteness: a word ending in a
 * material, container, building or plant morpheme denotes a thing in the
 * world, while 主意 and 原故 denote nothing that can be drawn.
 *
 * The segmenter is a native module, so this function is server-only.
 */
export function extractKeywords(
  text: string,
  limit = 40,
  exclude: string[] = [],
  known: string[] = [],
): { term: string; count: number; category: KeywordCategory }[] {
  // The segmenter does not know this novel. Its dictionary cuts 清风楼
  // into 清风 + 楼, which would file the place as "nature" (because 风 is
  // a weather morpheme) and lose the name entirely. The name engine has
  // already found the proper nouns, so the two token streams are
  // recombined before anything is counted.
  //
  // `known` and `exclude` are different lists on purpose. A scene title
  // belongs to `known` — it must be recognised as one word — but it is
  // NOT excluded from the keyword list, because 怡红院 and 大观园 are
  // exactly the words an illustrator wants.
  const tagged = mergeKnownNames(tagText(text), [
    ...known,
    ...exclude,
  ]);

  const counts = new Map<string, number>();
  for (const { word, tag } of tagged) {
    if (word.length < 2 || word.length > 6) continue;
    if (!THEME_TAGS.has(tag)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  // Latin words survive the Chinese segmenter untouched, so they are
  // counted separately — a novel can be bilingual.
  for (const word of text.match(/\b[a-zA-Z]{4,12}\b/g) ?? []) {
    if (CHINESE_STOPWORDS.has(word.toLowerCase())) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  // The density-aware threshold.
  //
  // A short passage legitimately contains terms that occur once — the
  // one 香炉 in a scene IS the detail an illustrator needs. A 900k
  // novel needs a higher bar or the list is just a frequency dump.
  //
  // The factor has to be gentle. At 1/2500 a whole novel demanded 362
  // occurrences, which is above the frequency of every actual theme in
  // it: 大观园 appears 49 times, 诗社 18, 灯谜 6. At the old 1/60000
  // the novel needed 16, which still dropped 灯谜. At 1/300000 the
  // novel needs 3 — low enough to keep 灯谜, high enough to bury the
  // one-off noise.
  const minCount =
    text.length < 20000 ? 1 : Math.max(2, Math.ceil(text.length / 300000));

  const scored: { term: string; count: number; category: KeywordCategory }[] = [];
  for (const [term, count] of counts) {
    if (count < minCount) continue;
    if (
      term.length >= 2 &&
      !/^[一-鿿]+$/.test(term) &&
      !/^[a-zA-Z]+$/.test(term)
    ) {
      continue;
    }
    // A stopword is grammar, not theme.
    if (CHINESE_STOPWORDS.has(term)) continue;
    // A kinship title refers to a person, not to a theme — and the person
    // is already in the cast.
    if (TITLE_NOUNS.has(term)) continue;
    if (COMMON_WORDS.has(term)) continue;
    if (COMMON_NAME_LIKE_WORDS.has(term)) continue;
    // A term that ends in a speech verb is a name glued to its own verb
    // ("玉道" out of "宝玉道"). It belongs to a person, not a theme.
    if (KEYWORD_VERB_TAIL.has(term[term.length - 1])) continue;
    // Skip fragments of a character name.
    if (exclude.some((name) => name.includes(term) || term.includes(name))) {
      continue;
    }
    // A noun that denotes a person belongs to the cast, not to the theme
    // list — jieba tags 太太/奶奶/丫头 all as 普通名词, so the POS tag
    // cannot do this.
    if (PERSON_NOUNS.has(term)) continue;
    // A measure phrase ("一盏", "那柄", "几张") counts its noun but does
    // not name it: the object is 茶盏, not 一盏.
    if (MEASURE_PREFIX.has(term[0])) continue;

    const category = classifyKeyword(term);
    if (!category) continue;
    scored.push({ term, count, category });
  }

  scored.sort((a, b) => b.count - a.count || b.term.length - a.term.length);

  // ── Drop terms already covered by a longer, more frequent kept term.
  const kept: { term: string; count: number; category: KeywordCategory }[] = [];
  for (const { term, count, category } of scored) {
    if (kept.some((k) => k.term.includes(term) && k.count >= count)) continue;
    kept.push({ term, count, category });
    if (kept.length >= limit) break;
  }
  return kept;
}

/**
 * Morphemes that are grammatical HEADS rather than semantic content.
 *
 * A word ending in one of these says nothing about what it denotes — the
 * meaning is carried by the character in front: 扇子 is a fan, 园子 is a
 * garden, 桌子上 is a table, 园里 is "in the garden". Looking at the head
 * instead of the tail is what keeps 园里 in the `place` bucket and 桌子上
 * in the `object` bucket.
 */
const GENERIC_HEAD = new Set(
  "子头儿们家边面里中上下内前后处间所般样只条件张把座".split(""),
);

/**
 * Numeral and demonstrative heads that turn a noun into a measure phrase.
 *
 * "一盏茶", "那柄剑", "几张纸" — the noun is real but the word as it
 * stands names a quantity, not a thing. The measure phrase carries no
 * visual information the bare noun does not already carry.
 */
const MEASURE_PREFIX = new Set(
  "一二三四五六七八九十百千两这那每某几个多少若干整半".split(""),
);

/**
 * File a keyword into the bucket an illustrator can act on, or reject it.
 *
 * Returns null for words that cannot be drawn and do not frame a scene.
 */
export function classifyKeyword(term: string): KeywordCategory | null {
  if (ABSTRACT_NOUNS.has(term)) return null;
  const last = term[term.length - 1];
  // A locative phrase ("in the garden", "on the table") is a position,
  // not a theme — the scene layer owns the places themselves.
  if (LOCATIVE_TAIL.has(last)) return null;
  // The semantic head of the word.
  //
  // 子 / 头 / 儿 are grammatical, not semantic: 银子 and 扇子 are named
  // by the character in FRONT of the suffix, while 嫂子, 法子 and 老子
  // are named by a character that denotes no thing at all. So the head
  // is the character before the suffix, and the suffix is ignored.
  const head = GENERIC_HEAD.has(last) ? term[term.length - 2] ?? "" : last;

  if (CONCRETE_PLACE_SUFFIX.has(head)) return "place";
  if (NATURE_SUFFIX.has(head)) return "nature";
  if (CONCRETE_SUFFIX.has(head)) return "object";
  // Nothing concrete in the word: it survives only if it is a compound
  // whose head names a practice rather than a thing. 诗社 and 灯谜 are
  // both two-character compounds whose second half (社, 谜) frames a
  // gathering, so they are kept as concepts.
  if (term.length >= 2 && CONCEPT_SUFFIX.has(last)) return "concept";
  return null;
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

  /**
   * A name that occurs only once or twice across a whole novel is almost
   * always a mis-parse, not a character.
   *
   * The frames that produce candidates are noisy: "便向贾蓉" yields 向贾蓉
   * (3 times), "贾母因" yields 贾母因 (a handful of times). Meanwhile the
   * real characters occur hundreds of times — 贾母 1616, 宝玉 3832,
   * 黛玉 1321. The threshold scales with the text so a short story is not
   * emptied out.
   */
  const minMentions = Math.max(2, Math.ceil(text.length / 12000));

  /**
   * Merge the surface forms that refer to the same person BEFORE ranking.
   *
   * 贾宝玉 / 宝玉, 凤姐儿 / 凤姐, 周瑞家的 / 周瑞家 are one person each.
   * Ranking the raw surface forms separately splits a single character
   * across several rows, so the cast list under-counts the protagonist
   * and the relationship graph gets parallel nodes for one person.
   */
  const cnCandidates = mergeCharacterAliases(
    [...cnCounts.keys()],
    cnCounts,
  ).filter((c) => c.mentions >= minMentions);

  const mergedCounts = new Map<string, number>();
  for (const candidate of cnCandidates) mergedCounts.set(candidate.name, candidate.mentions);
  for (const [name, count] of latinCounts) mergedCounts.set(name, count);

  const mergedIndex = new Map<string, Set<number>>();
  for (const [name, count] of mergedCounts) {
    const chaptersHere = new Set<number>();
    chapters.forEach((chapter, i) => {
      if (chapterTexts[i].includes(name)) chaptersHere.add(i);
    });
    mergedIndex.set(name, chaptersHere);
  }

  const ranked = rankCharacters(mergedCounts, mergedIndex).slice(0, 40);

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

  // The scene titles are passed as known proper nouns too: they are the
  // places the segmenter would otherwise cut apart (清风楼 → 清风 + 楼).
  const keywords = extractKeywords(
    text,
    40,
    [...characters.map((c) => c.name), ...entities.map((e) => e.name)],
    scenes.map((sc) => sc.title),
  );

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
