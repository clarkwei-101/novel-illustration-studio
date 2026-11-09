import { NextResponse } from "next/server";
import { getNovel, upsertShot } from "@/lib/repository";
import { validatePrompt } from "@/lib/seedance";
import type { Shot } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/novels/:id/shots/:shotId/prompt — (re)generate and validate.
 *
 * Body (all optional): { prompt?, parts? }
 * `parts` carries the structured inputs the assembler needs: segments,
 * camera, audio, style, subject, scene, action, transition.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> },
) {
  const { id, shotId } = await params;
  try {
    const record = await getNovel(id);
    if (!record) {
      return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
    }
    const existing = record.shots.find((s) => s.id === shotId);
    if (!existing) {
      return NextResponse.json(
        { error: `No shot ${shotId} in novel ${id}` },
        { status: 404 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      prompt?: string;
      parts?: Parameters<typeof import("@/lib/repository").buildShotPrompt>[1];
      durationSec?: number;
    };

    const shot: Shot = {
      ...existing,
      durationSec: body.durationSec ?? existing.durationSec,
    };

    if (body.prompt) {
      shot.prompt = body.prompt;
      shot.validation = validatePrompt(body.prompt);
    } else {
      const { buildShotPrompt } = await import("@/lib/repository");
      const built = buildShotPrompt(shot, body.parts);
      shot.prompt = built.prompt;
      shot.validation = built.validation;
    }

    const saved = await upsertShot(id, shot);
    return NextResponse.json(saved?.shot ?? shot);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build the prompt" },
      { status: 500 },
    );
  }
}

/** GET /api/novels/:id/shots/:shotId/prompt — read the stored prompt. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; shotId: string }> },
) {
  const { id, shotId } = await params;
  const record = await getNovel(id);
  if (!record) {
    return NextResponse.json({ error: `No novel with id ${id}` }, { status: 404 });
  }
  const shot = record.shots.find((s) => s.id === shotId);
  if (!shot) {
    return NextResponse.json({ error: `No shot ${shotId} in novel ${id}` }, { status: 404 });
  }
  return NextResponse.json({
    id: shot.id,
    title: shot.title,
    prompt: shot.prompt,
    validation: shot.validation,
  });
}
