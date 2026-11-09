#!/usr/bin/env node
/**
 * End-to-end check of the MCP server.
 *
 * Spawns the server over stdio, speaks the MCP protocol to it, and calls
 * every tool once against a live studio API. This is the only test that
 * proves an AI agent can actually drive the workflow — the unit tests only
 * prove the HTTP surface works.
 *
 * Usage: NOVEL_ILL_API_URL=http://localhost:3111 tsx tests/mcp-e2e.ts
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..", "src", "mcp", "server.ts");

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  constructor() {
    this.child = spawn("npx", ["tsx", SERVER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (/Error|error/.test(text)) {
        console.log(`  [server stderr] ${text.trim().slice(0, 300)}`);
      }
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const id = message.id as number | undefined;
      if (id === undefined) continue;
      const waiter = this.pending.get(id);
      if (!waiter) continue;
      this.pending.delete(id);
      if (message.error) {
        waiter.reject(new Error(JSON.stringify(message.error)));
      } else {
        waiter.resolve(message.result);
      }
    }
  }

  request(method: string, params: unknown, timeoutMs = 60_000): Promise<unknown> {
    const id = this.nextId++;
    const payload = `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(payload);
    });
  }

  notify(method: string, params: unknown): void {
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
    );
  }

  kill(): void {
    this.child.kill();
  }
}

/** Pull the JSON payload out of an MCP tool result. */
function toolJson(result: unknown): any {
  const content = (result as { content?: { type: string; text: string }[] })
    ?.content;
  if (!Array.isArray(content) || content.length === 0) {
    throw new Error(`Unexpected tool result: ${JSON.stringify(result)}`);
  }
  const first = content[0];
  if (first.type === "text") {
    try {
      return JSON.parse(first.text);
    } catch {
      return first.text;
    }
  }
  throw new Error(`Unexpected content type: ${first.type}`);
}

async function main(): Promise<void> {
  const apiUrl = process.env.NOVEL_ILL_API_URL ?? "http://localhost:3111";
  console.log(`\n\x1b[1mMCP end-to-end against ${apiUrl}\x1b[0m\n`);

  const client = new McpClient();
  try {
    const init = (await client.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "nis-e2e", version: "1.0.0" },
    })) as { serverInfo?: { name?: string } };
    check(
      "the server initializes",
      init?.serverInfo?.name === "novel-illustration-studio",
      JSON.stringify(init?.serverInfo),
    );
    client.notify("notifications/initialized", {});

    const tools = (await client.request("tools/list", {})) as {
      tools?: { name: string }[];
    };
    const names = (tools.tools ?? []).map((t) => t.name);
    check("the server lists 11 tools", names.length === 11, names.join(", "));
    for (const expected of [
      "upload_novel",
      "list_novels",
      "get_context",
      "get_chapter",
      "search_novel",
      "get_taxonomy",
      "refine_analysis",
      "create_shot",
      "list_shots",
      "validate_prompt",
      "list_templates",
    ]) {
      check(`exposes ${expected}`, names.includes(expected));
    }

    // ── upload
    const sample = `第一章 测试章节

林远山坐在书房里，雨声敲着窗棂。

"你终于还是来了。"林远山抬起头。

沈墨站在门口，手里握着一封旧信。

第二章 归途

青峰山的雾很重。沈墨背着包袱，走在山道上。
`;
    const uploaded = toolJson(
      await client.request("tools/call", {
        name: "upload_novel",
        arguments: { text: sample, filename: "mcp-sample.txt", title: "MCP 测试" },
      }),
    );
    check("upload_novel returns a novel id", typeof uploaded?.novel?.id === "string");
    const novelId = uploaded.novel.id;
    check("upload_novel reports the chapters", uploaded?.novel?.chapters === 2, String(uploaded?.novel?.chapters));
    check("upload_novel surfaces a next step", typeof uploaded.nextStep === "string");

    // ── list
    const listed = toolJson(await client.request("tools/call", { name: "list_novels", arguments: {} }));
    check(
      "list_novels includes the new novel",
      (listed.novels ?? []).some((n: { id: string }) => n.id === novelId),
    );

    // ── context
    const context = toolJson(
      await client.request("tools/call", { name: "get_context", arguments: { novelId } }),
    );
    check(
      "get_context returns entities with evidence",
      (context.entities ?? []).length > 0 &&
        (context.entities ?? []).every((e: { evidence?: unknown[] }) => Array.isArray(e.evidence)),
      `${(context.entities ?? []).length} entities`,
    );
    check("get_context returns chapters", (context.chapters ?? []).length === 2);
    check("get_context states the Seedance limits", Boolean(context.seedanceLimits));

    // ── chapter + search
    const chapter = toolJson(
      await client.request("tools/call", {
        name: "get_chapter",
        arguments: { novelId, chapterIndex: 0 },
      }),
    );
    check("get_chapter returns the chapter text", (chapter.text ?? "").includes("林远山"));

    const searched = toolJson(
      await client.request("tools/call", {
        name: "search_novel",
        arguments: { novelId, query: "雨声" },
      }),
    );
    check("search_novel finds the passage", (searched.count ?? 0) > 0, String(searched.count));

    // ── taxonomy
    const taxonomy = toolJson(
      await client.request("tools/call", { name: "get_taxonomy", arguments: { novelId } }),
    );
    check(
      "get_taxonomy returns the subcategory tree",
      Array.isArray(taxonomy?.builtin?.character) && taxonomy.builtin.character.length > 0,
    );

    // ── refine
    const refined = toolJson(
      await client.request("tools/call", {
        name: "refine_analysis",
        arguments: {
          novelId,
          entities: [
            {
              name: "林远山",
              category: "character",
              subcategory: "mentor",
              mentions: 3,
              chapterSpread: 1,
              evidence: ["林远山坐在书房里。"],
              summary: "书房主人",
              attributes: { 身份: "书房主人" },
              agentReviewed: true,
            },
            {
              name: "沈墨",
              category: "character",
              subcategory: "protagonist",
              mentions: 3,
              chapterSpread: 1,
              evidence: ["沈墨站在门口。"],
              summary: "来访者",
              attributes: {},
              agentReviewed: true,
            },
          ],
          relationships: [
            { sourceId: "ent-0", targetId: "ent-1", weight: 9, kinds: ["dialogue"], evidence: [] },
          ],
        },
      }),
    );
    check(
      "refine_analysis stores the agent's entities",
      (refined.entities ?? []).length === 2 &&
        (refined.entities ?? []).every((e: { agentReviewed?: boolean }) => e.agentReviewed),
    );

    // A taxonomy violation must be rejected.
    const rejected = await client.request("tools/call", {
      name: "refine_analysis",
      arguments: {
        novelId,
        entities: [
          { name: "错", category: "character", subcategory: "不存在的分类", agentReviewed: true },
        ],
      },
    });
    const rejectedText = JSON.stringify(rejected);
    check(
      "refine_analysis rejects an unknown subcategory",
      rejectedText.includes("unknown subcategory") || rejectedText.includes("Error"),
      rejectedText.slice(0, 200),
    );

    // ── shots
    const shot = toolJson(
      await client.request("tools/call", {
        name: "create_shot",
        arguments: {
          novelId,
          title: "雨夜书房",
          chapterIndex: 0,
          excerpt: "林远山坐在书房里。",
          entityIds: ["ent-0"],
          mood: "紧张悬疑",
          style: "电影级质感，胶片颗粒",
          durationSec: 12,
          references: [
            { slot: "图片1", kind: "image", purpose: "作为林远山的人物形象参考" },
          ],
          parts: {
            camera: "缓慢推镜头至面部特写",
            audio: "音效：雨声；背景音乐：大提琴",
            segments: [
              { from: 0, to: 4, description: "雨幕空镜" },
              { from: 4, to: 8, description: "推至书房" },
              { from: 8, to: 12, description: "面部特写" },
            ],
          },
        },
      }),
    );
    check("create_shot returns a prompt", (shot.prompt ?? "").length > 30);
    check(
      "create_shot reports a valid prompt",
      shot?.validation?.ok === true,
      JSON.stringify(shot?.validation?.errors),
    );

    const shots = toolJson(
      await client.request("tools/call", { name: "list_shots", arguments: { novelId } }),
    );
    check("list_shots returns the shot", (shots.shots ?? []).length === 1);

    // ── validation
    const good = toolJson(
      await client.request("tools/call", {
        name: "validate_prompt",
        arguments: { prompt: "10秒画面，固定镜头，音效：雨声，电影级质感" },
      }),
    );
    check("validate_prompt accepts a valid prompt", good?.ok === true, JSON.stringify(good?.errors));

    const bad = toolJson(
      await client.request("tools/call", {
        name: "validate_prompt",
        arguments: { prompt: "30秒画面，固定镜头与环绕镜头，@图片1，音效：雨声" },
      }),
    );
    check("validate_prompt rejects a bad prompt", bad?.ok === false);
    check(
      "validate_prompt explains the failures",
      (bad?.errors ?? []).length >= 2,
      JSON.stringify(bad?.errors),
    );

    // ── templates
    const templates = toolJson(
      await client.request("tools/call", { name: "list_templates", arguments: {} }),
    );
    check("list_templates returns the templates", (templates.templates ?? []).length >= 6);
    check("list_templates returns the limits", Boolean(templates.limits));
  } finally {
    client.kill();
  }

  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m\n`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\n\x1b[31mThe MCP e2e crashed:\x1b[0m", error);
  process.exitCode = 1;
});
