#!/usr/bin/env node
/**
 * Novel Illustration Studio — MCP server.
 *
 * Exposes the workflow as tools that any MCP client (Cursor, Claude Desktop,
 * …) can call. The server holds no model of its own: the calling agent IS
 * the reasoning engine, and these tools are the workshop bench it works at.
 *
 *   upload_novel      ingest a novel file and get the deterministic analysis
 *   list_novels       list every ingested novel
 *   delete_novel      delete a novel and all its shots
 *   get_context       working material for one novel (chapters, candidates, graph)
 *   get_chapter       full text of one chapter
 *   search_novel      find passages by keyword
 *   get_taxonomy      category / subcategory tree
 *   refine_analysis   post the agent's corrected entities back
 *   create_shot       create a storyboard shot and generate + validate its prompt
 *   list_shots        list the shots of a novel
 *   validate_prompt   check a Seedance prompt against the hard rules
 *   list_templates    the Seedance prompt templates and limits
 *
 * Environment:
 *   NOVEL_ILL_API_URL   base URL of the studio API (default http://localhost:3111)
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { StudioClient } from "../lib/client";

const client = new StudioClient();

const server = new McpServer({
  name: "novel-illustration-studio",
  version: "1.0.0",
});

/** Wrap a handler so errors come back as tool errors instead of crashing. */
function toolError(error: unknown): { content: { type: "text"; text: string }[]; isError: true } {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

// ────────────────────────────────────────────── novels

server.tool(
  "upload_novel",
  "Upload a novel file (txt / md / pdf / docx / epub) and run the deterministic analysis. " +
    "Returns the novel id, chapter list and the extracted character / scene / relationship candidates. " +
    "The analysis is statistical — you are expected to review and correct it.",
  {
    path: z
      .string()
      .optional()
      .describe("Absolute path of the novel file on disk. Provide this or `text`."),
    text: z
      .string()
      .optional()
      .describe("Raw novel text. Use this instead of `path` for content that is not a local file."),
    filename: z
      .string()
      .optional()
      .describe("Filename to record for raw text (e.g. 'chapter-one.txt'). Defaults to 'pasted.txt'."),
    title: z.string().optional().describe("Optional title override."),
  },
  async ({ path: filePath, text, filename, title }) => {
    try {
      if (!filePath && !(typeof text === "string" && text.length > 0)) {
        throw new Error("Provide either `path` (a file on disk) or `text` (raw content).");
      }
      let bytes: Uint8Array;
      let name: string;
      if (typeof text === "string" && text.length > 0) {
        bytes = new TextEncoder().encode(text);
        name = filename ?? "pasted.txt";
      } else {
        const resolved = path.resolve(filePath as string);
        bytes = await readFile(resolved);
        name = path.basename(resolved);
      }
      const result = await client.upload<{
        novel: { id: string; title: string; chapters: number; chars: number };
        stats: unknown;
        chapters: { index: number; title: string }[];
      }>("/api/novels", name, bytes, title);
      return json({
        ...result,
        nextStep:
          "Call get_context with this novel id to pull the full working material, then refine_analysis with your corrected entities, then create_shot for each story beat.",
      });
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "list_novels",
  "List every novel that has been ingested into the studio.",
  {},
  async () => {
    try {
      return json(await client.get("/api/novels"));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "delete_novel",
  "Delete a novel and every shot attached to it. Use this when a book was " +
    "mis-parsed and has to be re-ingested from scratch.",
  { novelId: z.string() },
  async ({ novelId }) => {
    try {
      return json(await client.delete(`/api/novels/${novelId}`));
    } catch (error) {
      return toolError(error);
    }
  },
);

// ────────────────────────────────────────────── reading

server.tool(
  "get_context",
  "Get the working material for a novel: chapter index with previews, character / scene / event " +
    "candidates with their evidence, the relationship graph, keywords and the existing shots. " +
    "Use this before making semantic judgements about the book.",
  {
    novelId: z.string().describe("The novel id returned by upload_novel."),
    entities: z.number().optional().describe("Max entities to return (default 40)."),
    evidence: z.number().optional().describe("Max evidence quotes per entity (default 3)."),
  },
  async ({ novelId, entities, evidence }) => {
    try {
      const params = new URLSearchParams();
      if (entities !== undefined) params.set("entities", String(entities));
      if (evidence !== undefined) params.set("evidence", String(evidence));
      const query = params.toString();
      return json(
        await client.get(`/api/novels/${novelId}/context${query ? `?${query}` : ""}`),
      );
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "get_chapter",
  "Get the full text of one chapter.",
  {
    novelId: z.string(),
    chapterIndex: z.number().int().min(0),
  },
  async ({ novelId, chapterIndex }) => {
    try {
      return json(await client.get(`/api/novels/${novelId}/chapters/${chapterIndex}`));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "search_novel",
  "Search the novel for a keyword or phrase and return the matching sentences with their chapter index.",
  {
    novelId: z.string(),
    query: z.string().describe("Keyword or phrase to look for."),
    limit: z.number().int().min(1).max(50).optional(),
  },
  async ({ novelId, query, limit }) => {
    try {
      const params = new URLSearchParams({ q: query });
      if (limit !== undefined) params.set("limit", String(limit));
      return json(await client.get(`/api/novels/${novelId}/search?${params.toString()}`));
    } catch (error) {
      return toolError(error);
    }
  },
);

// ────────────────────────────────────────────── taxonomy & analysis

server.tool(
  "get_taxonomy",
  "Get the category / subcategory tree used to classify entities. " +
    "Every entity you post back must use a subcategory that exists here.",
  { novelId: z.string().optional() },
  async ({ novelId }) => {
    try {
      const url = novelId
        ? `/api/novels/${novelId}/taxonomy`
        : "/api/taxonomy";
      return json(await client.get(url));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "refine_analysis",
  "Post your corrected analysis back to the studio: entities, scenes, relationships and keywords. " +
    "This overwrites the deterministic candidates, so send the complete set, not a patch. " +
    "Entities are rejected (422) if their subcategory is not in the taxonomy.",
  {
    novelId: z.string(),
    entities: z
      .array(
        z.object({
          id: z.string().optional(),
          name: z.string(),
          category: z.enum(["character", "scene", "object", "event", "emotion", "theme"]),
          subcategory: z.string(),
          mentions: z.number().int().optional(),
          chapterSpread: z.number().optional(),
          evidence: z.array(z.string()).optional(),
          summary: z.string().optional(),
          attributes: z.record(z.string(), z.string()).optional(),
          agentReviewed: z.boolean().optional(),
          agentNote: z.string().optional(),
        }),
      )
      .describe("The complete character / event entity list."),
    scenes: z
      .array(
        z.object({
          id: z.string().optional(),
          title: z.string(),
          subcategory: z.string(),
          chapters: z.array(z.number().int()).optional(),
          mentions: z.number().int().optional(),
          summary: z.string().optional(),
          attributes: z.record(z.string(), z.string()).optional(),
        }),
      )
      .optional()
      .describe("The complete scene list."),
    relationships: z
      .array(
        z.object({
          id: z.string().optional(),
          sourceId: z.string(),
          targetId: z.string(),
          weight: z.number().optional(),
          kinds: z.array(z.string()).optional(),
          evidence: z.array(z.string()).optional(),
          agentLabel: z.string().optional(),
        }),
      )
      .optional()
      .describe("The complete relationship list. sourceId / targetId must reference entity ids."),
    keywords: z
      .array(
        z.object({
          term: z.string(),
          count: z.number().int().optional(),
          category: z
            .enum(["object", "place", "nature", "concept"])
            .optional()
            .describe(
              "How the term is used in a prompt: an object in the frame, a place " +
                "the camera is in, nature that sets the light, or a concept that " +
                "frames a gathering.",
            ),
        }),
      )
      .optional(),
  },
  async ({ novelId, entities, scenes, relationships, keywords }) => {
    try {
      const body: Record<string, unknown> = { entities };
      if (scenes) body.scenes = scenes;
      if (relationships) body.relationships = relationships;
      if (keywords) body.keywords = keywords;
      return json(await client.put(`/api/novels/${novelId}/analysis`, body));
    } catch (error) {
      return toolError(error);
    }
  },
);

// ────────────────────────────────────────────── shots & prompts

server.tool(
  "create_shot",
  "Create a storyboard shot for a novel and generate its Seedance 2.0 prompt. " +
    "Give `parts` for full control (segments / camera / audio / style / subject / scene / action). " +
    "If you omit them, the server assembles a prompt from the shot fields. " +
    "The returned validation report lists any rule violations you must fix.",
  {
    novelId: z.string(),
    title: z.string().describe("Short name of the beat, e.g. '雨夜相遇'."),
    chapterIndex: z.number().int().min(0).describe("Which chapter this beat comes from."),
    excerpt: z.string().describe("The source passage the shot is based on."),
    entityIds: z.array(z.string()).optional().describe("Ids of the entities in this shot."),
    sceneId: z.string().optional(),
    mood: z.string().optional().describe("e.g. '紧张悬疑'."),
    style: z.string().optional().describe("e.g. '电影级质感，胶片颗粒，浅景深'."),
    durationSec: z.number().int().min(4).max(15).optional(),
    notes: z.string().optional(),
    references: z
      .array(
        z.object({
          slot: z.string().describe("e.g. '图片1', '视频1', '音频1'."),
          kind: z.enum(["image", "video", "audio"]),
          purpose: z.string().describe("What the reference is used for — required."),
          note: z.string().optional(),
        }),
      )
      .optional(),
    parts: z
      .object({
        subject: z.string().optional(),
        scene: z.string().optional(),
        action: z.string().optional(),
        camera: z.string().optional().describe("Camera language, e.g. '低角度仰拍，缓缓推进至面部特写'."),
        audio: z.string().optional().describe("Audio design, e.g. '音效：雨声、脚步；背景音乐：低沉弦乐'."),
        transition: z.string().optional(),
        durationSec: z.number().int().min(4).max(15).optional().describe("Overrides the shot's durationSec when assembling the prompt."),
        mood: z.string().optional().describe("Overrides the shot's mood; appended to the style line."),
        style: z.string().optional().describe("Overrides the shot's style suffix."),
        segments: z
          .array(
            z.object({
              from: z.number().int(),
              to: z.number().int(),
              description: z.string(),
            }),
          )
          .optional()
          .describe("Timeline segments. Required by the validator for prompts longer than 8 seconds."),
      })
      .optional(),
  },
  async (args) => {
    try {
      const { novelId, parts, ...shot } = args;
      return json(await client.post(`/api/novels/${novelId}/shots`, { ...shot, parts }));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "list_shots",
  "List the storyboard shots of a novel, with their prompts and validation reports.",
  { novelId: z.string() },
  async ({ novelId }) => {
    try {
      return json(await client.get(`/api/novels/${novelId}/shots`));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "validate_prompt",
  "Validate a Seedance 2.0 prompt against the hard rules (素材数量上限 / 每个 @ 引用都要写用途 / " +
    "时长 4–15 秒 / 指令冲突 / 写实人脸) without storing anything.",
  { prompt: z.string() },
  async ({ prompt }) => {
    try {
      return json(await client.post("/api/prompts/validate", { prompt }));
    } catch (error) {
      return toolError(error);
    }
  },
);

server.tool(
  "list_templates",
  "List the Seedance prompt templates distilled from the seedance-prompt-zh skill, together with " +
    "the hard limits the validator enforces.",
  {},
  async () => {
    try {
      return json(await client.get("/api/templates"));
    } catch (error) {
      return toolError(error);
    }
  },
);

// ────────────────────────────────────────────── start

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[novel-illustration-studio] MCP server ready (API: ${
      process.env.NOVEL_ILL_API_URL ?? "http://localhost:3111"
    })\n`,
  );
}

main().catch((error) => {
  process.stderr.write(
    `[novel-illustration-studio] fatal: ${
      error instanceof Error ? error.message : String(error)
    }\n`,
  );
  process.exitCode = 1;
});
