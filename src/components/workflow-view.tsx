"use client";

import { useEffect, useState } from "react";
import { Icon } from "./site-chrome";

interface Template {
  id: string;
  title: string;
  scenario: string;
  description: string;
  durationSec: number;
  segmented: boolean;
  skeleton: string;
  slots: { slot: string; kind: string; purpose: string }[];
}

interface TemplatesPayload {
  templates: Template[];
  limits: Record<string, number>;
}

const SKILL_RULES = [
  {
    title: "The @ reference system",
    body: "Every material is bound to a slot with @图片1 / @视频1 / @音频1, and every slot must say what it is for — a first frame, a character reference, a camera model, a tempo. A slot without a purpose is the single most common way a prompt fails.",
  },
  {
    title: "The prompt formula",
    body: "Subject + scene + action + camera language + segmented timeline + transition + audio design + style. Each term earns its place; a prompt missing the audio design loses half its impact even when the picture is right.",
  },
  {
    title: "Segmented timelines",
    body: "Above eight seconds the prompt is broken into time bands — 0–3秒, 3–6秒, 6–10秒 — so the model knows what happens when. Below eight seconds a timeline is busywork and only adds load.",
  },
  {
    title: "Camera vocabulary",
    body: "Push, pull, pan, tilt, follow, orbit, one-take, plus shot sizes from 极致特写 to 远景. The validator flags contradictions such as asking for a 固定镜头 and an 环绕镜头 in the same breath.",
  },
  {
    title: "Style and mood",
    body: "电影级质感, 胶片颗粒, 浅景深, 2.35:1宽银幕 — the texture suffix. Mood is a separate axis: 紧张悬疑, 温暖治愈, 史诗恢宏, 暗黑奇幻, 仙侠高燃.",
  },
  {
    title: "Hard limits",
    body: "Twelve files at most. Duration between four and fifteen seconds. Realistic human faces are rejected by the model itself, so they must never enter a reference or a description.",
  },
];

export function WorkflowView() {
  const [data, setData] = useState<TemplatesPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/templates", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch {
        /* leave the panel in its loading state */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <p className="tag tag-amber">Prompt craft</p>
        <h1 className="mt-4 text-[2.1rem] font-semibold leading-tight tracking-tight text-mist-100">
          The Seedance 2.0 prompt system, compiled into code
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-mist-300">
          The <code className="font-mono text-[13px] text-amber-glow">
            seedance-prompt-zh
          </code>{" "}
          skill is a guide for a prompt engineer. Here its hard constraints run
          as a validator and its scenarios run as templates, so an agent can
          produce prompts that satisfy the model on the first attempt instead of
          discovering the limits by trial and error.
        </p>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {SKILL_RULES.map((rule, i) => (
          <article
            key={rule.title}
            className="panel panel-hover fade-up p-6"
            style={{ animationDelay: `${i * 45}ms` }}
          >
            <span className="font-mono text-[11px] text-amber-glow">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h2 className="mt-2.5 text-[15px] font-medium text-mist-100">
              {rule.title}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-mist-400">
              {rule.body}
            </p>
          </article>
        ))}
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-mist-100">
            Scenario templates
          </h2>
          <span className="text-xs text-mist-400">
            {data?.templates.length ?? "—"} templates
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {(data?.templates ?? []).map((template, i) => (
            <article
              key={template.id}
              className="panel panel-hover fade-up p-6"
              style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="tag tag-teal">{template.scenario}</p>
                  <h3 className="mt-2.5 text-[15px] font-medium text-mist-100">
                    {template.title}
                  </h3>
                </div>
                <span className="tag shrink-0">{template.durationSec}s</span>
              </div>

              <p className="mt-3 text-[13px] leading-relaxed text-mist-400">
                {template.description}
              </p>

              <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl border border-white/8 bg-ink-900/70 p-4 font-mono text-[12px] leading-relaxed text-mist-300">
                {template.skeleton}
              </pre>

              {template.slots.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {template.slots.map((slot) => (
                    <span key={slot.slot} className="tag">
                      <span className="text-amber-glow">@{slot.slot}</span>
                      <span className="text-mist-400">{slot.purpose}</span>
                    </span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      {data && (
        <section className="panel fade-up p-7">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-mist-100">
            <Icon name="alert" size={18} />
            Limits the validator enforces
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {Object.entries(data.limits).map(([key, value]) => (
              <div
                key={key}
                className="rounded-xl border border-white/8 bg-ink-900/60 px-4 py-3"
              >
                <p className="text-lg font-semibold text-mist-100">{value}</p>
                <p className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-mist-400">
                  {key}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
