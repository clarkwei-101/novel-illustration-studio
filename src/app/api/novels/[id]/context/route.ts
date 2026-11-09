import { NextResponse } from "next/server";
import { getNovel } from "@/lib/repository";
import { SEEDANCE_LIMITS } from "@/lib/seedance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/novels/:id/context — the working material an AI agent needs.
 *
 * This is the payload an agent reads before doing the semantic pass: the
 * chapter list with previews, the deterministic candidates with their
 * evidence, the relationship graph and the scene index. It is deliberately
 * *not* the raw text — the agent pulls the specific chapters it needs with
 * GET /api/novels/:id/chapters/:index.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getNovel(id);
  if (!record) {
    return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
  }

  const url = new URL(request.url);
  const maxEvidence = Number(url.searchParams.get("evidence") ?? "3");
  const entityLimit = Number(url.searchParams.get("entities") ?? "40");

  const entities = record.analysis.entities.slice(0, entityLimit).map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    subcategory: e.subcategory,
    mentions: e.mentions,
    chapterSpread: e.chapterSpread,
    summary: e.summary,
    evidence: e.evidence.slice(0, maxEvidence),
    attributes: e.attributes,
    agentReviewed: e.agentReviewed ?? false,
  }));

  return NextResponse.json({
    novel: record.novel,
    chapters: record.chapters.map((c) => ({
      index: c.index,
      title: c.title,
      length: c.length,
      preview: c.preview,
    })),
    entities,
    scenes: record.analysis.scenes.map((s) => ({
      id: s.id,
      title: s.title,
      subcategory: s.subcategory,
      chapters: s.chapters,
      mentions: s.mentions,
      summary: s.summary,
    })),
    relationships: record.analysis.relationships.slice(0, 120).map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      targetId: r.targetId,
      weight: r.weight,
      kinds: r.kinds,
      evidence: r.evidence.slice(0, 2),
    })),
    keywords: record.analysis.keywords.slice(0, 30),
    shots: record.shots,
    seedanceLimits: SEEDANCE_LIMITS,
    instructions: {
      chapterText:
        "GET /api/novels/{id}/chapters/{index} returns the full text of one chapter.",
      refineAnalysis:
        "PUT /api/novels/{id}/analysis with { entities, scenes, relationships, keywords } — every entity must use a subcategory that exists in GET /api/novels/{id}/taxonomy.",
      buildShots:
        "POST /api/novels/{id}/shots with a shot object; if `prompt` is omitted the server assembles one from the structured fields and validates it against the Seedance rules.",
      validateOnly:
        "POST /api/prompts/validate with { prompt } checks a prompt without storing anything.",
    },
  });
}
