import { NextResponse } from "next/server";
import { defaultTaxonomy } from "@/lib/taxonomy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/taxonomy — the built-in category / subcategory tree. */
export async function GET() {
  return NextResponse.json(defaultTaxonomy());
}
