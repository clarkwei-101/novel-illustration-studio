import { NextResponse } from "next/server";
import { getNovel } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/novels/:id/search?q=… — find passages across the novel.
 *
 * Returns the matching sentences with their chapter index, so an agent can
 * locate a quote and then pull the full chapter for context.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (!query) {
    return NextResponse.json({ error: "Missing ?q= query" }, { status: 400 });
  }
  const limit = Math.min(50, Number(url.searchParams.get("limit") ?? "12"));

  const record = await getNovel(id);
  if (!record) {
    return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
  }

  const sentences = record.text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;""'])\s*/))
    .map((s) => s.trim())
    .filter(Boolean);

  const needle = query.toLowerCase();
  const hits: { chapterIndex: number; chapterTitle: string; sentence: string }[] = [];
  for (const sentence of sentences) {
    if (!sentence.toLowerCase().includes(needle)) continue;
    // Locate the chapter this sentence belongs to by offset.
    const offset = record.text.indexOf(sentence.slice(0, 40));
    let chapterIndex = 0;
    for (const chapter of record.chapters) {
      if (offset >= chapter.start) chapterIndex = chapter.index;
    }
    hits.push({
      chapterIndex,
      chapterTitle: record.chapters[chapterIndex]?.title ?? "",
      sentence: sentence.length > 400 ? `${sentence.slice(0, 400)}…` : sentence,
    });
    if (hits.length >= limit) break;
  }

  return NextResponse.json({ query, count: hits.length, hits });
}
