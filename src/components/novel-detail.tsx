"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "./site-chrome";
import type { Analysis, Entity, Scene, Shot } from "@/lib/types";

interface Props {
  novelId: string;
}

interface Payload {
  novel: {
    id: string;
    title: string;
    filename: string;
    format: string;
    chars: number;
    chapters: number;
    createdAt: string;
    updatedAt: string;
    analysisVersion: number;
    synopsis: string;
    language: string;
  };
  stats: Analysis["stats"];
  analysis: Analysis;
  shots: Shot[];
  chapters: { index: number; title: string; length: number; preview: string }[];
}

type Tab = "characters" | "scenes" | "events" | "graph" | "shots" | "chapters";

export function NovelDetail({ novelId }: Props) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("characters");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/novels/${novelId}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? "Failed to load the novel");
        if (!cancelled) setData(json as Payload);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load the novel");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [novelId]);

  const characters = useMemo(
    () => data?.analysis.entities.filter((e) => e.category === "character") ?? [],
    [data],
  );
  const events = useMemo(
    () => data?.analysis.entities.filter((e) => e.category === "event") ?? [],
    [data],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (e: Entity | Scene) => {
      if (!q) return true;
      const label = "name" in e ? e.name : e.title;
      return (
        label?.toLowerCase().includes(q) ||
        e.summary?.toLowerCase().includes(q)
      );
    };
    if (tab === "characters") return characters.filter(match);
    if (tab === "events") return events.filter(match);
    if (tab === "scenes") return (data?.analysis.scenes ?? []).filter(match);
    return [];
  }, [query, tab, characters, events, data]);

  if (error) {
    return (
      <div className="panel p-10 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-rose-glow/40 bg-rose-glow/10 text-rose-100">
          <Icon name="alert" size={22} />
        </span>
        <p className="mt-4 text-sm text-mist-200">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="panel p-10 text-center text-sm text-mist-400">
        Loading the analysis…
      </div>
    );
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "characters", label: "Characters", count: data.stats.characters },
    { key: "scenes", label: "Scenes", count: data.stats.scenes },
    { key: "events", label: "Events", count: events.length },
    { key: "graph", label: "Relationship graph", count: data.stats.relationships },
    { key: "shots", label: "Shots", count: data.shots.length },
    { key: "chapters", label: "Chapters", count: data.chapters.length },
  ];

  return (
    <div className="space-y-7">
      <header className="panel fade-up p-7">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tag tag-amber uppercase">{data.novel.format}</span>
              <span className="tag uppercase">{data.novel.language}</span>
              <span className="tag">analysis v{data.novel.analysisVersion}</span>
            </div>
            <h1 className="mt-3 text-[1.9rem] font-semibold leading-tight tracking-tight text-mist-100">
              {data.novel.title}
            </h1>
            <p className="mt-1 text-[13px] text-mist-400">
              {data.novel.filename} · {data.novel.chars.toLocaleString()} characters
              · uploaded {new Date(data.novel.createdAt).toLocaleString()}
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {[
              { label: "Characters", value: data.stats.characters },
              { label: "Scenes", value: data.stats.scenes },
              { label: "Links", value: data.stats.relationships },
              { label: "Chapters", value: data.stats.chapters },
              { label: "Shots", value: data.shots.length },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl border border-white/8 bg-ink-900/60 px-3.5 py-2.5 text-center"
              >
                <p className="text-lg font-semibold text-mist-100">
                  {stat.value}
                </p>
                <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-mist-400">
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </div>

        {data.novel.synopsis && (
          <p className="mt-5 border-t border-white/8 pt-4 text-[13px] leading-relaxed text-mist-300">
            {data.novel.synopsis}
          </p>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
              tab === t.key
                ? "bg-white/9 text-mist-100"
                : "text-mist-400 hover:bg-white/5 hover:text-mist-200"
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="ml-1.5 font-mono text-[11px] text-mist-400">
                {t.count}
              </span>
            )}
          </button>
        ))}
        {tab !== "graph" && tab !== "shots" && tab !== "chapters" && (
          <div className="relative ml-auto w-full max-w-xs">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist-400">
              <Icon name="search" size={14} />
            </span>
            <input
              className="input pl-9"
              placeholder="Filter…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      {tab === "characters" && (
        <EntityGrid entities={filtered as Entity[]} kind="character" />
      )}
      {tab === "events" && <EntityGrid entities={filtered as Entity[]} kind="event" />}
      {tab === "scenes" && <SceneGrid scenes={filtered as Scene[]} />}
      {tab === "graph" && <GraphPanel analysis={data.analysis} />}
      {tab === "shots" && <ShotPanel shots={data.shots} />}
      {tab === "chapters" && (
        <div className="panel divide-y divide-white/8">
          {data.chapters.map((chapter) => (
            <details key={chapter.index} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[11px] text-amber-glow">
                    {String(chapter.index + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm text-mist-100">{chapter.title}</span>
                </span>
                <span className="flex items-center gap-3 text-xs text-mist-400">
                  {chapter.length.toLocaleString()} chars
                  <span className="transition-transform group-open:rotate-90">
                    <Icon name="arrow" size={13} />
                  </span>
                </span>
              </summary>
              <p className="mt-3 whitespace-pre-wrap border-l-2 border-white/10 pl-4 text-[13px] leading-relaxed text-mist-300">
                {chapter.preview}
                {chapter.length > chapter.preview.length ? "…" : ""}
              </p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────── entity grid

function EntityGrid({
  entities,
  kind,
}: {
  entities: Entity[];
  kind: "character" | "event";
}) {
  if (entities.length === 0) {
    return (
      <div className="panel p-10 text-center text-sm text-mist-400">
        Nothing extracted yet.
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {entities.map((entity, i) => (
        <article
          key={entity.id}
          className="panel panel-hover fade-up p-5"
          style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[15px] font-medium text-mist-100">
              {entity.name}
            </h3>
            <span className="tag tag-amber shrink-0">{entity.subcategory}</span>
          </div>

          {entity.summary && (
            <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-mist-400">
              {entity.summary}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="tag">{entity.mentions} mentions</span>
            <span className="tag">
              {(entity.chapterSpread * 100).toFixed(0)}% of chapters
            </span>
            {entity.agentReviewed && (
              <span className="tag tag-teal">
                <Icon name="check" size={11} />
                agent reviewed
              </span>
            )}
          </div>

          {entity.evidence.length > 0 && (
            <details className="group mt-3 border-t border-white/8 pt-3">
              <summary className="cursor-pointer list-none text-[11px] uppercase tracking-[0.12em] text-mist-400 transition-colors hover:text-mist-200">
                Evidence ({entity.evidence.length})
              </summary>
              <ul className="mt-2.5 space-y-2">
                {entity.evidence.map((line, j) => (
                  <li
                    key={j}
                    className="border-l-2 border-white/10 pl-3 text-[12.5px] leading-relaxed text-mist-300"
                  >
                    {line}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {kind === "character" &&
            Object.keys(entity.attributes).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/8 pt-3">
                {Object.entries(entity.attributes).map(([k, v]) => (
                  <span key={k} className="tag">
                    {k}: {v}
                  </span>
                ))}
              </div>
            )}
        </article>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────── scene grid

function SceneGrid({ scenes }: { scenes: Scene[] }) {
  if (scenes.length === 0) {
    return (
      <div className="panel p-10 text-center text-sm text-mist-400">
        No scenes extracted yet.
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {scenes.map((scene, i) => (
        <article
          key={scene.id}
          className="panel panel-hover fade-up p-5"
          style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="flex items-center gap-2 text-[15px] font-medium text-mist-100">
              <span className="text-teal-glow">
                <Icon name="map" size={15} />
              </span>
              {scene.title}
            </h3>
            <span className="tag tag-teal shrink-0">{scene.subcategory}</span>
          </div>
          {scene.summary && (
            <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-mist-400">
              {scene.summary}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="tag">{scene.mentions} mentions</span>
            {scene.chapters.length > 0 && (
              <span className="tag">
                chapters {scene.chapters.slice(0, 6).join(", ")}
                {scene.chapters.length > 6 ? "…" : ""}
              </span>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── graph panel

function GraphPanel({ analysis }: { analysis: Analysis }) {
  const [selected, setSelected] = useState<string | null>(null);

  const nodes = useMemo(() => {
    const map = new Map<string, { id: string; name: string; weight: number }>();
    for (const entity of analysis.entities) {
      if (entity.category !== "character") continue;
      map.set(entity.id, {
        id: entity.id,
        name: entity.name,
        weight: entity.mentions,
      });
    }
    return [...map.values()];
  }, [analysis]);

  const edges = useMemo(
    () =>
      analysis.relationships
        .filter((r) => r.weight >= 2)
        .slice(0, 60),
    [analysis],
  );

  const nameOf = useMemo(() => {
    const map = new Map(nodes.map((n) => [n.id, n.name]));
    return (id: string) => map.get(id) ?? id;
  }, [nodes]);

  const maxWeight = Math.max(1, ...edges.map((e) => e.weight));

  if (edges.length === 0) {
    return (
      <div className="panel p-10 text-center text-sm text-mist-400">
        No relationships above the weight threshold. Lower the threshold in the
        API response to see every link.
      </div>
    );
  }

  const selectedEdges = selected
    ? edges.filter((e) => e.sourceId === selected || e.targetId === selected)
    : edges;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="panel p-6">
        <h3 className="text-sm font-medium text-mist-100">
          Co-occurrence network
        </h3>
        <p className="mt-1 text-[12.5px] text-mist-400">
          Edge weight = how often two characters share a sentence. Click a name
          to isolate its links.
        </p>

        <div className="mt-5 flex flex-wrap gap-1.5">
          {nodes.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() => setSelected(selected === node.id ? null : node.id)}
              className={`rounded-lg border px-2.5 py-1 text-[12.5px] transition-colors ${
                selected === node.id
                  ? "border-amber-glow/50 bg-amber-glow/14 text-amber-100"
                  : "border-white/10 bg-white/4 text-mist-300 hover:border-white/20 hover:text-mist-100"
              }`}
            >
              {node.name}
              <span className="ml-1.5 font-mono text-[10px] text-mist-400">
                {node.weight}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-6 space-y-2.5">
          {selectedEdges.slice(0, 40).map((edge) => {
            const isSelected =
              selected && (edge.sourceId === selected || edge.targetId === selected);
            return (
              <div
                key={edge.id}
                className={`rounded-xl border px-3.5 py-2.5 transition-colors ${
                  isSelected
                    ? "border-amber-glow/35 bg-amber-glow/8"
                    : "border-white/8 bg-ink-900/50"
                }`}
              >
                <div className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="text-mist-100">
                    {nameOf(edge.sourceId)}
                    <span className="mx-2 text-mist-400">→</span>
                    {nameOf(edge.targetId)}
                  </span>
                  <span className="flex items-center gap-2">
                    {edge.kinds.map((k) => (
                      <span key={k} className="tag">
                        {k}
                      </span>
                    ))}
                    <span className="font-mono text-[11px] text-mist-400">
                      {edge.weight}
                    </span>
                  </span>
                </div>
                <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-amber-glow/70"
                    style={{ width: `${(edge.weight / maxWeight) * 100}%` }}
                  />
                </div>
                {edge.evidence[0] && (
                  <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-mist-400">
                    {edge.evidence[0]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel p-6">
        <h3 className="text-sm font-medium text-mist-100">
          {selected ? `Links of ${nameOf(selected)}` : "Strongest links"}
        </h3>
        <div className="mt-4 space-y-2">
          {selectedEdges
            .slice()
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 14)
            .map((edge) => (
              <div
                key={edge.id}
                className="flex items-center justify-between border-b border-white/6 pb-2 text-[13px] last:border-0"
              >
                <span className="text-mist-200">
                  {nameOf(edge.sourceId)}
                  <span className="mx-1.5 text-mist-400">↔</span>
                  {nameOf(edge.targetId)}
                </span>
                <span className="font-mono text-[11px] text-amber-glow">
                  {edge.weight}
                </span>
              </div>
            ))}
        </div>

        <h3 className="mt-7 text-sm font-medium text-mist-100">Keywords</h3>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {analysis.keywords.slice(0, 30).map((k) => (
            <span key={k.term} className="tag">
              {k.term}
              <span className="font-mono text-[10px] text-mist-400">
                {k.count}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────── shot panel

function ShotPanel({ shots }: { shots: Shot[] }) {
  if (shots.length === 0) {
    return (
      <div className="panel p-10 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-mist-400">
          <Icon name="film" size={22} />
        </span>
        <p className="mt-4 text-sm text-mist-200">No shots yet.</p>
        <p className="mt-1 text-[13px] text-mist-400">
          An agent creates them through the MCP tool or POST /api/novels/:id/shots.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {shots.map((shot) => (
        <article key={shot.id} className="panel fade-up p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-amber-glow">
                {String(shot.index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-[15px] font-medium text-mist-100">
                {shot.title}
              </h3>
              {shot.mood && <span className="tag tag-rose">{shot.mood}</span>}
              {shot.durationSec && (
                <span className="tag">{shot.durationSec}s</span>
              )}
            </div>
            {shot.validation && (
              <span
                className={`tag ${shot.validation.ok ? "tag-teal" : "tag-rose"}`}
              >
                <Icon
                  name={shot.validation.ok ? "check" : "alert"}
                  size={11}
                />
                {shot.validation.ok ? "valid" : `${shot.validation.errors.length} errors`}
              </span>
            )}
          </div>

          {shot.excerpt && (
            <p className="mt-3 border-l-2 border-white/10 pl-3 text-[13px] leading-relaxed text-mist-400">
              {shot.excerpt}
            </p>
          )}

          {shot.prompt && (
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl border border-white/8 bg-ink-900/70 p-4 font-mono text-[12.5px] leading-relaxed text-mist-200">
              {shot.prompt}
            </pre>
          )}

          {shot.validation && shot.validation.warnings.length > 0 && (
            <ul className="mt-3 space-y-1">
              {shot.validation.warnings.map((w, i) => (
                <li key={i} className="text-[12.5px] text-amber-100/80">
                  {w}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </div>
  );
}
