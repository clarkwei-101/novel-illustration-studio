import { NextResponse } from "next/server";
import { getNovel, upsertShot } from "@/lib/repository";
import { buildShotPrompt } from "@/lib/repository";
import type { Shot } from "@/lib/types";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/novels/:id/shots — list the storyboard shots. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const record = await getNovel(id);
  if (!record) {
    return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
  }
  return NextResponse.json({ shots: record.shots });
}

/**
 * POST /api/novels/:id/shots — create (or replace) a shot.
 *
 * If `prompt` is absent, one is assembled from the structured fields and
 * validated against the Seedance rules; the validation result is stored
 * alongside the shot.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as Partial<Shot> & {
      parts?: Omit<Parameters<typeof buildShotPrompt>[1], never>;
      prompt?: string;
    };

    const record = await getNovel(id);
    if (!record) {
      return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
    }

    const index = body.index ?? record.shots.length;
    const shot: Shot = {
      id: body.id ?? `shot-${randomUUID().slice(0, 8)}`,
      novelId: id,
      index,
      title: body.title ?? `Shot ${index + 1}`,
      chapterIndex: body.chapterIndex ?? 0,
      excerpt: body.excerpt ?? "",
      entityIds: body.entityIds ?? [],
      sceneId: body.sceneId,
      mood: body.mood,
      style: body.style,
      durationSec: body.durationSec ?? 10,
      notes: body.notes,
      references: body.references ?? [],
      prompt: body.prompt,
      validation: body.validation,
      agentReviewed: body.agentReviewed,
    };

    if (!shot.prompt) {
      const built = buildShotPrompt(shot, body.parts);
      shot.prompt = built.prompt;
      shot.validation = built.validation;
    }

    const saved = await upsertShot(id, shot);
    if (!saved) {
      return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
    }
    return NextResponse.json(saved.shot, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save the shot" },
      { status: 500 },
    );
  }
}
