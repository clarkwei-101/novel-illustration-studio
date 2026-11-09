/**
 * Test suite for the Novel Illustration Studio.
 *
 * Runs with `npm test` (tsx tests/run.ts). No test framework — just a tiny
 * assertion harness so the suite has zero extra dependencies.
 *
 * The suite includes negative controls: for every rule the validator claims
 * to enforce, there is a case that MUST fail. A validator that has never been
 * observed red is an untested code path.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  validatePrompt,
  assemblePrompt,
  detectCameraConflicts,
  parseReferences,
  detectDuration,
  nextSlot,
  PROMPT_TEMPLATES,
  SEEDANCE_LIMITS,
} from "../src/lib/seedance";
import { segmentChapters, detectLanguage } from "../src/lib/segment";
import {
  analyze,
  classifyKeyword,
  classifyScene,
  splitSentences,
} from "../src/lib/analyze";
import { defaultTaxonomy } from "../src/lib/taxonomy";
import { decodeText, detectFormat } from "../src/lib/parse";
import { createFsDriver, setStorage } from "../src/lib/storage";
import {
  ingestNovel,
  listNovels,
  getNovel,
  deleteNovel,
  applyAgentAnalysis,
  upsertShot,
  buildShotPrompt,
  validateEntity,
} from "../src/lib/repository";
import type { Shot } from "../src/lib/types";

// ─────────────────────────────────────────────────────────── test harness

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function group(title: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ───────────────────────────────────────────────────────── sample content

const SAMPLE_NOVEL = `第一章 雨夜来客

夜色沉沉，林远山独自坐在书房里。窗外的雨越下越大，他听着雨声，手中握着一封旧信。

"你终于还是来了。"林远山抬起头，看着门口的年轻人。

沈墨站在门口，没有进来。他知道自己不配进去。三年前的那场雨夜，就是他亲手把那份名单交出去的。

"我来还债。"沈墨的声音很轻，"那份名单，是我从师门偷出来的。"

林远山的手停住了。书房里只剩下雨声。良久，他长长叹了一口气。

"你父亲当年，也是这么说的。"林远山缓缓道，"他进了那座山，就再也没有回来。"

沈墨终于跨过了门槛。

第二章 旧事

三天后，清风楼的雅间里，只有林远山和沈墨两人。

茶已经凉透了。沈墨盯着杯中的倒影，忽然开口："那个地方，在青峰山的后崖，有一条密道。"

"你见过？"

"我父亲留下的信里画过。"沈墨从怀里取出那封旧信，"就在这里。"

窗外传来马蹄声。

第三章 归途

青峰山的雾很重。沈墨背着包袱，走在山道上。跟在他身后的是苏婉——那个在清风楼为他斟茶的女子。

"你真的要去？"苏婉问。

"必须去。"沈墨说，"为了我父亲，也为了林远山。"

苏峰站在山口，看着他们远去。他是林远山的弟子，也是这个秘密的守门人。
`;

// ─────────────────────────────────────────────────────────────── the tests

async function run(): Promise<void> {
  // ── parsing & segmentation
  group("Parsing and segmentation");

  const chapters = segmentChapters(SAMPLE_NOVEL);
  check("splits a Chinese novel into chapters", chapters.length === 3, `got ${chapters.length}`);
  check(
    "keeps the chapter titles",
    chapters[0]?.title.includes("第一章") && chapters[1]?.title.includes("第二章"),
    chapters.map((c) => c.title).join(" | "),
  );
  check(
    "chapter previews are populated",
    chapters.every((c) => c.preview.length > 0),
  );
  check(
    "chapter offsets are monotonic",
    chapters.every((c, i) => i === 0 || c.start > chapters[i - 1].start),
  );

  const noHeadings = "A".repeat(50) + "\n\n" + "B".repeat(50) + "\n\n" + "C".repeat(50);
  const fallback = segmentChapters(noHeadings);
  check("falls back when no headings are present", fallback.length >= 1);

  // Regression: a short first chapter used to be folded into the second one,
  // silently deleting a chapter (and the beats inside it) from the book.
  const SHORT_CHAPTERS = `第一章 测试章节

林远山坐在书房里，雨声敲着窗棂。

"你终于还是来了。"林远山抬起头。

沈墨站在门口，手里握着一封旧信。

第二章 归途

青峰山的雾很重。沈墨背着包袱，走在山道上。
`;
  const shortChapters = segmentChapters(SHORT_CHAPTERS);
  check(
    "a short first chapter is NOT swallowed by the second",
    shortChapters.length === 2,
    `got ${shortChapters.length}: ${shortChapters.map((c) => c.title).join(" | ")}`,
  );
  check(
    "both short chapters keep their own text",
    shortChapters[0]?.preview.includes("林远山") &&
      shortChapters[1]?.preview.includes("青峰山"),
  );
  // Front matter IS folded — that is the one case where merging is right.
  const withPreface = segmentChapters(
    `楔子

很久以前。

第一章 起点

有人来了。
`,
  );
  check(
    "a prologue is folded into the chapter that follows it",
    withPreface.length === 1 && withPreface[0].preview.includes("很久以前"),
    `got ${withPreface.length}`,
  );

  check(
    "detects Chinese",
    detectLanguage(SAMPLE_NOVEL) === "zh",
    detectLanguage(SAMPLE_NOVEL),
  );

  const gbk = Buffer.from([
    0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4, 0xc3, 0xf7, 0xbb, 0xf2,
  ]);
  const decoded = decodeText(gbk);
  check(
    "decodes GBK-encoded Chinese",
    decoded.includes("中文测试") && decoded.includes("明或"),
    JSON.stringify(decoded),
  );
  check(
    "decodes UTF-8 with a BOM",
    decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("你好", "utf8")])).startsWith(
      "你好",
    ),
  );

  check(
    "detects the format from magic bytes",
    detectFormat("x.pdf", Buffer.from("%PDF-1.4")) === "pdf",
  );

  // ── analysis
  group("Deterministic analysis");

  const taxonomy = defaultTaxonomy();
  const analysis = analyze("test", SAMPLE_NOVEL, taxonomy);
  const characterNames = analysis.entities
    .filter((e) => e.category === "character")
    .map((e) => e.name);

  check(
    "extracts the recurring characters",
    characterNames.includes("林远山") && characterNames.includes("沈墨"),
    characterNames.join(", "),
  );
  check(
    "attaches evidence to the entities",
    analysis.entities.every((e) => e.evidence.length > 0),
  );
  check(
    "builds relationships between characters",
    analysis.relationships.length > 0,
    `${analysis.relationships.length} relationships`,
  );
  check(
    "the relationship graph references real entity ids",
    analysis.relationships.every((r) => {
      const ids = new Set(analysis.entities.map((e) => e.id));
      return ids.has(r.sourceId) && ids.has(r.targetId);
    }),
  );
  check("extracts scenes", analysis.scenes.length > 0, `${analysis.scenes.length}`);
  check(
    "classifies a mountain as wilderness",
    classifyScene("青峰山") === "wilderness",
    classifyScene("青峰山"),
  );
  check(
    "classifies a study as an interior room",
    classifyScene("书房") === "interior-room",
    classifyScene("书房"),
  );
  check("splits sentences", splitSentences("他说。好吗？").length === 2);
  check(
    "the first character is filed as the protagonist",
    analysis.entities.find((e) => e.category === "character")?.subcategory ===
      "protagonist",
  );
  check(
    "a relationship pair appears only once, not once per direction",
    (() => {
      const pairs = analysis.relationships.map(
        (r) => [r.sourceId, r.targetId].sort().join("|"),
      );
      return new Set(pairs).size === pairs.length;
    })(),
    JSON.stringify(
      analysis.relationships.map((r) => `${r.sourceId}->${r.targetId}:${r.weight}`),
    ),
  );
  check(
    "keywords are extracted even from a short text",
    analysis.keywords.length > 0,
    `${analysis.keywords.length} keywords`,
  );
  check(
    "keywords do not repeat a character name",
    analysis.keywords.every(
      (k) =>
        !analysis.entities.some(
          (e) => e.category === "character" && e.name.includes(k.term),
        ),
    ),
    analysis.keywords.map((k) => k.term).join(", "),
  );
  check(
    "no common noun is filed as a person",
    !characterNames.some((n) => ["书房里", "山缓缓", "那份名单"].includes(n)),
    characterNames.join(", "),
  );

  // Regression: a chapter with no dialogue at all used to yield zero
  // characters, because every name had to be anchored to a speech verb.
  const narrationOnly = analyze(
    "test",
    `第一章 测试章节

林远山坐在书房里，雨声敲着窗棂。

"你终于还是来了。"林远山抬起头。

沈墨站在门口，手里握着一封旧信。

第二章 归途

青峰山的雾很重。沈墨背着包袱，走在山道上。
`,
    taxonomy,
  );
  const narrationNames = narrationOnly.entities
    .filter((e) => e.category === "character")
    .map((e) => e.name);
  check(
    "finds characters in a passage with no dialogue attribution",
    narrationNames.includes("林远山") && narrationNames.includes("沈墨"),
    narrationNames.join(", "),
  );
  check(
    "a subject is not glued to its verb",
    !narrationNames.some((n) => n.endsWith("坐") || n.endsWith("站") || n.endsWith("背")),
    narrationNames.join(", "),
  );
  check(
    "a short passage still reports both chapters",
    narrationOnly.stats.chapters === 2,
    String(narrationOnly.stats.chapters),
  );
  check(
    "a short passage still builds a relationship",
    narrationOnly.relationships.length > 0,
    String(narrationOnly.relationships.length),
  );

  // ── keyword extraction
  //
  // The keyword list is what an illustrator reads. It used to be built
  // from raw character n-grams, which produced pure grammar (瞧瞧, 点头,
  // 里来) because Chinese has no whitespace. It is now segmented and
  // part-of-speech tagged, then filed by what an illustrator can do with
  // the word.
  group("Keyword extraction");

  const keywordText = `第一章 夜宴

林远山坐在书房里，手里捧着一盏茶。桌上的青铜香炉里升起一缕青烟。

沈墨推开房门，手里握着一封旧信。窗外月色清冷，梅花开了满园。

"你终于还是来了。"林远山放下茶盏，看向门口的沈墨。

沈墨没有进来。他知道自己不配进去。

第二章 灯谜

园子里挂起了彩灯，众人围坐在长桌旁猜灯谜。桌上摆着点心和果盘。

林远山取出一支笔，在纸上写下谜面。沈墨站在他身后，看着那些字。

青峰山的雾很重。沈墨背着包袱，走在山道上。
`;

  const keywordAnalysis = analyze("kw", keywordText, taxonomy);
  const keywordTerms = keywordAnalysis.keywords.map((k) => k.term);

  check(
    "the keyword list is not made of grammar fragments",
    !keywordTerms.some((t) => ["瞧瞧", "点头", "里来", "知道", "出来", "起来"].includes(t)),
    keywordTerms.join(", "),
  );
  check(
    "a drawable object survives",
    keywordTerms.some((t) => ["香炉", "茶盏", "灯", "笔", "谜面", "点心"].includes(t)),
    keywordTerms.join(", "),
  );
  check(
    "a place survives",
    keywordTerms.some((t) => ["书房", "房门", "园子", "长桌", "山道"].includes(t)),
    keywordTerms.join(", "),
  );
  check(
    "a nature word survives",
    keywordTerms.some((t) => ["月", "梅花", "青烟", "雾"].includes(t)),
    keywordTerms.join(", "),
  );
  check(
    "a person is not filed as a keyword",
    !keywordTerms.some((t) => ["林远山", "沈墨", "父亲", "母亲", "孩子"].includes(t)),
    keywordTerms.join(", "),
  );
  check(
    "every keyword carries a category",
    keywordAnalysis.keywords.every((k) =>
      ["object", "place", "nature", "concept"].includes(k.category),
    ),
    keywordAnalysis.keywords.map((k) => `${k.term}:${k.category}`).join(", "),
  );
  check(
    "a locative phrase is not a keyword",
    !keywordTerms.some((t) => ["园里", "园中", "门口", "屋里"].includes(t)),
    keywordTerms.join(", "),
  );

  // Negative control: the classifier must reject a word that names
  // nothing an illustrator can draw. A check that has never been
  // observed red is an untested code path.
  check(
    "an abstract noun is rejected",
    classifyKeyword("主意") === null && classifyKeyword("光景") === null,
    `${String(classifyKeyword("主意"))} / ${String(classifyKeyword("光景"))}`,
  );
  check(
    "a locative phrase is rejected",
    classifyKeyword("园里") === null,
    String(classifyKeyword("园里")),
  );
  check(
    "a concrete noun is accepted",
    classifyKeyword("香炉") === "object" && classifyKeyword("书房") === "place",
    `${String(classifyKeyword("香炉"))} / ${String(classifyKeyword("书房"))}`,
  );

  // ── prompt validation — positive cases
  group("Seedance validation — accepts valid prompts");

  const goodPrompt = assemblePrompt({
    shot: {
      id: "s1",
      novelId: "n1",
      index: 0,
      title: "雨夜书房",
      chapterIndex: 0,
      excerpt: "林远山独自坐在书房里。",
      entityIds: ["ent-0"],
      durationSec: 12,
      references: [
        { slot: "图片1", kind: "image", purpose: "作为人物形象参考" },
      ],
    },
    segments: [
      { from: 0, to: 4, description: "雨幕中的街道，人物撑伞走过" },
      { from: 4, to: 8, description: "推镜头至书房窗前" },
      { from: 8, to: 12, description: "面部特写，握信的手微微颤抖" },
    ],
    camera: "缓慢推镜头至面部特写",
    audio: "音效：雨声、脚步声；背景音乐：低沉的大提琴",
    style: "电影级质感，胶片颗粒，浅景深",
  });

  const good = validatePrompt(goodPrompt);
  check("a well-formed prompt passes", good.ok, good.errors.join(" | "));
  check("reads the duration back", good.facts.durationSec === 12, String(good.facts.durationSec));
  check("detects the segmented timeline", good.facts.hasTimeline);
  check("detects the camera language", good.facts.hasCamera);
  check("detects the audio design", good.facts.hasAudioDesign);
  check("detects the style suffix", good.facts.hasStyle);
  check("counts the image reference", good.facts.imageRefs.length === 1);
  check(
    "a purpose was parsed for the reference",
    good.errors.every((e) => !e.includes("没有说明用途")),
    good.errors.join(" | "),
  );

  // ── prompt validation — NEGATIVE CONTROLS
  group("Seedance validation — negative controls (must fail)");

  const tooManyImages = Array.from(
    { length: SEEDANCE_LIMITS.images + 1 },
    (_, i) => `@图片${i + 1} 作为首帧`,
  ).join("，");
  const imageOverflow = validatePrompt(tooManyImages);
  check(
    "rejects more than 9 images",
    imageOverflow.errors.some((e) => e.includes("图片素材")),
    imageOverflow.errors.join(" | "),
  );

  const tooManyFiles = Array.from(
    { length: SEEDANCE_LIMITS.totalFiles + 1 },
    (_, i) => `@图片${i + 1} 作为首帧`,
  ).join("，");
  check(
    "rejects more than 12 total files",
    validatePrompt(tooManyFiles).errors.some((e) => e.includes("总素材")),
  );

  const noPurpose = validatePrompt("@图片1 和 @图片2 的 10秒 画面，固定镜头");
  check(
    "rejects a reference with no stated purpose",
    noPurpose.errors.some((e) => e.includes("没有说明用途")),
    noPurpose.errors.join(" | "),
  );

  const tooLong = validatePrompt("一个 30秒 的画面，固定镜头，音效：雨声，电影级质感");
  check(
    "rejects a duration above 15 seconds",
    tooLong.errors.some((e) => e.includes("生成时长")),
    tooLong.errors.join(" | "),
  );

  const tooShort = validatePrompt("一个 2秒 的画面，固定镜头，音效：雨声，电影级质感");
  check(
    "rejects a duration below 4 seconds",
    tooShort.errors.some((e) => e.includes("生成时长")),
    tooShort.errors.join(" | "),
  );

  const conflict = validatePrompt(
    "10秒画面，固定镜头与环绕镜头同时使用，音效：雨声，电影级质感",
  );
  check(
    "rejects contradictory camera directions",
    conflict.errors.some((e) => e.includes("指令冲突")),
    conflict.errors.join(" | "),
  );

  const face = validatePrompt(
    "10秒画面，@图片1 写实真人脸部特写，固定镜头，音效：雨声，电影级质感",
  );
  check(
    "rejects a realistic human face",
    face.errors.some((e) => e.includes("写实真人脸部")),
    face.errors.join(" | "),
  );

  const duplicate = validatePrompt(
    "@图片1 作为首帧，@图片1 作为尾帧，10秒画面，固定镜头，音效：雨声，电影级质感",
  );
  check(
    "rejects a slot referenced twice",
    duplicate.errors.some((e) => e.includes("引用了多次")),
    duplicate.errors.join(" | "),
  );

  // Warnings are softer but must still fire.
  const noAudio = validatePrompt("10秒画面，缓慢推镜头至面部特写，电影级质感");
  check(
    "warns about a missing audio design",
    noAudio.warnings.some((w) => w.includes("音频设计")),
    noAudio.warnings.join(" | "),
  );
  const longNoTimeline = validatePrompt(
    "12秒画面，缓慢推镜头至面部特写，音效：雨声，电影级质感",
  );
  check(
    "warns about a missing timeline above 8 seconds",
    longNoTimeline.warnings.some((w) => w.includes("分时段")),
    longNoTimeline.warnings.join(" | "),
  );
  const shortWithTimeline = validatePrompt(
    "6秒画面，0-3秒：开场，3-6秒：收尾，缓慢推镜头，音效：雨声，电影级质感",
  );
  check(
    "warns about a timeline on a short prompt",
    shortWithTimeline.warnings.some((w) => w.includes("较短")),
    shortWithTimeline.warnings.join(" | "),
  );

  // The conflict detector on its own.
  check(
    "detects 固定镜头 + 环绕镜头 as a conflict",
    detectCameraConflicts("固定镜头与环绕镜头").length === 1,
  );
  check(
    "does not flag a single camera move",
    detectCameraConflicts("缓慢推镜头至面部特写").length === 0,
  );

  // Reference parsing.
  const refs = parseReferences(
    "@图片1 作为首帧，@视频1 的运镜，@音频1 的背景音乐",
  );
  check("parses three reference slots", refs.length === 3, String(refs.length));
  check(
    "classifies the reference kinds",
    refs[0]?.kind === "image" && refs[1]?.kind === "video" && refs[2]?.kind === "audio",
  );
  check(
    "parses the stated purposes",
    refs[0]?.purpose === "作为首帧" && refs[1]?.purpose === "的运镜",
    JSON.stringify(refs.map((r) => r.purpose)),
  );
  check("reads the duration", detectDuration("共15秒") === 15);
  check(
    "suggests the next free slot",
    nextSlot([{ slot: "图片1", kind: "image", purpose: "x" }], "image") === "图片2",
  );
  check(
    "every template either binds materials, segments time, or is short enough not to need it",
    PROMPT_TEMPLATES.every(
      (t) =>
        t.slots.length > 0 ||
        t.segmented ||
        t.durationSec <= SEEDANCE_LIMITS.minDurationSec * 2,
    ),
    PROMPT_TEMPLATES.filter(
      (t) =>
        t.slots.length === 0 &&
        !t.segmented &&
        t.durationSec > SEEDANCE_LIMITS.minDurationSec * 2,
    )
      .map((t) => t.id)
      .join(", "),
  );
  check(
    "every template states a duration inside the allowed range",
    PROMPT_TEMPLATES.every(
      (t) =>
        t.durationSec >= SEEDANCE_LIMITS.minDurationSec &&
        t.durationSec <= SEEDANCE_LIMITS.maxDurationSec,
    ),
  );
  check(
    "every template slot names a purpose",
    PROMPT_TEMPLATES.every((t) => t.slots.every((s) => s.purpose.length > 0)),
  );
  check(
    "every template skeleton states its duration",
    PROMPT_TEMPLATES.every((t) => t.skeleton.includes("秒")),
    PROMPT_TEMPLATES.filter((t) => !t.skeleton.includes("秒"))
      .map((t) => t.id)
      .join(", "),
  );
  check(
    "every template with materials states a purpose for each slot",
    PROMPT_TEMPLATES
      .filter((t) => t.slots.length > 0)
      .every((t) => t.skeleton.includes("@")),
    PROMPT_TEMPLATES.filter((t) => t.slots.length > 0 && !t.skeleton.includes("@"))
      .map((t) => t.id)
      .join(", "),
  );

  // ── taxonomy validation
  group("Taxonomy validation");

  const goodEntity = {
    id: "e1",
    name: "沈墨",
    category: "character" as const,
    subcategory: "protagonist",
    mentions: 10,
    chapterSpread: 0.6,
    evidence: [],
    summary: "",
    attributes: {},
  };
  check(
    "accepts an entity filed under a known subcategory",
    validateEntity(goodEntity, taxonomy).length === 0,
  );
  check(
    "rejects an unknown subcategory",
    validateEntity(
      { ...goodEntity, subcategory: "not-a-thing" },
      taxonomy,
    ).some((e) => e.includes("unknown subcategory")),
  );
  check(
    "rejects a category / subcategory mismatch",
    validateEntity(
      { ...goodEntity, category: "scene", subcategory: "protagonist" },
      taxonomy,
    ).some((e) => e.includes("belongs to category")),
  );

  // ── storage + repository round trip
  group("Storage and repository round trip");

  const dir = await mkdtemp(path.join(tmpdir(), "nis-test-"));
  setStorage(createFsDriver(dir));
  try {
    const bytes = Buffer.from(SAMPLE_NOVEL, "utf8");
    const record = await ingestNovel("sample.txt", bytes, "雨夜来客");
    check("ingest creates a novel", record.novel.id.length > 0);
    check("ingest detects the format", record.novel.format === "txt");
    check("ingest counts the chapters", record.novel.chapters === 3, String(record.novel.chapters));
    check(
      "ingest keeps the text",
      record.text.includes("林远山"),
    );

    const listed = await listNovels();
    check("the novel appears in the index", listed.length === 1, String(listed.length));

    const fetched = await getNovel(record.novel.id);
    check("the novel can be read back", fetched?.novel.title === "雨夜来客");

    const refined = await applyAgentAnalysis(record.novel.id, {
      entities: [
        {
          ...goodEntity,
          id: "ent-0",
          name: "林远山",
          subcategory: "mentor",
          agentReviewed: true,
          agentNote: "书房主人，旧事知情人",
          attributes: { age: "五十余岁", role: "书房主人" },
        },
        {
          ...goodEntity,
          id: "ent-1",
          name: "沈墨",
          subcategory: "protagonist",
          agentReviewed: true,
          agentNote: "背负旧债的闯入者",
        },
      ],
    });
    check(
      "the agent's entities replace the candidates",
      refined?.analysis.entities.length === 2 &&
        refined?.analysis.entities.every((e) => e.agentReviewed),
      `entities=${refined?.analysis.entities.length} reviewed=${refined?.analysis.entities.filter((e) => e.agentReviewed).length}`,
    );
    check(
      "the agent's attributes are preserved",
      refined?.analysis.entities.find((e) => e.name === "林远山")?.attributes.age ===
        "五十余岁",
    );
    check(
      "the analysis version increments",
      refined?.novel.analysisVersion === 2,
      String(refined?.novel.analysisVersion),
    );

    const shot: Shot = {
      id: "shot-1",
      novelId: record.novel.id,
      index: 0,
      title: "雨夜书房",
      chapterIndex: 0,
      excerpt: "林远山独自坐在书房里。",
      entityIds: ["ent-0"],
      durationSec: 12,
      references: [{ slot: "图片1", kind: "image", purpose: "作为人物形象参考" }],
    };
    const built = buildShotPrompt(shot, {
      segments: [
        { from: 0, to: 4, description: "雨幕街道" },
        { from: 4, to: 8, description: "推至窗前" },
        { from: 8, to: 12, description: "面部特写" },
      ],
      camera: "缓慢推镜头至面部特写",
      audio: "音效：雨声；背景音乐：大提琴",
      style: "电影级质感，胶片颗粒",
    });
    check("the assembler produces a prompt", built.prompt.length > 40);
    check("the assembled prompt validates", built.validation.ok, built.validation.errors.join(" | "));

    // ── assembler: the `parts` overrides must not be silently dropped
    group("Seedance assembler — parts overrides are honoured");

    const overrideShot: Shot = {
      id: "shot-override",
      novelId: "n1",
      index: 0,
      title: "清风楼夜宴",
      chapterIndex: 1,
      excerpt: "清风楼的三层，灯笼一层层挂下来。",
      entityIds: [],
      durationSec: 10,
    };
    const overridden = assemblePrompt({
      shot: overrideShot,
      subject: "沈墨站在清风楼三层木梯口",
      scene: "清风楼三层内厅，层层红灯笼垂落",
      action: "沈墨缓步登上木梯，停在雅间门前",
      camera: "缓慢推近，中景跟拍",
      style: "电影级质感，胶片颗粒，浅景深",
      durationSec: 6,
      mood: "紧张、悬疑",
    });
    check(
      "parts.durationSec overrides shot.durationSec",
      overridden.includes("6秒画面") && !overridden.includes("10秒画面"),
      overridden,
    );
    check(
      "parts.mood is appended to the style line",
      overridden.includes("电影级质感，胶片颗粒，浅景深，紧张、悬疑"),
      overridden,
    );
    check(
      "no stray '。' before a separator",
      !overridden.includes("。，"),
      overridden,
    );
    check(
      "the timeline sentence keeps its full stop",
      overridden.includes("6秒画面。") && !overridden.includes("6秒画面。，"),
      overridden,
    );

    const saved = await upsertShot(record.novel.id, {
      ...shot,
      prompt: built.prompt,
      validation: built.validation,
    });
    check("the shot is stored", saved?.shot.id === "shot-1");
    check(
      "the stored shot round-trips through the repository",
      (await getNovel(record.novel.id))?.shots.length === 1,
    );

    // A second ingest must not clobber the first.
    await ingestNovel("sample2.txt", bytes, "第二本");
    check(
      "two novels coexist",
      (await listNovels()).length === 2,
      String((await listNovels()).length),
    );

    // A novel must be removable again — otherwise the library only grows.
    const second = (await listNovels()).find((n) => n.title === "第二本");
    check("the second novel has an id", Boolean(second?.id));
    const deleted = await deleteNovel(second!.id);
    check("the novel is deleted", deleted);
    check(
      "the deleted novel is gone from the library",
      (await listNovels()).length === 1,
      String((await listNovels()).length),
    );
    check(
      "deleting an unknown id reports failure",
      (await deleteNovel("no-such-id")) === false,
    );
  } finally {
    setStorage(null);
    await rm(dir, { recursive: true, force: true });
  }

  // ── summary
  console.log(
    `\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m (${passed + failed} checks)\n`,
  );
  if (failed > 0) {
    console.log("\x1b[31mFailures:\x1b[0m");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("\n\x1b[31mThe suite crashed:\x1b[0m", error);
  process.exitCode = 1;
});
