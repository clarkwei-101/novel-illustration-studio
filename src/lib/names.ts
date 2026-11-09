/**
 * Chinese personal-name extraction.
 *
 * The hard part of the whole product is finding out WHO is in the novel.
 * Frequency alone fails ("太太" 1830 beats every name); a surname prefix
 * alone fails ("宝玉" 3832 has no surname); and a naive "longest prefix
 * wins" rule destroys the real characters (贾母 1616 loses to the junk
 * candidate 贾母足, which occurs once).
 *
 * So the module works in three passes:
 *
 *   1. IDENTIFY — collect *surface forms* that occupy a grammatical slot
 *      only a person can occupy: the subject of a speech verb
 *      ("宝玉说道"), the subject of an action verb ("黛玉坐在"), the
 *      addressee inside a quote ("“宝玉，…"), the possessor of a body
 *      part ("宝玉的手"). A surname prefix is only ONE of several ways
 *      to recognise such a slot; the others let us find 宝玉 and 黛玉,
 *      who never carry a surname in the text.
 *
 *   2. AGREE — keep only the candidates that fire in at least two
 *      independent frames. A real name is recognised by several
 *      different constructions at once; an ordinary word that happens
 *      to sit in one slot ("果然，", "叫人") fires in one.
 *
 *   3. RESOLVE — merge the surface forms that refer to the same person
 *      (贾宝玉 / 宝玉, 凤姐儿 / 凤姐, 周瑞家的 / 周瑞家) and drop the
 *      candidates that are ordinary words wearing a name's clothes.
 *
 * Everything is statistics over the raw text — no language model is
 * called. The output is a set of *candidates* with evidence attached,
 * which an AI agent then reviews, re-files, corrects and expands.
 */

/** Common Chinese surnames — the anchor for surname-initial names. */
export const SURNAMES = new Set(
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

/**
 * Compound surnames — the only names allowed to be four characters long.
 */
export const COMPOUND_SURNAMES = new Set([
  "欧阳", "司马", "上官", "诸葛", "夏侯", "东方", "独孤", "南宫", "皇甫",
  "尉迟", "公孙", "慕容", "长孙", "宇文", "令狐", "闻人", "澹台", "轩辕",
  "太史", "仲孙", "钟离", "闾丘", "端木", "西门", "南门", "北堂",
]);

/** Words that look like names but are common vocabulary. */
export const NAME_STOPWORDS = new Set([
  "什么", "怎么", "这样", "那样", "这个", "那个", "我们", "你们", "他们", "她们",
  "自己", "众人", "大家", "有人", "那人", "这人", "对方", "一旁", "一声", "一句",
  "一个", "一些", "所有", "整个", "这里", "那里", "哪里", "时候", "地方", "东西",
  "声音", "眼神", "嘴角", "心中", "心里", "脑海", "身边", "面前", "身后", "眼前",
  "因为", "所以", "但是", "如果", "虽然", "然后", "于是", "不过", "只是", "已经",
  "现在", "刚才", "片刻", "半晌", "许久", "良久", "忽然", "突然", "依然",
  "仍然", "依旧", "似乎", "仿佛", "好像", "宛如", "犹如", "一般", "一起", "一直",
  "说道", "笑道", "问道", "答道", "喝道", "骂道", "叹道", "低声道", "冷声道",
  "转向", "看向", "望向", "走向", "走去", "跑来", "站起", "坐下", "抬手", "伸手",
  "两头", "三人", "两人", "个数", "此时",
  "父亲", "母亲", "哥哥", "姐姐", "弟弟", "妹妹", "爷爷", "奶奶", "叔叔", "阿姨",
  "师父", "师傅", "弟子", "公子", "姑娘", "大人", "陛下", "殿下", "长老", "前辈",
]);

/**
 * Kinship and title nouns.
 *
 * These refer to people but they are NOT names: 太太 (1830 in 红楼梦) is
 * 王夫人 or 邢夫人 depending on the sentence, 老太太 (895) is 贾母,
 * 丫头 (959) is whoever is being addressed. Filing them as characters
 * would put three fake protagonists at the top of the cast list.
 *
 * The list covers the PARTIAL forms too — 老太太 appears in the text as
 * 老太太, 老太 and 太, and the fragment 老太 (927) is the same title
 * seen from the other end. A fragment that only exists because the word
 * was cut short is not a name.
 */
export const TITLE_NOUNS = new Set([
  "丫头", "丫头们", "丫头儿", "小丫头", "大丫头", "丫头子", "丫鬟", "丫环",
  "奶", "奶奶", "奶奶们", "老爷", "老爷们", "太太", "太太们", "夫人",
  "老太", "老太太", "老太太们", "姥姥", "姥爷", "外祖母", "外婆", "外公",
  "姨妈", "姨妈们", "姨娘", "姑妈", "姑奶奶", "姑老爷", "大奶奶", "二奶奶",
  "大奶", "二奶", "舅妈", "舅老爷", "姨太太", "姨奶奶", "亲家", "亲家母",
  "哥哥", "姐姐", "妹妹", "弟弟", "大哥", "二哥", "大姐", "小弟", "小妹",
  "哥儿", "姐儿", "爷儿", "孙儿", "侄儿", "姑儿", "妹儿", "兄儿",
  "二爷", "三爷", "大爷", "少爷", "小姐", "小姐们",
  "姑娘", "姑娘们", "妈妈", "嬷嬷", "婆子", "老婆子", "老婆",
  "媳妇", "媳妇们", "亲戚", "家人", "仆妇",
  "二小姐", "大小姐", "三小姐", "四小姐", "妈", "爹", "娘子", "儿子",
  "女儿", "孙子", "孙女", "伯父", "婶娘", "叔父", "舅父", "姑父",
  "哥儿们", "爷们", "家下", "家人", "家人们", "奴才", "小人",
  "孝家", "门上的", "门上", "旁边", "跟前", "手底", "手下",
  "宝兄弟", "哥儿们", "爷们", "奶奶们", "姑奶奶",
]);

/** Ordinary function words that are never people. */
export const COMMON_WORDS = new Set([
  "大家", "人家", "咱们", "各位", "列位", "诸位", "旁人", "别人", "谁",
  "什么", "怎么", "如何", "为什么", "自己", "众人", "众位",
  "起来", "下来", "出来", "进来", "过来", "回去", "上来",
  "如今", "从来", "向来", "素日", "平日", "近日", "早已", "刚才",
  "一时", "一时半刻", "一起", "一道", "一般", "一样", "一些", "一点",
  "里面", "外面", "上面", "下面", "当中", "中间", "跟前", "背后",
  "这一", "那一", "这个", "那个", "这些", "那些", "这样", "那样",
  "原来", "本来", "方才", "刚刚", "马上", "连忙", "果然", "越发", "难道",
  "知道", "听见", "看见", "想起", "觉得", "以为", "希望", "愿意",
  "喜欢", "讨厌", "生气", "欢喜", "辛苦", "可怜", "奇怪", "明白", "意思",
  "头一个", "两个", "三个", "有些", "所有", "许多", "多少", "几个",
  "悄悄", "慢慢", "明明", "明儿", "小丫", "悄悄的", "慢慢的", "默默",
  "外面", "里边", "外边", "上边", "下边", "头里", "夜里", "家里",
  "哥哥", "嫂嫂", "大叔", "大婶", "小叔", "小姑",
]);

/**
 * Ordinary words that a surname heuristic will happily mistake for a name.
 */
export const COMMON_NAME_LIKE_WORDS = new Set([
  "高兴", "祖宗", "能够", "左右", "后面", "前面", "花样", "样子", "时候",
  "公们", "人们", "家下人", "空里", "空空", "尚且", "还有",
  "记者", "只是", "不过", "然后", "原本", "有人", "无人", "东西",
  "南方", "北方", "西方", "东方",
  "平日", "今日", "明日", "昨日", "明年", "去年", "昔日", "从前",
  "处处", "事事", "件件", "样样", "好好", "常常", "偏偏", "恰恰",
  "石头", "花纹", "云儿", "花儿", "鸟儿", "鱼儿", "马儿", "狗儿", "猫儿",
  "乡下", "城里", "家里", "外头", "上头", "下头", "里头",
  "何苦", "何曾", "胡说", "解得", "解得切",
]);

/**
 * Characters that never appear inside a Chinese personal name.
 *
 * This is the filter that separates a name from an adverbial phrase. "便笑"
 * and "因说" and "一面说" all occupy the subject slot grammatically, but
 * every one of them is built from characters that no Chinese name ever
 * uses. Names are made of *content* characters; function characters
 * belong to the grammar around them.
 *
 * The list deliberately omits numerals and size words (一, 二, 大, 小) as
 * single characters, because those DO appear inside names (尤二姐, 焦大).
 * A leading numeral is rejected separately, by `NUMERAL_CHARS`.
 *
 * It ALSO omits the kinship morphemes 儿 / 姐 / 妹 / 哥 / 爷 / 亲 / 侄.
 * Those look like function words but they are among the most common
 * characters in Chinese personal names — 平儿, 巧姐, 薛姨妈, 尤二姐,
 * 赵姨娘. Blocking them removes the protagonist and several of the main
 * characters from every cast list.
 */
export const FUNCTION_CHARS = new Set(
  (
    "的了着过是在和与也就都很更不没我你他她它这那些个之而但却才便又再从" +
    "把被给让向对为于所因由且若如或每某使等只最总常会能可要应须该另同" +
    "并即则乃亦来说去看想笑问答听走站坐拿放做用住开关出入回到口心手" +
    "眼面身力声味句依既正众子咱自现时地事好已还们姑婆叫"
  ).split(""),
);

/** Characters that cannot START a personal name (一面 / 一句 / 五儿). */
const NUMERAL_CHARS = new Set("一二三四五六七八九十百千万几半数多俩".split(""));

/** Common nouns that read like names but describe a place. */
const COMMON_PLACE_NOUNS = new Set([
  "书房", "客厅", "卧室", "厨房", "院子", "走廊", "大厅", "广场", "校场",
  "军营", "店铺", "清风楼", "青峰山", "客栈", "酒馆", "茶楼",
  "山门", "后崖", "密道", "名单", "信封", "箱子", "房间",
]);

/** Characters that never appear inside a person name. */
const NAME_FORBIDDEN_CHARS = new Set([
  "的", "了", "是", "在", "和", "与", "也", "就", "都", "很", "更", "不", "没",
  "我", "你", "他", "她", "它", "这", "那", "些", "个", "之", "而", "但",
]);

/**
 * Speech-attribution verbs that follow a speaker name.
 */
export const SPEECH_VERBS = [
  "说道", "问道", "答道", "笑道", "喝道", "骂道", "叹道", "低声道", "冷声道",
  "沉声道", "轻声", "大声", "怒道", "解释道", "补充道", "反驳道", "喃喃",
  "开口", "出声", "回答", "反问", "追问", "喊道", "怒斥", "冷笑", "沉吟",
];

/**
 * Speech verbs that take a PERSON as their subject.
 *
 * "便说" and "因笑" are adverbial phrases, but they occupy the subject
 * slot of a bare verb. A full speech-act verb ("说道", "笑道", "问道")
 * can only have a person in front of it — you cannot say "便说道".
 * That is what separates 宝玉 from 一面说.
 */
export const STRONG_SPEECH_VERBS = [
  "说道", "问道", "答道", "笑道", "喝道", "骂道", "叹道", "低声道", "冷声道",
  "沉声道", "怒道", "开口道", "喊道", "怒斥", "回答", "反问", "追问",
  "嘲笑", "沉吟", "数落", "嚷道", "叫道", "回道", "应道", "接口道",
];

/**
 * Action verbs whose subject is a person.
 *
 * These are the frames that keep a passage with no dialogue at all from
 * yielding zero people.
 */
export const ACTION_VERBS = [
  "坐在", "站在", "躺在", "靠着", "望着", "看着", "盯着", "听着",
  "走来", "走去", "跑来", "来到", "回到", "走进", "走出", "爬上", "下山",
  "背起", "扛着", "抱着", "握住", "拿起", "放下", "抽出", "端起",
  "松开", "摊开", "合上", "踏进", "迈出", "捂住", "站起身",
  "抬起头", "低下头", "转过身", "摇头", "点点头", "皱眉",
  "笑了", "哭了", "喊", "叫", "打", "走", "跑", "坐", "站", "躺",
];

/**
 * Characters that can trail a subject and are never part of a name.
 *
 * Chinese puts the subject immediately before the verb, so any adverb
 * that sits between them must be peeled off: "宝玉忙说道" → 宝玉,
 * "贾母笑" → 贾母, "林远山独自坐在" → 林远山.
 */
const TRAILING_ADVERBS = new Set(
  (
    "缓轻冷淡沉突忽随便都也还又再才却静默摇抬转皱笑点摊伸垂低高连忙急" +
    "因遂径独自即复频仍依照随逐欲愿意想要会能可敢肯定必已未曾正恰才方刚" +
    "常时竟倒偏只都全极甚颇稍略微悄冷忙匆急快慢狠怪真不无没甚颇极甚很" +
    "-speech答问喝骂叫喊叹说笑"
  ).split(""),
);

/**
 * Multi-character adverbs that trail a subject.
 */
const NAME_TAIL_NOISE = new Set([
  "缓缓", "慢慢", "淡淡", "冷冷", "轻轻", "微微", "忽然", "突然", "连忙", "急忙",
  "终于", "仍然", "依然", "随即", "立刻", "接着", "然后", "因此", "所以",
  "低低", "一声", "一句", "一遍", "一下", "回头", "一面",
]);

/**
 * Function words that can PRECEDE a name inside a captured run.
 *
 * A frame like "便向贾蓉" produces a run whose first character is a
 * preposition or conjunction, not part of the name. These characters are
 * also surnames (向, 连, 与, 从, 于, 方 …), so without stripping them the
 * extractor locks onto the function word and emits a name nobody has:
 * 向贾蓉 instead of 贾蓉.
 */
const LEADING_FUNCTION_WORDS = new Set([
  "向", "连", "就", "便", "与", "和", "及", "以", "因", "为", "由", "从",
  "对", "跟", "同", "随", "照", "当", "该", "使", "让", "着", "了", "们",
  "才", "却", "又", "也", "更", "最", "只", "再", "已", "曾", "将", "能",
  "会", "要", "想", "说", "道", "看", "见", "把", "被", "给", "在", "是",
  "有", "无", "不", "没", "很", "太", "就", "乃", "亦", "且", "则",
  "之", "其", "所", "既", "若", "如", "或", "每", "某", "只", "各",
  "整", "满", "半", "数", "几", "多", "下", "上", "中", "前", "后", "里",
]);

/**
 * Strip leading function words from a captured run.
 *
 * "向贾蓉" → "贾蓉", "就连王夫人" → "王夫人".
 */
export function stripLeadingFunctionWords(candidate: string): string {
  let name = candidate;
  while (name.length > 2 && LEADING_FUNCTION_WORDS.has(name[0])) {
    name = name.slice(1);
  }
  return name;
}

/**
 * Strip trailing adverbs and particles from a candidate name.
 *
 * "林远山缓缓" → "林远山", "沈墨的" → "沈墨", "宝玉忙" → "宝玉".
 */
export function trimNameTail(candidate: string): string {
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
    if (name.length > 2 && TRAILING_ADVERBS.has(name[name.length - 1])) {
      name = name.slice(0, -1);
      changed = true;
    }
    if (
      name.length > 2 &&
      (name.endsWith("的") || name.endsWith("地") || name.endsWith("着"))
    ) {
      name = name.slice(0, -1);
      changed = true;
    }
  }
  return name;
}

/**
 * Is this string shaped like a Chinese personal name?
 *
 * The filters are ordered from cheap to expensive, and the expensive ones
 * are last because they are the ones that cost the most false positives.
 */
export function isPlausibleName(name: string): boolean {
  if (name.length < 2 || name.length > 4) return false;
  if (!/^[一-鿿]+$/.test(name)) return false;
  if (NAME_STOPWORDS.has(name)) return false;
  if (COMMON_PLACE_NOUNS.has(name)) return false;
  if (COMMON_NAME_LIKE_WORDS.has(name)) return false;
  if (TITLE_NOUNS.has(name)) return false;
  if (COMMON_WORDS.has(name)) return false;
  if ([...name].some((c) => NAME_FORBIDDEN_CHARS.has(c))) return false;
  // The decisive filter: every character must be a *content* character.
  if ([...name].some((c) => FUNCTION_CHARS.has(c))) return false;
  // A name never starts with a numeral (一面 / 一句 / 五儿).
  if (NUMERAL_CHARS.has(name[0])) return false;
  return true;
}

/**
 * Does the name start with a surname? If so, what is the given part?
 */
export function givenPart(name: string): string | null {
  if (name.length >= 3 && SURNAMES.has(name[0])) {
    const given = name.slice(1);
    if (given.length >= 2 && given.length <= 3) return given;
  }
  if (name.length === 4 && COMPOUND_SURNAMES.has(name.slice(0, 2))) {
    return name.slice(2);
  }
  return null;
}

/** Does the name start with a surname at all? */
export function hasSurnamePrefix(name: string): boolean {
  if (SURNAMES.has(name[0])) return true;
  if (name.length >= 3 && COMPOUND_SURNAMES.has(name.slice(0, 2))) return true;
  return false;
}

/**
 * The frames that count as independent evidence.
 *
 * A frame id is "strong" when the slot it matches is one that only a
 * person can fill. A frame id is "weak" when the slot is also filled by
 * ordinary grammar ("便说" sits in the subject slot of 说).
 */
const STRONG_FRAMES = new Set([
  "strong-speech-subject",
  "strong-speech-after",
  "bare-speech-after",
  "quote-address",
  "possessor",
  "action-subject",
]);

/**
 * Collect the surface forms that sit in a slot only a person can occupy.
 *
 * This is the IDENTIFY pass. Two families of frames:
 *
 *   - SURNAME frames, which need a surname-initial prefix (贾母, 贾政).
 *   - SUBJECT frames, which do not (宝玉, 黛玉, 袭人, 凤姐). These are
 *     the ones that rescue the actual protagonists of a Chinese novel:
 *     宝玉 occurs 3832 times in 红楼梦 and carries no surname at all.
 *
 * The subject frames require the token to sit at a CLAUSE BOUNDARY, or to
 * be followed by a strong speech verb, or to be the possessor of a body
 * part. A token in the middle of a longer phrase ("今日天气好") is not a
 * subject and is not a candidate.
 */
export function identifyCharacterNames(text: string): Set<string> {
  /** candidate → the set of frames it fired in. */
  const evidence = new Map<string, Set<string>>();
  const note = (candidate: string | null, frame: string) => {
    if (!candidate) return;
    if (!evidence.has(candidate)) evidence.set(candidate, new Set());
    evidence.get(candidate)!.add(frame);
  };

  /**
   * Reduce a captured run to the name it contains.
   *
   * Chinese puts the subject immediately before the verb, so the name is
   * a SUFFIX of the run — "林远山独自" ends in 林远山, "下贾母" ends in
   * 贾母. But a run can also be longer than the name for another reason
   * ("宝玉那边"), in which case the name is a PREFIX. So both are tried:
   * suffixes first (the usual case), then prefixes.
   */
  const refine = (raw: string): string | null => {
    const run = stripLeadingFunctionWords(trimNameTail(raw));
    if (run.length < 2) return null;
    // 1. suffixes, longest first — the subject is closest to the verb.
    for (let len = Math.min(4, run.length); len >= 2; len -= 1) {
      const candidate = run.slice(run.length - len);
      if (isPlausibleName(candidate)) return candidate;
    }
    // 2. prefixes, longest first.
    for (let len = Math.min(4, run.length); len >= 2; len -= 1) {
      const candidate = run.slice(0, len);
      if (isPlausibleName(candidate)) return candidate;
    }
    return null;
  };

  /**
   * Reduce a captured run to a SURNAME-initial name.
   *
   * Used by the frames that only fire for people whose surname is
   * spelled out (贾母, 贾政, 林远山). The surname is the anchor, so the
   * name is the longest plausible substring that starts with one.
   */
  const refineSurname = (raw: string): string | null => {
    const run = stripLeadingFunctionWords(trimNameTail(raw));
    for (let start = 0; start < run.length - 1; start += 1) {
      if (!SURNAMES.has(run[start]) && !COMPOUND_SURNAMES.has(run.slice(start, start + 2))) {
        continue;
      }
      for (let len = Math.min(4, run.length - start); len >= 2; len -= 1) {
        const candidate = run.slice(start, start + len);
        if (len === 4 && !COMPOUND_SURNAMES.has(candidate.slice(0, 2))) continue;
        if (isPlausibleName(candidate)) return candidate;
      }
      return null;
    }
    return null;
  };

  let m: RegExpExecArray | null;

  // ── 1. SURNAME frames ────────────────────────────────────────────────

  // 1a) Dialogue attribution: 1-6 Han characters before a speech verb.
  for (const verb of SPEECH_VERBS) {
    const re = new RegExp(`([\\u4e00-\\u9fff]{1,6})${verb}`, "g");
    while ((m = re.exec(text)) !== null) note(refineSurname(m[1]), "surname-speech");
  }

  // 1b) Subject AFTER the speech verb: "宝玉说道" / "黛玉笑道".
  for (const verb of SPEECH_VERBS) {
    const re = new RegExp(`${verb}([\\u4e00-\\u9fff]{2,4})`, "g");
    while ((m = re.exec(text)) !== null) note(refineSurname(m[1]), "surname-speech-after");
  }

  // 1c) Subject after an action verb: "宝玉站在门边".
  for (const verb of ACTION_VERBS) {
    const re = new RegExp(`${verb}([\\u4e00-\\u9fff]{2,4})`, "g");
    while ((m = re.exec(text)) !== null) note(refineSurname(m[1]), "surname-action-after");
  }

  // 1d) A name right after a clause boundary: "宝玉。/ 宝玉，/ 宝玉：".
  const boundaryRe =
    /[。！？；\n"'”』】）]、\s*([一-鿿]{2,4})(?=[，。！？；：\n"'“「『【（])/g;
  while ((m = boundaryRe.exec(text)) !== null) note(refineSurname(m[1]), "surname-boundary");

  // 1e) Possessive narration: "沈墨的声音很轻".
  const voiceRe = /([一-鿿]{2,4})的声音/g;
  while ((m = voiceRe.exec(text)) !== null) note(refineSurname(m[1]), "surname-voice");

  // 1f) Quote adjacency: "…"X说道.
  const quoteRe = /[”"」』]\s*，?\s*([一-鿿]{1,6})(说道|问道|答道|笑道|喝道|骂道|叹道|冷笑道|低声道|开口道|回答|反问|追问|喊道|怒斥|道|说|问|答)/g;
  while ((m = quoteRe.exec(text)) !== null) note(refineSurname(m[1]), "surname-quote");

  // 1g) Address inside a quote: "沈墨，…"
  const addrRe = /[“"「『]([一-鿿]{2,3})[，,]/g;
  while ((m = addrRe.exec(text)) !== null) note(refineSurname(m[1]), "surname-address");

  // 1h) Narration frame: the subject of a descriptive sentence.
  for (const verb of ACTION_VERBS) {
    const re = new RegExp(`([\\u4e00-\\u9fff]{1,6})${verb}`, "g");
    while ((m = re.exec(text)) !== null) note(refineSurname(m[1]), "surname-narration");
  }

  // ── 2. SUBJECT frames (no surname needed) ────────────────────────────
  //
  // 宝玉 / 黛玉 / 袭人 / 凤姐 are the real protagonists of 红楼梦 and
  // NONE of them carries a surname in the text. They are found by the
  // grammatical slot they occupy, not by their shape.

  const CLAUSE = "[，,。！？；：、\\n\"'”』】）]";

  // 2a) Clause boundary + subject + STRONG speech verb: "，宝玉说道".
  for (const verb of STRONG_SPEECH_VERBS) {
    const re = new RegExp(`${CLAUSE}\\s*([一-鿿]{2,4})${verb}`, "g");
    while ((m = re.exec(text)) !== null) note(refine(m[1]), "strong-speech-subject");
  }

  // 2b) STRONG speech verb + subject + clause boundary: "笑道，宝玉…".
  for (const verb of STRONG_SPEECH_VERBS) {
    const re = new RegExp(`${verb}([一-鿿]{2,4})(?=[，,。！？；：、\\n"'”』】）])`, "g");
    while ((m = re.exec(text)) !== null) note(refine(m[1]), "strong-speech-after");
  }

  // 2c) Any speech verb + subject + clause boundary: "苏婉问。".
  for (const verb of SPEECH_VERBS) {
    const re = new RegExp(`${verb}([一-鿿]{2,4})(?=[，,。！？；：、\\n"'”』】）])`, "g");
    while ((m = re.exec(text)) !== null) note(refine(m[1]), "bare-speech-after");
  }

  // 2d) Clause boundary + subject + action verb: "，黛玉坐在…".
  for (const verb of ACTION_VERBS) {
    const re = new RegExp(`${CLAUSE}\\s*([一-鿿]{2,4})${verb}`, "g");
    while ((m = re.exec(text)) !== null) note(refine(m[1]), "action-subject");
  }

  // 2e) Addressed inside a quote: "“宝玉，…".
  const quoteAddr = /[“"「『]([一-鿿]{2,3})[，,]/g;
  while ((m = quoteAddr.exec(text)) !== null) note(refine(m[1]), "quote-address");

  // 2f) Possessor of a body part: "宝玉的手" / "黛玉的话".
  const possessor = new RegExp(
    `${CLAUSE}\\s*([一-鿿]{2,3})的[手脸眼身声笑心话头脚背影神字]`,
    "g",
  );
  while ((m = possessor.exec(text)) !== null) note(refine(m[1]), "possessor");

  // ── 3. AGREE — keep only candidates seen in enough independent frames ──

  /**
   * How many independent strong frames does the candidate fire in?
   *
   * A real name is recognised by several different constructions at
   * once. An ordinary word that happens to occupy one slot — "果然，"
   * inside a quote, "叫人" before a verb — fires in exactly one.
   *
   * The threshold drops to 1 for short texts, where there is not enough
   * material for a name to appear in many constructions.
   */
  const requiredFrames = text.length >= 20000 ? 2 : 1;

  const all = [...evidence.entries()]
    .filter(([, frames]) => {
      let strong = 0;
      for (const frame of frames) if (STRONG_FRAMES.has(frame)) strong += 1;
      return strong >= requiredFrames;
    })
    .map(([name]) => name);

  // ── 4. RESOLVE overlaps ──────────────────────────────────────────────
  //
  // A candidate is discarded when a shorter surname-initial SUFFIX of it
  // is at least as frequent in the text — that suffix is the real name
  // (向贾蓉 loses to 贾蓉).
  //
  // A candidate is discarded when a LONGER candidate that starts with it
  // is comparably frequent — but ONLY then. The naive rule ("the longer
  // name always wins") destroys 贾母, which occurs 1616 times, because
  // the junk candidate 贾母足 occurs once. Frequency decides, not length.
  const counts = new Map<string, number>();
  for (const name of all) {
    let at = text.indexOf(name);
    let n = 0;
    while (at !== -1) {
      n += 1;
      at = text.indexOf(name, at + name.length);
    }
    counts.set(name, n);
  }

  // Suffix rule first: "向贾蓉" loses to "贾蓉".
  const afterSuffix = all.filter((name) => {
    const own = counts.get(name) ?? 0;
    for (let len = 2; len < name.length; len += 1) {
      const suffix = name.slice(name.length - len);
      if (!SURNAMES.has(suffix[0])) continue;
      const suffixCount = counts.get(suffix);
      // Only consider a suffix that was itself a candidate — otherwise we
      // would invent names that were never detected.
      if (suffixCount === undefined) continue;
      if (suffixCount >= own) return false;
    }
    return true;
  });

  // Prefix rule second: "林远" loses to "林远山", but "贾母" survives
  // "贾母足" because 1616 ≫ 1.
  const surviving = afterSuffix.filter((name) => {
    const own = counts.get(name) ?? 0;
    return !afterSuffix.some((other) => {
      if (other === name) return false;
      if (!other.startsWith(name) || other.length <= name.length) return false;
      const otherCount = counts.get(other) ?? 0;
      // The longer form only wins if it is a genuine alternative reading
      // of the same text — i.e. it is comparably frequent.
      return otherCount >= own * 0.5;
    });
  });

  return new Set(surviving);
}

/** A character, with every surface form that refers to it. */
export interface CharacterCandidate {
  /** The canonical surface form — the most frequent one. */
  name: string;
  /** Total mentions across every alias. */
  mentions: number;
  /** Other surface forms of the same person (贾宝玉, 凤姐儿, …). */
  aliases: string[];
}

/**
 * Merge the surface forms that refer to the same person.
 *
 * Three rules, applied in order:
 *
 *   1. THE PARTICLE: 周瑞家的 and 周瑞家 are the same person. A trailing
 *      的 is a possessive, not part of the name.
 *   2. THE DIMINUTIVE: 凤姐儿 and 凤姐 are the same person.
 *   3. THE FULL NAME: 贾宝玉 and 宝玉 are the same person — but so are
 *      甄宝玉 and 宝玉, and those are two DIFFERENT people. The
 *      tie-break is the surname's own activity in the text: 贾 heads a
 *      large family (贾母 1616, 贾政 919, 贾琏 738), so 贾宝玉 is the
 *      long form of 宝玉, whereas 甄 appears twice in the whole novel
 *      and 甄宝玉 is a character in his own right.
 *
 * The canonical form is the most frequent one, because that is the form
 * an illustrator would search for.
 */
export function mergeCharacterAliases(
  surfaces: string[],
  counts: Map<string, number>,
): CharacterCandidate[] {
  const present = surfaces.filter((s) => (counts.get(s) ?? 0) > 0);
  if (present.length === 0) return [];

  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const s of present) parent.set(s, s);

  // index by the particle-stripped form
  const byStripped = new Map<string, string[]>();
  for (const s of present) {
    const key = s.endsWith("的") && s.length > 2 ? s.slice(0, -1) : s;
    byStripped.set(key, [...(byStripped.get(key) ?? []), s]);
  }

  // rule 1 + 2
  for (const s of present) {
    for (const t of byStripped.get(s) ?? []) if (t !== s) union(s, t);
    if (s.length >= 3 && s.endsWith("儿")) {
      for (const t of byStripped.get(s.slice(0, -1)) ?? []) union(s, t);
    }
  }

  // rule 3 — full name ↔ given name
  const ownersByGiven = new Map<string, string[]>();
  for (const s of present) {
    const given = givenPart(s);
    if (!given) continue;
    ownersByGiven.set(given, [...(ownersByGiven.get(given) ?? []), s]);
  }
  // How active is each surname in this text?
  const surnameTotals = new Map<string, number>();
  for (const s of present) {
    if (!hasSurnamePrefix(s)) continue;
    const key = COMPOUND_SURNAMES.has(s.slice(0, 2)) ? s.slice(0, 2) : s[0];
    surnameTotals.set(key, (surnameTotals.get(key) ?? 0) + (counts.get(s) ?? 0));
  }
  for (const [given, owners] of ownersByGiven) {
    // The bare surface form is the given name itself (宝玉, 黛玉). It is
    // what the text uses when it does not spell the surname out.
    //
    // Note that the bare form is NOT one of the owners — an owner always
    // carries a surname (贾宝玉), while the bare form never does.
    const bare = present.filter((t) => t === given);
    if (bare.length === 0) continue;
    // The owner whose surname is busiest in this text is the one whose
    // given name the bare form abbreviates.
    const ranked = [...owners].sort((a, b) => {
      const ka = COMPOUND_SURNAMES.has(a.slice(0, 2)) ? a.slice(0, 2) : a[0];
      const kb = COMPOUND_SURNAMES.has(b.slice(0, 2)) ? b.slice(0, 2) : b[0];
      return (surnameTotals.get(kb) ?? 0) - (surnameTotals.get(ka) ?? 0);
    });
    const winner = ranked[0];
    for (const t of bare) union(winner, t);
  }

  // Assemble the groups.
  const groups = new Map<string, string[]>();
  for (const s of present) {
    const root = find(s);
    groups.set(root, [...(groups.get(root) ?? []), s]);
  }

  const out: CharacterCandidate[] = [];
  for (const members of groups.values()) {
    const sorted = [...members].sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0),
    );
    const canonical = sorted[0];
    out.push({
      name: canonical,
      mentions: members.reduce((sum, m) => sum + (counts.get(m) ?? 0), 0),
      aliases: sorted.slice(1),
    });
  }
  return out.sort((a, b) => b.mentions - a.mentions);
}

/**
 * Count how often each surface form occurs in the text.
 *
 * `text.indexOf` is a native substring search, so this is fast even for
 * a million-character novel and a few hundred candidate names.
 */
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
