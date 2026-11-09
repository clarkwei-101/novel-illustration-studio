import { NextResponse } from "next/server";
import { getNovel } from "@/lib/repository";

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
