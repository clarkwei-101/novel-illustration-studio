import { NextResponse } from "next/server";
import { listTemplates } from "@/lib/repository";
import { SEEDANCE_LIMITS } from "@/lib/seedance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/templates — the Seedance prompt templates distilled from the
 * seedance-prompt-zh skill, plus the hard limits the validator enforces.
 */
export async function GET() {
  return NextResponse.json({
    templates: listTemplates(),
    limits: SEEDANCE_LIMITS,
  });
}
