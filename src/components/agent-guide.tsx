"use client";

import { useEffect, useState } from "react";
import { Icon } from "./site-chrome";

const MCP_CONFIG = `{
  "mcpServers": {
    "novel-illustration-studio": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/novel-illustration-studio/src/mcp/server.ts"],
      "env": {
        "NOVEL_ILL_API_URL": "https://<your-deployment>.vercel.app"
      }
    }
  }
}`;

const TOOLS = [
  {
    name: "upload_novel",
    what: "Ingest a file and run the deterministic analysis.",
    returns: "novel id, chapter list, character / scene / relationship counts.",
  },
  {
    name: "list_novels",
    what: "List every ingested novel.",
    returns: "array of novel metadata.",
  },
  {
    name: "get_context",
    what: "Pull the working material for one novel.",
    returns:
      "chapters with previews, entity candidates with evidence, relationship graph, keywords, existing shots.",
  },
  {
    name: "get_chapter",
    what: "Read one chapter in full.",
    returns: "chapter title and text.",
  },
  {
    name: "search_novel",
    what: "Find passages by keyword.",
    returns: "matching sentences with their chapter index.",
  },
  {
    name: "get_taxonomy",
    what: "Read the category / subcategory tree.",
    returns: "built-in taxonomy plus any per-novel refinement.",
  },
  {
    name: "refine_analysis",
    what: "Post your corrected entities, scenes, relationships and keywords back.",
    returns:
      "the stored analysis. Rejects entities with an unknown subcategory.",
  },
  {
    name: "create_shot",
    what: "Create a story beat and generate its Seedance prompt.",
    returns:
      "the shot with its assembled prompt and the validation report.",
  },
  {
    name: "list_shots",
    what: "List the shots of a novel.",
    returns: "shots with prompts and validation reports.",
  },
  {
    name: "validate_prompt",
    what: "Check a prompt against the hard rules without storing it.",
    returns:
      "errors, warnings and the facts extracted from the prompt.",
  },
  {
    name: "list_templates",
    what: "Read the Seedance templates and the enforced limits.",
    returns: "templates plus limit constants.",
  },
];

const PROMPT_RULES = [
  "Images ≤ 9, videos ≤ 3, audio ≤ 3, total files ≤ 12.",
  "Every @reference must state its purpose — “@图片1 作为首帧”.",
  "Duration must be between 4 and 15 seconds.",
  "Prompts longer than 8 seconds should use a segmented timeline.",
  "Never combine contradictory camera directions (“固定镜头” with “环绕镜头”).",
  "Realistic human faces are unsupported — never reference them.",
  "Always design the audio: sound effects, background music, narration.",
];

const REST_ENDPOINTS: [string, string, string][] = [
  ["GET", "/api/novels", "List novels"],
  ["POST", "/api/novels", "Upload a novel (multipart: file, title)"],
  [
    "GET",
    "/api/novels/:id",
    "Full record (add ?includeText=1 for the raw text)",
  ],
  ["DELETE", "/api/novels/:id", "Delete a novel"],
  ["GET", "/api/novels/:id/context", "Agent working material"],
  ["GET", "/api/novels/:id/chapters/:index", "One chapter's text"],
  ["GET", "/api/novels/:id/search?q=", "Search passages"],
  ["GET / PUT", "/api/novels/:id/analysis", "Read or replace the analysis"],
  ["GET / PUT", "/api/novels/:id/taxonomy", "Read or extend the taxonomy"],
  ["GET / POST", "/api/novels/:id/shots", "List or create shots"],
  [
    "GET / POST",
    "/api/novels/:id/shots/:shotId/prompt",
    "Read, rebuild or validate a shot prompt",
  ],
  ["GET", "/api/templates", "Seedance templates and limits"],
  ["POST", "/api/prompts/validate", "Validate a prompt"],
];

export function AgentGuide() {
  const [origin, setOrigin] = useState("https://<your-deployment>.vercel.app");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const config = MCP_CONFIG.replace(
    "https://<your-deployment>.vercel.app",
    origin,
  );

  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <p className="tag tag-teal">MCP</p>
        <h1 className="mt-4 text-[2.1rem] font-semibold leading-tight tracking-tight text-mist-100">
          Let an AI agent drive the whole workflow
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-mist-300">
          The studio holds no model of its own. It parses, counts, assembles and
          validates — the agent you point at it supplies the judgement. Register
          the MCP server with Cursor, Claude Desktop or any MCP client and the
          tools below become callable functions.
        </p>
      </section>

      <section className="panel fade-up p-7">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-mist-100">
          <Icon name="terminal" size={18} />
          Register the server
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-mist-400">
          Add this to your MCP configuration. Point{" "}
          <code className="rounded bg-white/8 px-1.5 py-0.5 font-mono text-[12px] text-mist-200">
            NOVEL_ILL_API_URL
          </code>{" "}
          at the deployed studio — the tools then act on the same data the
          website shows.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-xl border border-white/8 bg-ink-900/70 p-4 font-mono text-[12.5px] leading-relaxed text-mist-200">
          {config}
        </pre>
      </section>

      <section className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
        <div className="panel fade-up p-7">
          <h2 className="text-lg font-semibold text-mist-100">Tools</h2>
          <div className="mt-4 divide-y divide-white/8">
            {TOOLS.map((tool) => (
              <div key={tool.name} className="py-3.5 first:pt-0 last:pb-0">
                <code className="font-mono text-[13px] text-amber-glow">
                  {tool.name}
                </code>
                <p className="mt-1 text-[13px] leading-relaxed text-mist-300">
                  {tool.what}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-mist-400">
                  <span className="uppercase tracking-[0.1em]">Returns</span>{" "}
                  {tool.returns}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="panel fade-up p-7">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-mist-100">
              <Icon name="sparkles" size={18} />
              Seedance rules the validator enforces
            </h2>
            <ul className="mt-4 space-y-2.5">
              {PROMPT_RULES.map((rule) => (
                <li
                  key={rule}
                  className="flex gap-2.5 text-[13px] leading-relaxed text-mist-300"
                >
                  <span className="mt-0.5 shrink-0 text-teal-glow">
                    <Icon name="check" size={14} />
                  </span>
                  {rule}
                </li>
              ))}
            </ul>
          </div>

          <div className="panel fade-up p-7">
            <h2 className="text-lg font-semibold text-mist-100">
              The loop an agent should run
            </h2>
            <ol className="mt-4 space-y-3">
              {[
                "upload_novel — ingest the book.",
                "get_context — read the candidates and their evidence.",
                "get_chapter / search_novel — pull the passages you need to judge.",
                "get_taxonomy — see the filing slots, extend them if the book needs it.",
                "refine_analysis — write back the corrected entities and the relationship graph.",
                "create_shot — one call per story beat; read the validation report and fix what it flags.",
                "validate_prompt — final check before handing the prompt over.",
              ].map((step, i) => (
                <li
                  key={i}
                  className="flex gap-3 text-[13px] leading-relaxed text-mist-300"
                >
                  <span className="mt-0.5 shrink-0 font-mono text-[11px] text-amber-glow">
                    0{i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="panel fade-up p-7">
        <h2 className="text-lg font-semibold text-mist-100">REST surface</h2>
        <p className="mt-2 text-[13px] text-mist-400">
          The same capabilities are available over plain HTTP if your agent
          cannot speak MCP.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.12em] text-mist-400">
                <th className="py-2 pr-4 font-medium">Method</th>
                <th className="py-2 pr-4 font-medium">Path</th>
                <th className="py-2 font-medium">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {REST_ENDPOINTS.map(([method, path, purpose]) => (
                <tr key={`${method}-${path}`}>
                  <td className="py-2.5 pr-4 font-mono text-[12px] text-teal-glow">
                    {method}
                  </td>
                  <td className="py-2.5 pr-4 font-mono text-[12px] text-mist-200">
                    {path}
                  </td>
                  <td className="py-2.5 text-mist-400">{purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
