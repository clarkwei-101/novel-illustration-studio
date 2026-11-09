import { NextResponse } from "next/server";
import { deleteNovel, getNovel } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/novels/:id — remove a novel and all of its data. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const removed = await deleteNovel(id);
  if (!removed) {
    return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}

/** GET /api/novels/:id/chapters/:index — one chapter's full text. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; index: string }> },
) {
  const { id, index } = await params;
  const record = await getNovel(id);
  if (!record) {
    return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
  }
  const chapterIndex = Number(index);
  const chapter = record.chapters[chapterIndex];
  if (!chapter) {
    return NextResponse.json(
      { error: `Chapter ${index} does not exist (novel has ${record.chapters.length})` },
      { status: 404 },
    );
  }
  return NextResponse.json({
    index: chapter.index,
    title: chapter.title,
    length: chapter.length,
    text: record.text.slice(chapter.start, chapter.end),
  });
}
