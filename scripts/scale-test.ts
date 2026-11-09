/**
 * Scale test: run the real analysis pipeline over a large Chinese corpus.
 *
 * Why this exists: the unit suite uses a ~700 character sample. The
 * relationship graph is built from co-occurrence, and co-occurrence is the
 * classic place where a naive implementation turns O(n^2) and a long book
 * takes minutes instead of seconds. This script measures the real thing.
 *
 * Usage: tsx scripts/scale-test.ts [path-to-corpus]
 */

import { readFile } from "node:fs/promises";
import { segmentChapters } from "../src/lib/segment";
import { analyze } from "../src/lib/analyze";
import { defaultTaxonomy } from "../src/lib/taxonomy";
import { toSimplified } from "../src/lib/chinese";
import { assemblePrompt, validatePrompt } from "../src/lib/seedance";
import type { Shot } from "../src/lib/types";

const DEFAULT_CORPUS =
  "/Users/yahweh/Desktop/ai应用社/dse-rag-kb/vault/02_DSE/中國歷史/2013/answer_ans.md";

async function main(): Promise<void> {
  const corpusPath = process.argv[2] ?? DEFAULT_CORPUS;
  const raw = await readFile(corpusPath, "utf8");
  // Mirror the real ingest path: normalise traditional → simplified first.
  const text = toSimplified(raw.trim());

  console.log(`corpus: ${corpusPath}`);
  console.log(`chars:  ${text.length.toLocaleString()}`);
  console.log(`lines:  ${text.split("\n").length.toLocaleString()}\n`);

  const taxonomy = defaultTaxonomy();

  // ── segmentation ────────────────────────────────────────────────────────
  let t = Date.now();
  const chapters = segmentChapters(text);
  const segMs = Date.now() - t;
  console.log(`segment: ${segMs} ms → ${chapters.length} chapters`);
  for (const c of chapters.slice(0, 5)) {
    console.log(`   · ${c.title} (${c.length} chars)`);
  }
  if (chapters.length > 5) console.log(`   … ${chapters.length - 5} more`);

  // ── analysis ────────────────────────────────────────────────────────────
  t = Date.now();
  const analysis = analyze("scale-test", text, taxonomy);
  const anaMs = Date.now() - t;
  console.log(`\nanalyze: ${anaMs} ms`);

  const chars = analysis.entities.filter((e) => e.category === "character");
  const scenes = analysis.scenes;
  console.log(`   entities:        ${analysis.entities.length}`);
  console.log(`   characters:      ${chars.length}`);
  console.log(`   scenes:          ${scenes.length}`);
  console.log(`   relationships:   ${analysis.relationships.length}`);
  console.log(`   keywords:        ${analysis.keywords.length}`);

  console.log(`\ntop characters:`);
  for (const c of chars.slice(0, 10)) {
    console.log(`   ${c.name} — mentions ${c.mentions} [${c.subcategory}]`);
  }

  console.log(`\ntop keywords:`);
  for (const k of analysis.keywords.slice(0, 12)) {
    console.log(`   ${k.term} (${k.count}) [${k.category}]`);
  }

  console.log(`\ntop relationships:`);
  const byId = new Map(analysis.entities.map((e) => [e.id, e.name]));
  for (const r of analysis.relationships.slice(0, 8)) {
    const src = byId.get(r.sourceId) ?? r.sourceId;
    const dst = byId.get(r.targetId) ?? r.targetId;
    console.log(`   ${src} ↔ ${dst} — ${r.weight} (${r.kinds.join("/")})`);
  }

  // ── prompt assembly over the real corpus ────────────────────────────────
  const shot: Shot = {
    id: "scale",
    novelId: "scale-test",
    index: 0,
    title: "Scale test shot",
    chapterIndex: 0,
    excerpt: scenes[0]?.summary ?? chapters[0]?.preview?.slice(0, 200) ?? "",
    entityIds: chars.slice(0, 1).map((c) => c.id),
    durationSec: 8,
  };

  t = Date.now();
  const prompt = assemblePrompt({
    shot,
    subject: chars[0] ? `镜头聚焦${chars[0].name}` : undefined,
    scene: scenes[0]?.summary,
    action: shot.excerpt,
    camera: "缓慢推进，中景",
    audio: "环境音：雨声",
    style: "电影级质感",
    segments: [
      { from: 0, to: 4, description: "建立环境" },
      { from: 4, to: 8, description: "人物入画" },
    ],
  });
  const val = validatePrompt(prompt);
  console.log(`\nprompt:   ${Date.now() - t} ms, ${prompt.length} chars, valid=${val.ok}`);
  if (val.errors.length) console.log(`   errors:  ${val.errors.join("; ")}`);
  if (val.warnings.length) console.log(`   warnings: ${val.warnings.join("; ")}`);

  // ── verdict ─────────────────────────────────────────────────────────────
  const perChar = anaMs / Math.max(1, text.length);
  console.log(
    `\nthroughput: ${perChar.toFixed(4)} ms/char → ${(text.length / anaMs * 1000).toFixed(0)} chars/s`,
  );
  const budget = 200_000; // a full-length Chinese novel is roughly 100k-200k chars
  console.log(
    `a ${budget.toLocaleString()}-char novel would analyze in ~${((perChar * budget) / 1000).toFixed(1)} s`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
