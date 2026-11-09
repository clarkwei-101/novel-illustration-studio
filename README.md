# Novel Illustration Studio

Turn a novel into a shot-by-shot **Seedance 2.0** prompt plan.

Upload a book (TXT / Markdown / PDF / DOCX / EPUB), let the studio dissect it into
characters, scenes, events, a relationship graph and recurring keywords, then
point an AI agent at it — via **MCP** or **REST** — to turn the story beats into
prompts that are checked against Seedance's hard limits before they leave.

## The division of labour

The studio holds **no language model of its own**. The server is deterministic:
it parses, counts, segments, assembles and validates. The agent supplies the
judgement — deciding who is who, which beats deserve a shot, what a shot should
look like.

That split is deliberate. Counting every mention of a character is exhaustive
work that a model does badly; deciding whether "青峰山的后崖" is the same place
as "后崖" is work a model does well and a regex does badly. The server does the
first, the agent does the second, and the agent's corrections are written back
through the same API the website uses.

## Quick start

```bash
npm install
npm run dev          # http://localhost:3111
npm test             # 77 unit checks
```

Without `BLOB_READ_WRITE_TOKEN` the studio stores everything under `data/` on
the local filesystem. With the token set it uses a private Vercel Blob store.

## The workflow

1. **Upload** — the file becomes plain text, split into chapters with titles
   and previews. Chinese, English and mixed input are all handled.
2. **Dissect** — character / scene / event candidates are extracted with the
   evidence that justifies them, plus a co-occurrence relationship graph and
   the recurring keywords.
3. **Agent review** — the agent re-files every entity into a refined taxonomy,
   fixes the candidates it got wrong and adds the ones the statistics missed.
4. **Prompt** — story beats become Seedance prompts, each one validated
   against the rules below before it is stored.

## The Seedance rules it enforces

Compiled from the `seedance-prompt-zh` skill:

| Rule | Limit |
| --- | --- |
| Total referenced files | ≤ 12 |
| Image references | ≤ 9 |
| Video references | ≤ 3 |
| Audio references | ≤ 3 |
| Clip duration | 4 – 15 s |
| Timeline segments | required above 8 s |
| `@slot` references | each must state its purpose |
| Camera language | no contradictory moves |
| Realistic human faces | rejected |
| Audio design | required |

Violations are errors; softer omissions are warnings. Both are returned with
the prompt so an agent can fix them in one pass.

## MCP server

Eleven tools, over stdio:

```
upload_novel     ingest a file and run the deterministic analysis
list_novels      list every ingested novel
get_context      chapters, candidates, graph, keywords, shots
get_chapter      full text of one chapter
search_novel     find passages by keyword
get_taxonomy     the category / subcategory tree
refine_analysis  write the agent's corrected entities back
create_shot      create a shot and generate + validate its prompt
list_shots       the shots of a novel
validate_prompt  check a prompt against the hard rules
list_templates   the prompt templates and the limits
```

Register it with any MCP client:

```json
{
  "mcpServers": {
    "novel-illustration-studio": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/novel-illustration-studio/src/mcp/server.ts"],
      "env": {
        "NOVEL_ILL_API_URL": "https://your-deployment.vercel.app"
      }
    }
  }
}
```

## REST API

| Method | Route | Purpose |
| --- | --- | --- |
| GET / POST | `/api/novels` | list / upload |
| GET | `/api/novels/:id` | the full record |
| GET | `/api/novels/:id/context` | working material for an agent |
| GET | `/api/novels/:id/chapters/:index` | one chapter's text |
| GET | `/api/novels/:id/search?q=` | find passages |
| POST | `/api/novels/:id/analysis` | apply the agent's corrections |
| GET POST | `/api/novels/:id/shots` | list / create shots |
| POST | `/api/novels/:id/shots/:shotId/prompt` | build + validate a prompt |
| GET | `/api/novels/:id/taxonomy` | the taxonomy for one novel |
| GET | `/api/taxonomy` | the built-in taxonomy |
| POST | `/api/prompts/validate` | validate a raw prompt |
| GET | `/api/templates` | the prompt templates |

## Project layout

```
src/lib/parse.ts        multi-format text extraction
src/lib/segment.ts      chapter segmentation
src/lib/analyze.ts      the deterministic analysis engine
src/lib/taxonomy.ts     the built-in category tree
src/lib/seedance.ts     prompt assembly + constraint validation
src/lib/storage.ts      filesystem / Vercel Blob drivers
src/lib/repository.ts   novels, analyses, shots
src/mcp/server.ts       the MCP stdio server
src/app/                the website and the REST API
tests/run.ts            unit suite
tests/mcp-e2e.ts        MCP protocol end-to-end suite
```
