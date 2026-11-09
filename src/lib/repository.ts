/**
 * Repository layer: novels, analyses, shots and taxonomies on top of storage.
 */

import { randomUUID } from "node:crypto";
import { getStorage } from "./storage";
import { analyze } from "./analyze";
import { extractText } from "./parse";
import { segmentChapters, detectLanguage } from "./segment";
import { defaultTaxonomy, subcategoryIndex } from "./taxonomy";
import { assemblePrompt, validatePrompt, PROMPT_TEMPLATES } from "./seedance";
import type {
  Analysis,
  Entity,
  Novel,
  PromptTemplate,
  Scene,
  Shot,
  Taxonomy,
} from "./types";

const NOVELS_INDEX = "novels/index.json";
const NOVEL_PREFIX = "novels/data/";

/** A stored novel plus its parsed content. */
export interface NovelRecord {
  novel: Novel;
  text: string;
  chapters: ReturnType<typeof segmentChapters>;
  analysis: Analysis;
  shots: Shot[];
}

/** List all novels, newest first. */
export async function listNovels(): Promise<Novel[]> {
  const storage = await getStorage();
  const raw = await storage.read(NOVELS_INDEX);
  if (!raw) return [];
  try {
    const items = JSON.parse(raw) as Novel[];
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}

async function writeIndex(novels: Novel[]): Promise<void> {
  const storage = await getStorage();
  await storage.write(NOVELS_INDEX, JSON.stringify(novels, null, 2));
}

/**
 * Serialise index mutations inside this process.
 *
 * The index is a read-modify-write on a single blob: read it, add the new
 * entry, write it back. Two concurrent uploads would each read the same base
 * and the second write would erase the first one's entry. The lock makes the
 * whole read-modify-write cycle atomic within an instance.
 */
let indexChain: Promise<unknown> = Promise.resolve();

function withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = indexChain.then(fn, fn);
  // Keep the chain alive even when a caller's promise rejects.
  indexChain = run.catch(() => undefined);
  return run;
}

/** Load one novel record. */
export async function getNovel(id: string): Promise<NovelRecord | null> {
  const storage = await getStorage();
  const raw = await storage.read(`${NOVEL_PREFIX}${id}.json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NovelRecord;
  } catch {
    return null;
  }
}

/** Persist a novel record and refresh the index. */
export async function saveNovel(record: NovelRecord): Promise<void> {
  const storage = await getStorage();
  await storage.write(`${NOVEL_PREFIX}${record.novel.id}.json`, JSON.stringify(record));
  await withIndexLock(async () => {
    const novels = await listNovels();
    const next = novels.filter((n) => n.id !== record.novel.id);
    next.push(record.novel);
    await writeIndex(next);
  });
}

/** Delete a novel and its record. */
export async function deleteNovel(id: string): Promise<boolean> {
  const storage = await getStorage();
  const existing = await storage.read(`${NOVEL_PREFIX}${id}.json`);
  if (!existing) return false;
  await storage.remove(`${NOVEL_PREFIX}${id}.json`);
  await withIndexLock(async () => {
    const novels = (await listNovels()).filter((n) => n.id !== id);
    await writeIndex(novels);
  });
  return true;
}

/**
 * Ingest an uploaded file: parse, segment, analyse, and store.
 */
export async function ingestNovel(
  filename: string,
  bytes: Buffer,
  title?: string,
): Promise<NovelRecord> {
  const extracted = await extractText(filename, bytes);
  const text = extracted.text.trim();
  if (!text) {
    throw new Error(
      "Could not extract any text from the uploaded file. If it is a scanned PDF, it needs OCR first.",
    );
  }

  const chapters = segmentChapters(text);
  const taxonomy = defaultTaxonomy();
  const analysis = analyze("pending", text, taxonomy);

  const id = randomUUID();
  const novel: Novel = {
    id,
    title: title?.trim() || extracted.title || filename.replace(/\.[^.]+$/, ""),
    filename,
    format: extracted.format,
    bytes: bytes.length,
    chars: text.length,
    chapters: chapters.length,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    analysisVersion: 1,
    synopsis: analysis.scenes[0]?.summary ?? chapters[0]?.preview?.slice(0, 140) ?? "",
    language: detectLanguage(text),
  };

  const record: NovelRecord = {
    novel,
    text,
    chapters,
    analysis: { ...analysis, novelId: id },
    shots: [],
  };
  await saveNovel(record);
  return record;
}

/** Replace the agent-authored parts of an analysis. */
export async function applyAgentAnalysis(
  id: string,
  update: {
    entities?: Entity[];
    scenes?: Scene[];
    relationships?: Analysis["relationships"];
    keywords?: Analysis["keywords"];
  },
): Promise<NovelRecord | null> {
  const record = await getNovel(id);
  if (!record) return null;
  if (update.entities) record.analysis.entities = update.entities;
  if (update.scenes) record.analysis.scenes = update.scenes;
  if (update.relationships) record.analysis.relationships = update.relationships;
  if (update.keywords) record.analysis.keywords = update.keywords;
  record.analysis.stats = {
    characters: record.analysis.entities.filter((e) => e.category === "character").length,
    scenes: record.analysis.scenes.length,
    relationships: record.analysis.relationships.length,
    chapters: record.chapters.length,
    totalChars: record.analysis.stats.totalChars,
  };
  record.novel.analysisVersion += 1;
  record.novel.updatedAt = new Date().toISOString();
  await saveNovel(record);
  return record;
}

/** Store a per-novel taxonomy refinement. */
export async function saveTaxonomy(
  id: string,
  extra: Record<string, { key: string; label: string }[]>,
): Promise<Taxonomy | null> {
  const storage = await getStorage();
  const taxonomy = defaultTaxonomy();
  taxonomy.extra = extra;
  await storage.write(`novels/taxonomy/${id}.json`, JSON.stringify(taxonomy, null, 2));
  return taxonomy;
}

/** Load a per-novel taxonomy, falling back to the built-in one. */
export async function loadTaxonomy(id: string): Promise<Taxonomy> {
  const storage = await getStorage();
  const raw = await storage.read(`novels/taxonomy/${id}.json`);
  if (!raw) return defaultTaxonomy();
  try {
    return JSON.parse(raw) as Taxonomy;
  } catch {
    return defaultTaxonomy();
  }
}

/** Validate an entity against the taxonomy — returns error strings. */
export function validateEntity(entity: Entity, taxonomy: Taxonomy): string[] {
  const index = subcategoryIndex(taxonomy);
  const errors: string[] = [];
  if (!entity.name?.trim()) errors.push("entity.name is required");
  if (!entity.category) errors.push("entity.category is required");
  const meta = index.get(entity.subcategory);
  if (!meta) {
    errors.push(
      `unknown subcategory "${entity.subcategory}" — it must exist in the taxonomy (see GET /api/taxonomy)`,
    );
  } else if (meta.category !== entity.category) {
    errors.push(
      `subcategory "${entity.subcategory}" belongs to category "${meta.category}" but the entity is filed under "${entity.category}"`,
    );
  }
  return errors;
}

/** Add or replace a shot. */
export async function upsertShot(
  novelId: string,
  shot: Shot,
): Promise<{ record: NovelRecord; shot: Shot } | null> {
  const record = await getNovel(novelId);
  if (!record) return null;

  const index = record.shots.findIndex((s) => s.id === shot.id);
  if (index >= 0) record.shots[index] = shot;
  else record.shots.push(shot);
  record.shots.sort((a, b) => a.index - b.index);
  record.novel.updatedAt = new Date().toISOString();
  await saveNovel(record);
  return { record, shot };
}

/** Generate (or regenerate) the prompt for a shot and validate it. */
export function buildShotPrompt(
  shot: Shot,
  parts?: Omit<Parameters<typeof assemblePrompt>[0], "shot">,
): { prompt: string; validation: ReturnType<typeof validatePrompt> } {
  const prompt = assemblePrompt({ ...(parts ?? {}), shot } as Parameters<
    typeof assemblePrompt
  >[0]);
  return { prompt, validation: validatePrompt(prompt) };
}

/** All templates available to agents. */
export function listTemplates(): PromptTemplate[] {
  return PROMPT_TEMPLATES;
}
