import { NextResponse } from "next/server";
import {
  applyAgentAnalysis,
  getNovel,
  loadTaxonomy,
  validateEntity,
} from "@/lib/repository";
import type { Analysis, Entity, Scene } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/novels/:id/analysis — the deterministic analysis. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getNovel(id);
  if (!record) {
    return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
  }
  return NextResponse.json(record.analysis);
}

/**
 * PUT /api/novels/:id/analysis — post back the agent's refined analysis.
 *
 * Body: { entities?, scenes?, relationships?, keywords? }
 * Every entity is validated against the taxonomy before it is stored.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as {
      entities?: Entity[];
      scenes?: Scene[];
      relationships?: Analysis["relationships"];
      keywords?: Analysis["keywords"];
    };

    const record = await getNovel(id);
    if (!record) {
      return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
    }
    const taxonomy = await loadTaxonomy(id);

    const errors: { entity: string; errors: string[] }[] = [];
    if (body.entities) {
      for (const entity of body.entities) {
        const problems = validateEntity(entity, taxonomy);
        if (problems.length > 0) {
          errors.push({ entity: entity.name, errors: problems });
        }
      }
    }
    if (errors.length > 0) {
      return NextResponse.json(
        { error: "Some entities failed taxonomy validation", details: errors },
        { status: 422 },
      );
    }

    const updated = await applyAgentAnalysis(id, body);
    if (!updated) {
      return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
    }
    return NextResponse.json(updated.analysis);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the analysis" },
      { status: 500 },
    );
  }
}
