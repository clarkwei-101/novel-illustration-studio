import { NextResponse } from "next/server";
import { loadTaxonomy, saveTaxonomy } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/novels/:id/taxonomy — the taxonomy in force for this novel. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return NextResponse.json(await loadTaxonomy(id));
}

/**
 * PUT /api/novels/:id/taxonomy — extend the taxonomy for this novel.
 *
 * Body: { extra: { "<category>": [{ key, label }] } }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as {
      extra?: Record<string, { key: string; label: string }[]>;
    };
    if (!body.extra || typeof body.extra !== "object") {
      return NextResponse.json(
        { error: "Body must be { extra: { <category>: [{ key, label }] } }" },
        { status: 400 },
      );
    }
    const taxonomy = await saveTaxonomy(id, body.extra);
    return NextResponse.json(taxonomy);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the taxonomy" },
      { status: 500 },
    );
  }
}
