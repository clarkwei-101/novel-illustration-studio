import { Buffer } from "node:buffer";

/**
 * Format detection + text extraction. Everything is normalised to a single
 * plain-text string; chapter segmentation happens in `segment.ts`.
 */

export type SourceFormat = "txt" | "pdf" | "docx" | "epub" | "md";

export interface ExtractedDoc {
  text: string;
  format: SourceFormat;
  /** Best-effort title taken from document metadata or the first heading. */
  title?: string;
}

const EXT_MAP: Record<string, SourceFormat> = {
  txt: "txt",
  text: "txt",
  md: "md",
  markdown: "md",
  pdf: "pdf",
  docx: "docx",
  epub: "epub",
};

/** Detect the format from a filename plus magic bytes. */
export function detectFormat(filename: string, bytes: Buffer): SourceFormat {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const byExt = EXT_MAP[ext];
  if (bytes.length >= 4) {
    if (bytes.subarray(0, 4).toString("hex") === "504b0304") return "epub";
    if (bytes.subarray(0, 5).toString("hex") === "25504446") return "pdf"; // %PDF-
    if (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes.subarray(0, 2).toString("hex") === "504b"
    ) {
      return "docx";
    }
  }
  if (byExt) return byExt;
  return "txt";
}

/** Strip a UTF-8/UTF-16 BOM and normalise line endings. */
function normalise(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

/**
 * Decode a text buffer, guessing the encoding. Chinese novels are frequently
 * GBK/GB18030, which `TextDecoder` handles when labelled correctly.
 */
export function decodeText(bytes: Buffer): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return normalise(new TextDecoder("utf-8").decode(bytes.subarray(3)));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return normalise(new TextDecoder("utf-16le").decode(bytes.subarray(2)));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return normalise(new TextDecoder("utf-16be").decode(bytes.subarray(2)));
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // If UTF-8 decoding produced replacement characters, the source is almost
  // certainly a legacy Chinese encoding.
  const replacements = (utf8.match(/\uFFFD/g) ?? []).length;
  if (replacements > 0) {
    for (const label of ["gb18030", "gbk", "big5"]) {
      try {
        const decoded = new TextDecoder(label, { fatal: false }).decode(bytes);
        if ((decoded.match(/\uFFFD/g) ?? []).length < replacements) {
          return normalise(decoded);
        }
      } catch {
        // unsupported label in this runtime  try the next one
      }
    }
  }
  return normalise(utf8);
}

/** Extract plain text from an EPUB by walking its OPF spine. */
async function extractEpub(bytes: Buffer): Promise<ExtractedDoc> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const readText = async (path: string): Promise<string> => {
    const file = zip.file(path);
    if (!file) return "";
    return file.async("string");
  };

  const container = await readText("META-INF/container.xml");
  const opfPath = container.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error("EPUB is missing META-INF/container.xml");
  const opf = await readText(opfPath);
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const manifest = new Map<string, { href: string; media: string }>();
  const manifestRe = /<item\b[^>]*>/g;
  for (const tag of opf.match(manifestRe) ?? []) {
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1];
    const media = tag.match(/\bmedia-type="([^"]+)"/)?.[1] ?? "";
    if (id && href) manifest.set(id, { href, media });
  }

  const spineIds = [...opf.match(/<itemref\b[^>]*>/g) ?? []]
    .map((tag) => tag.match(/\bidref="([^"]+)"/)?.[1])
    .filter((v): v is string => Boolean(v));

  const title =
    opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/)?.[1]?.trim() || undefined;

  const chunks: string[] = [];
  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item) continue;
    if (!/html|xml/.test(item.media)) continue;
    const path = base + item.href;
    const raw = await readText(path);
    if (!raw) continue;
    const body = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? raw;
    chunks.push(stripHtml(body));
  }
  const text = normalise(chunks.join("\n\n"));
  return { text, format: "epub", title };
}

/** Remove tags and decode the handful of entities EPUB text actually uses. */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|section)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'");
}

async function extractDocx(bytes: Buffer): Promise<ExtractedDoc> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ buffer: bytes });
  return { text: normalise(result.value), format: "docx" };
}

async function extractPdf(bytes: Buffer): Promise<ExtractedDoc> {
  // pdf-parse v2 is class-based and needs an explicit destroy() to release
  // the worker it spawns.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText();
    const info = await parser.getInfo().catch(() => undefined);
    const title =
      (info as { Title?: string } | undefined)?.Title?.trim() || undefined;
    return { text: normalise(result.text ?? ""), format: "pdf", title };
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

/** Extract text from any supported source file. */
export async function extractText(
  filename: string,
  bytes: Buffer,
): Promise<ExtractedDoc> {
  const format = detectFormat(filename, bytes);
  switch (format) {
    case "pdf":
      return extractPdf(bytes);
    case "docx":
      return extractDocx(bytes);
    case "epub":
      return extractEpub(bytes);
    case "md":
    case "txt":
    default: {
      const text = decodeText(bytes);
      const title =
        text.match(/^\s*#\s+(.+)$/m)?.[1]?.trim() ??
        text.split("\n").find((l) => l.trim().length > 0)?.slice(0, 60).trim();
      return { text, format, title };
    }
  }
}
