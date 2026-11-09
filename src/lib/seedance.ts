/**
 * Seedance 2.0 prompt engine.
 *
 * The `seedance-prompt-zh` skill is a written guide for a human/agent prompt
 * engineer. This module compiles its hard constraints into executable checks
 * and its structure into a deterministic assembler, so an AI agent can drive
 * the workflow without re-deriving the rules each time.
 *
 * Constraints encoded here (from the skill):
 *   - images <= 9, videos <= 3, audio <= 3, total files <= 12
 *   - duration 4..15 seconds
 *   - every @slot must state its purpose
 *   - > 8s prompts should use a segmented timeline
 *   - conflicting camera directions (固定镜头 + 环绕镜头) are rejected
 *   - realistic human faces are not supported
 */

import type {
  PromptTemplate,
  PromptValidation,
  SeedanceReference,
  Shot,
} from "./types";

export const SEEDANCE_LIMITS = {
  images: 9,
  videos: 3,
  audio: 3,
  totalFiles: 12,
  minDurationSec: 4,
  maxDurationSec: 15,
  imageMaxBytes: 30 * 1024 * 1024,
  videoMaxBytes: 50 * 1024 * 1024,
  audioMaxBytes: 15 * 1024 * 1024,
  videoMaxTotalSec: 15,
  minVideoSec: 2,
} as const;

/** Camera vocabulary from the skill, grouped so we can detect contradictions. */
export const CAMERA_TERMS = {
  push: ["推镜头", "慢推", "推进", "推近"],
  pull: ["拉镜头", "后拉", "拉远"],
  pan: ["左摇", "右摇", "摇镜"],
  tilt: ["上摇", "下摇"],
  follow: ["跟随镜头", "跟拍", "跟随"],
  orbit: ["环绕镜头", "环绕", "绕行"],
  static: ["固定镜头", "静止镜头", "镜头静止", "一镜到底"],
  handheld: ["希区柯克变焦", "鱼眼镜头", "快速摇镜", "机械臂跟随"],
  angle: ["低角度仰拍", "俯拍", "鸟瞰", "第一人称主观视角"],
} as const;

export const SHOT_SIZES = [
  "极致特写",
  "面部特写",
  "中近景",
  "中景",
  "全景",
  "远景",
  "建立镜头",
] as const;

export const STYLE_MODIFIERS = [
  "电影级质感",
  "胶片颗粒",
  "浅景深",
  "2.35:1宽银幕",
  "24fps",
  "黑白水墨风格",
  "动漫风格",
  "超写实",
  "高饱和霓虹色调",
  "冷暖对比",
  "超精细CG动画技术",
] as const;

export const MOOD_MODIFIERS = [
  "紧张悬疑",
  "温暖治愈",
  "史诗恢宏",
  "喜剧风格，表情夸张",
  "纪录片风格，旁白克制",
  "暗黑奇幻",
  "仙侠高燃",
] as const;

/** Detect a realistic human face reference — the skill forbids these. */
const FACE_PATTERNS = [
  /真人/,
  /写实人脸/,
  /真实人脸/,
  /人脸特写.*@图/,
  /写实.*脸部/,
  /realistic face/i,
];

/**
 * Detect conflicting camera directives. The skill explicitly calls this out
 * as mistake #2 ("指令冲突").
 */
export function detectCameraConflicts(text: string): string[] {
  const conflicts: string[] = [];
  const present = (group: keyof typeof CAMERA_TERMS) =>
    CAMERA_TERMS[group].some((term) => text.includes(term));

  if (present("static") && present("orbit")) {
    conflicts.push("固定镜头 与 环绕镜头 同时出现");
  }
  if (present("static") && present("follow")) {
    conflicts.push("固定镜头 与 跟随镜头 同时出现");
  }
  if (present("push") && present("pull")) {
    conflicts.push("推镜头 与 拉镜头 同时出现");
  }
  return conflicts;
}

/**
 * Parse the @slot references out of a prompt.
 *
 * The purpose is the phrase that follows the reference, up to the next
 * clause boundary. Conjunctions ("和", "与", "以及") end a purpose — "@图片1 和
 * @图片2" means the first slot has no stated purpose, and that has to be
 * reported rather than silently accepted.
 */
export function parseReferences(
  text: string,
): { slot: string; kind: "image" | "video" | "audio"; purpose: string | null }[] {
  const kindOf = (slot: string): "image" | "video" | "audio" => {
    if (slot.includes("视频")) return "video";
    if (slot.includes("音频") || slot.includes("音乐")) return "audio";
    return "image";
  };
  const re = /@(图片|图|视频|音频|音乐)\s*([0-9０-９]+)/g;
  const matches: {
    slot: string;
    kind: "image" | "video" | "audio";
    at: number;
    len: number;
  }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const num = m[2].replace(
      /[０-９]/g,
      (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0),
    );
    const slot = `${m[1]}${num}`;
    matches.push({ slot, kind: kindOf(slot), at: m.index, len: m[0].length });
  }

  const out: {
    slot: string;
    kind: "image" | "video" | "audio";
    purpose: string | null;
  }[] = [];
  for (const current of matches) {
    const after = text.slice(current.at + current.len, current.at + current.len + 60);
    const boundary = after.search(
      /[，,。.；;！!？?\n]|@|和|与|以及|还有|另(?:外|一)/,
    );
    const candidate = (boundary === -1 ? after : after.slice(0, boundary)).trim();
    const isPurpose =
      candidate.length >= 2 && !/^\d+(\s*秒)?$/.test(candidate);
    out.push({
      slot: current.slot,
      kind: current.kind,
      purpose: isPurpose ? candidate : null,
    });
  }
  return out;
}

/**
 * Validate a Seedance prompt against every hard rule in the skill.
 * Errors are things that will be rejected or produce garbage; warnings are
 * things that will merely reduce quality.
 */
export function validatePrompt(prompt: string): PromptValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const refs = parseReferences(prompt);
  const images = refs.filter((r) => r.kind === "image");
  const videos = refs.filter((r) => r.kind === "video");
  const audios = refs.filter((r) => r.kind === "audio");

  const uniqueSlots = new Set(refs.map((r) => r.slot));
  if (uniqueSlots.size !== refs.length) {
    errors.push("同一个 @素材 被引用了多次（例如 @图片1 出现两次），Seedance 只接受一次引用");
  }
  if (images.length > SEEDANCE_LIMITS.images) {
    errors.push(`图片素材 ${images.length} 张，超出上限 ${SEEDANCE_LIMITS.images} 张`);
  }
  if (videos.length > SEEDANCE_LIMITS.videos) {
    errors.push(`视频素材 ${videos.length} 个，超出上限 ${SEEDANCE_LIMITS.videos} 个`);
  }
  if (audios.length > SEEDANCE_LIMITS.audio) {
    errors.push(`音频素材 ${audios.length} 个，超出上限 ${SEEDANCE_LIMITS.audio} 个`);
  }
  const total = uniqueSlots.size;
  if (total > SEEDANCE_LIMITS.totalFiles) {
    errors.push(`总素材 ${total} 个，超出上限 ${SEEDANCE_LIMITS.totalFiles} 个`);
  }

  // Every referenced slot must say what it is for.
  for (const ref of refs) {
    if (!ref.purpose) {
      errors.push(`@${ref.slot} 没有说明用途，必须写成"@图片1 作为首帧"这样的形式`);
    }
  }

  // Duration.
  const duration = detectDuration(prompt);
  if (duration === null) {
    warnings.push("提示词里没有写明生成时长，建议明确写出「15秒」等");
  } else if (duration < SEEDANCE_LIMITS.minDurationSec || duration > SEEDANCE_LIMITS.maxDurationSec) {
    errors.push(
      `生成时长 ${duration} 秒超出允许范围 ${SEEDANCE_LIMITS.minDurationSec}–${SEEDANCE_LIMITS.maxDurationSec} 秒`,
    );
  }

  // Timeline segmentation for long prompts.
  const hasTimeline = /\d+\s*[-–—~到至]\s*\d+\s*秒/.test(prompt);
  if (duration !== null && duration > 8 && !hasTimeline) {
    warnings.push("超过 8 秒的提示词建议使用分时段描述（0-3秒：… / 3-6秒：…）");
  }
  if (duration !== null && duration <= 8 && hasTimeline) {
    warnings.push(`时长 ${duration} 秒较短，分时段描述会显得拥挤`);
  }

  // Camera conflicts.
  for (const conflict of detectCameraConflicts(prompt)) {
    errors.push(`指令冲突：${conflict}`);
  }

  // Audio design.
  const hasAudioDesign =
    /音效|背景音乐|BGM|旁白|声音|节奏|配音/.test(prompt);
  if (!hasAudioDesign) {
    warnings.push("缺少音频设计，建议补充「音效：脚步、风声」或「背景音乐：……」");
  }

  // Style.
  const hasStyle = STYLE_MODIFIERS.some((s) => prompt.includes(s));
  if (!hasStyle) {
    warnings.push("缺少画面风格修饰词（如「电影级质感，胶片颗粒，浅景深」）");
  }

  // Camera language present at all.
  const hasCamera = Object.values(CAMERA_TERMS).some((group) =>
    group.some((term) => prompt.includes(term)),
  );
  if (!hasCamera) {
    warnings.push("缺少运镜语言，建议明确推/拉/摇/跟随/环绕等镜头语言");
  }

  // Realistic faces.
  const hasRealFace = FACE_PATTERNS.some((p) => p.test(prompt));
  if (hasRealFace) {
    errors.push("Seedance 2.0 不支持写实真人脸部素材，提示词中出现了写实真人描述");
  }

  // Content overload: too many distinct beats in too short a window.
  const beats = (prompt.match(/秒[:：]/g) ?? []).length;
  if (duration !== null && duration > 0 && beats / duration > 0.6) {
    warnings.push(
      `${duration} 秒内塞了 ${beats} 个分镜节拍，内容可能过载，建议降低到每秒 0.5 个节拍以内`,
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    facts: {
      durationSec: duration,
      imageRefs: images.map((r) => r.slot),
      videoRefs: videos.map((r) => r.slot),
      audioRefs: audios.map((r) => r.slot),
      hasTimeline,
      hasCamera,
      hasAudioDesign,
      hasStyle,
      hasRealFace,
      wordCount: prompt.length,
    },
  };
}

/**
 * Read an explicit duration out of a prompt.
 *
 * The first match is not necessarily the duration: a segmented timeline
 * mentions many time bands ("0–3秒", "3–6秒"), and "0–3秒" would otherwise
 * be read as a 3-second generation. The *total* duration is the largest
 * band boundary, or the first standalone "N秒" that is not part of a range.
 */
export function detectDuration(prompt: string): number | null {
  // Every time band: "0–3秒", "3-6秒", "10~15秒".
  const bandRe = /(\d{1,3})\s*[-–—~～至到]\s*(\d{1,3})\s*秒/g;
  const bands: number[] = [];
  const bandSpans: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = bandRe.exec(prompt)) !== null) {
    bands.push(Number(m[1]), Number(m[2]));
    bandSpans.push([m.index, m.index + m[0].length]);
  }

  // Standalone durations — a "N秒" that is not part of a range. These are the
  // total length ("12秒画面", "共15秒").
  const standalone: number[] = [];
  const standaloneRe = /(\d{1,2})\s*秒/g;
  while ((m = standaloneRe.exec(prompt)) !== null) {
    const insideBand = bandSpans.some(
      ([start, end]) => m!.index >= start && m!.index < end,
    );
    if (insideBand) continue;
    standalone.push(Number(m[1]));
  }

  if (standalone.length > 0) return Math.max(...standalone);
  if (bands.length > 0) return Math.max(...bands);

  const en = prompt.match(/(\d{1,2})\s*s\b/i);
  if (en) return Number(en[1]);
  return null;
}

/** The structured inputs an assembler needs beyond the shot's own fields. */
export interface PromptAssemblyInput {
  shot: Shot;
  /** Explicit timeline segments; if absent and duration > 8s it is required. */
  segments?: { from: number; to: number; description: string }[];
  /** Camera language for the shot. */
  camera?: string;
  /** Audio / sound design line. */
  audio?: string;
  /** Style + mood suffix. */
  style?: string;
  /** Who is doing what, in prose. */
  subject?: string;
  /** Where the action happens, in prose. */
  scene?: string;
  /** What happens, in prose. */
  action?: string;
  /** Transition / effect notes. */
  transition?: string;
}

/** Assemble a full Seedance prompt from structured parts. */
export function assemblePrompt(input: PromptAssemblyInput): string {
  const { shot } = input;
  const duration = shot.durationSec ?? 10;
  const parts: string[] = [];

  // 1) Reference declarations with explicit purposes.
  const refs = shot.references ?? [];
  if (refs.length > 0) {
    const decls = refs.map((r) => {
      const purpose = r.purpose.trim();
      const note = r.note ? `（${r.note.trim()}）` : "";
      return `@${r.slot} ${purpose}${note}`;
    });
    parts.push(decls.join("，"));
  }

  // 2) Subject.
  if (input.subject) parts.push(input.subject);
  else if (shot.entityIds.length > 0) {
    parts.push(`镜头聚焦故事中的关键角色，${shot.title}`);
  }

  // 3) Scene.
  if (input.scene) parts.push(input.scene);

  // 4) Action.
  if (input.action) parts.push(input.action);
  else if (shot.excerpt) {
    const excerpt =
      shot.excerpt.length > 200 ? `${shot.excerpt.slice(0, 200)}…` : shot.excerpt;
    parts.push(excerpt);
  }

  // 5) Camera.
  if (input.camera) parts.push(input.camera);

  // 6) Timeline.
  const segments = input.segments ?? [];
  if (segments.length > 0) {
    const lines = segments.map(
      (s) => `${s.from}–${s.to}秒：${s.description}`,
    );
    parts.push(lines.join("，"));
  } else {
    parts.push(`${duration}秒画面。`);
  }

  // 7) Transition.
  if (input.transition) parts.push(input.transition);

  // 8) Audio.
  parts.push(input.audio ?? "音效：环境底噪与动作同步声，背景音乐：贴合情绪的弦乐");

  // 9) Style + mood.
  const style = input.style ?? shot.style ?? "电影级质感，胶片颗粒，浅景深";
  const mood = shot.mood ? `，${shot.mood}` : "";
  parts.push(`${style}${mood}`);

  return parts.filter(Boolean).join("，").replace(/，+/g, "，");
}

/** Prompt templates distilled from the skill's scenario catalogue. */
export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: "character-consistency",
    title: "Character consistency",
    scenario: "人物一致性",
    description:
      "用一个参考图锚定人物形象，在多个动作之间保持同一张脸与同一套服装。",
    durationSec: 10,
    segmented: true,
    skeleton:
      "@图片1 的人物作为主体，{动作}。0-3秒：{开场}，3-6秒：{发展}，6-10秒：{收束}。运镜：{运镜}。音效：{音效}。{风格}",
    slots: [{ slot: "图片1", kind: "image", purpose: "作为人物形象参考" }],
  },
  {
    id: "camera-replication",
    title: "Camera replication",
    scenario: "运镜复刻",
    description: "以参考视频的运镜、动作编排与转场为骨架，换成自己的主体与场景。",
    durationSec: 15,
    segmented: true,
    skeleton:
      "@图片1 的人物在 @图片2 的场景中，完全参考 @视频1 的运镜效果与动作编排。0-5秒：{开场}，5-10秒：{发展}，10-15秒：{收束}。音效参考 @视频1 的声音。{风格}",
    slots: [
      { slot: "图片1", kind: "image", purpose: "作为人物形象参考" },
      { slot: "图片2", kind: "image", purpose: "场景参考" },
      { slot: "视频1", kind: "video", purpose: "运镜与动作编排参考" },
    ],
  },
  {
    id: "story-shot",
    title: "Story beat",
    scenario: "剧情分镜",
    description:
      "把小说里的一个情节点拆成分时段镜头，适合做漫画/短剧演绎的第一镜。",
    durationSec: 15,
    segmented: true,
    skeleton:
      "画面（0-5秒）：{开场画面与运镜}。画面（5-10秒）：{发展与情绪}。画面（10-15秒）：{收束与定格}。音效：{音效设计}。{风格}",
    slots: [],
  },
  {
    id: "comic-deduction",
    title: "Comic panel deduction",
    scenario: "漫改演绎",
    description: "按漫画分镜顺序演绎，保留台词并加入特殊音效。",
    durationSec: 15,
    segmented: true,
    skeleton:
      "将 @图片1 以从左到右从上到下的顺序进行漫画演绎，15秒画面，保持人物说的台词与图片上的一致，分镜切换以及重点的情节演绎加入特殊音效，整体风格诙谐幽默。{风格}",
    slots: [{ slot: "图片1", kind: "image", purpose: "作为漫画分镜参考" }],
  },
  {
    id: "product-showcase",
    title: "Artifact showcase",
    scenario: "物件展示",
    description: "把小说里的关键道具做成 360 度展示与拆解镜头。",
    durationSec: 15,
    segmented: true,
    skeleton:
      "将 @图片1 的道具进行拆解，15秒画面，镜头保持静止，360度高速旋转2圈后定格，素材悬浮在空中缓慢分离再重新组合，材质细节清晰可见，3D渲染展示特效。{风格}",
    slots: [{ slot: "图片1", kind: "image", purpose: "作为道具外观参考" }],
  },
  {
    id: "scene-establish",
    title: "Scene establishing",
    scenario: "场景建立",
    description: "只画环境没有人，用一镜到底扫过整片场景，建立世界感。",
    durationSec: 15,
    segmented: true,
    skeleton:
      "@图片1 的场景，15秒画面，一镜到底的追踪镜头，{路线描述}，最终俯瞰全貌。全程不要切镜头。音效：{环境音}。{风格}",
    slots: [{ slot: "图片1", kind: "image", purpose: "场景参考" }],
  },
  {
    id: "emotion-portrait",
    title: "Emotion portrait",
    scenario: "情绪特写",
    description: "用一个镜头把角色的情绪推到极致，适合作为人物立绘的动态版。",
    durationSec: 8,
    segmented: false,
    skeleton:
      "{人物}面部特写，{情绪变化过程}，8秒画面，镜头从面部缓慢推进到眼睛特写，背景虚化。音效：{呼吸声与环境音}。{风格}",
    slots: [],
  },
  {
    id: "music-beat",
    title: "Music beat montage",
    scenario: "音乐卡点",
    description: "多张画面按音乐节拍卡点剪接，适合章节回顾或预告。",
    durationSec: 15,
    segmented: true,
    skeleton:
      "@图片1 @图片2 @图片3 @图片4 的画面根据 @音频1 的节奏卡点，15秒画面，风格统一且富有动感，张力随音乐推进而增强，可自行改变参考图的景别并补充光影变化。{风格}",
    slots: [
      { slot: "图片1", kind: "image", purpose: "作为画面主体" },
      { slot: "图片2", kind: "image", purpose: "作为画面主体" },
      { slot: "图片3", kind: "image", purpose: "作为画面主体" },
      { slot: "图片4", kind: "image", purpose: "作为画面主体" },
      { slot: "音频1", kind: "audio", purpose: "作为卡点节奏与背景音乐参考" },
    ],
  },
];

/** Find a template by id. */
export function findTemplate(id: string): PromptTemplate | undefined {
  return PROMPT_TEMPLATES.find((t) => t.id === id);
}

/**
 * Suggest the next free slot name for a kind of reference.
 * `图片3` -> next image index, etc.
 */
export function nextSlot(
  references: SeedanceReference[],
  kind: SeedanceReference["kind"],
): string {
  const prefix = kind === "image" ? "图片" : kind === "video" ? "视频" : "音频";
  const used = new Set(
    references
      .filter((r) => r.kind === kind)
      .map((r) => Number(r.slot.replace(/[^0-9]/g, "")) || 0),
  );
  let i = 1;
  while (used.has(i)) i += 1;
  return `${prefix}${i}`;
}
