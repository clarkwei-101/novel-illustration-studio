import { NextResponse } from "next/server";
import { ingestNovel, listNovels } from "@/lib/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 30 * 1024 * 1024;

/** GET /api/novels — list every ingested novel. */
export async function GET() {
  try {
    const novels = await listNovels();
    return NextResponse.json({ novels });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list novels" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/novels — upload a novel file.
 *
 * Accepts multipart/form-data with a `file` field and an optional `title`.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Expected multipart/form-data with a `file` field" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB` },
        { status: 413 },
      );
    }
    const title = form.get("title");
    const bytes = Buffer.from(await file.arrayBuffer());
    const record = await ingestNovel(
      file.name,
      bytes,
      typeof title === "string" && title.trim() ? title : undefined,
    );
    return NextResponse.json(
      {
        novel: record.novel,
        stats: record.analysis.stats,
        chapters: record.chapters.map((c) => ({
          index: c.index,
          title: c.title,
          length: c.length,
          preview: c.preview,
        })),
      },
      { status: 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to ingest the novel" },
      { status: 500 },
    );
  }
}
