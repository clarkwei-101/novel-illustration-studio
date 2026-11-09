import { NextResponse } from "next/server";
import { getNovel, deleteNovel } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/novels/:id — the full record: metadata, chapters, analysis, shots.
 * Pass `?includeText=1` to also get the raw extracted text (large).
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
  const includeText = url.searchParams.get("includeText") === "1";
  const includeChapters = url.searchParams.get("includeChapters") !== "0";

  return NextResponse.json({
    novel: record.novel,
    stats: record.analysis.stats,
    analysis: record.analysis,
    shots: record.shots,
    chapters: includeChapters
      ? record.chapters.map((c) => ({
          index: c.index,
          title: c.title,
          length: c.length,
          preview: c.preview,
        }))
      : undefined,
    text: includeText ? record.text : undefined,
  });
}

/**
 * DELETE /api/novels/:id — remove a novel and every shot attached to it.
 *
 * The library is a working surface, not a write-once log: an agent that
 * mis-parses a book has to be able to throw the record away and re-ingest
 * the file. Without this the store only ever grows.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const removed = await deleteNovel(id);
    if (!removed) {
      return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
    }
    return NextResponse.json({ deleted: id });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete the novel" },
      { status: 500 },
    );
  }
}
