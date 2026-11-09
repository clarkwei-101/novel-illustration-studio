import { NextResponse } from "next/server";
import { validatePrompt } from "@/lib/seedance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/prompts/validate — check a Seedance prompt without storing it.
 *
 * Body: { prompt: string }
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { prompt?: string };
    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      return NextResponse.json(
        { error: "Body must be { prompt: string }" },
        { status: 400 },
      );
    }
    return NextResponse.json(validatePrompt(body.prompt));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to validate the prompt" },
      { status: 500 },
    );
  }
}
