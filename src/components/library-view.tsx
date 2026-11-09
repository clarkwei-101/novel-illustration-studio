"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./site-chrome";
import type { Novel } from "@/lib/types";

interface UploadState {
  status: "idle" | "uploading" | "done" | "error";
  message: string;
  novelId?: string;
}

export function LibraryView() {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [upload, setUpload] = useState<UploadState>({
    status: "idle",
    message: "",
  });
  const [title, setTitle] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/novels", { cache: "no-store" });
      const data = await res.json();
      setNovels(Array.isArray(data.novels) ? data.novels : []);
    } catch {
      setNovels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (file: File) => {
      setUpload({ status: "uploading", message: `Parsing ${file.name}…` });
      const form = new FormData();
      form.append("file", file);
      if (title.trim()) form.append("title", title.trim());
      try {
        const res = await fetch("/api/novels", { method: "POST", body: form });
        const data = await res.json();
        if (!res.ok) {
          setUpload({
            status: "error",
            message: data?.error ?? `Upload failed (HTTP ${res.status})`,
          });
          return;
        }
        setUpload({
          status: "done",
          message: `Parsed ${data.novel.title} — ${data.stats.characters} characters, ${data.stats.scenes} scenes, ${data.stats.relationships} relationships, ${data.stats.chapters} chapters.`,
          novelId: data.novel.id,
        });
        setTitle("");
        await load();
      } catch (error) {
        setUpload({
          status: "error",
          message:
            error instanceof Error ? error.message : "Upload failed unexpectedly.",
        });
      }
    },
    [load, title],
  );

  const remove = useCallback(
    async (id: string) => {
      await fetch(`/api/novels/${id}`, { method: "DELETE" });
      await load();
    },
    [load],
  );

  return (
    <div className="space-y-8">
      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="panel fade-up p-7">
          <p className="tag tag-amber">Step 01</p>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-mist-100">
            Upload the novel
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-mist-300">
            TXT, Markdown, PDF, DOCX and EPUB are all accepted. The text is
            extracted, split into chapters, and mined for characters, scenes
            and relationships — all without calling a language model.
          </p>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void send(file);
            }}
            className={`mt-5 rounded-2xl border border-dashed p-7 text-center transition-colors ${
              dragOver
                ? "border-amber-glow/60 bg-amber-glow/8"
                : "border-white/12 bg-ink-900/50"
            }`}
          >
            <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-mist-300">
              <Icon name="upload" size={20} />
            </span>
            <p className="mt-3 text-sm text-mist-200">
              Drop a file here, or{" "}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-amber-glow underline underline-offset-4 transition-colors hover:text-amber-100"
              >
                browse
              </button>
            </p>
            <p className="mt-1 text-xs text-mist-400">
              Maximum 30 MB. Scanned PDFs need OCR before upload.
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.markdown,.pdf,.docx,.epub"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void send(file);
                e.target.value = "";
              }}
            />
          </div>

          <div className="mt-4">
            <label
              htmlFor="title"
              className="mb-1.5 block text-xs uppercase tracking-[0.14em] text-mist-400"
            >
              Title override (optional)
            </label>
            <input
              id="title"
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Taken from the document metadata when left empty"
            />
          </div>

          {upload.status !== "idle" && (
            <div
              className={`mt-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed ${
                upload.status === "error"
                  ? "border-rose-glow/40 bg-rose-glow/10 text-rose-100"
                  : "border-white/10 bg-white/4 text-mist-200"
              }`}
            >
              <span className="mt-0.5 shrink-0">
                <Icon
                  name={upload.status === "error" ? "alert" : "check"}
                  size={15}
                />
              </span>
              <span>
                {upload.message}
                {upload.novelId && (
                  <Link
                    href={`/novels/${upload.novelId}`}
                    className="ml-2 inline-flex items-center gap-1 text-amber-glow underline underline-offset-4"
                  >
                    Open the analysis
                    <Icon name="arrow" size={13} />
                  </Link>
                )}
              </span>
            </div>
          )}
        </div>

        <div className="panel fade-up grid-lines p-7">
          <p className="tag tag-teal">How it works</p>
          <ol className="mt-5 space-y-4">
            {[
              {
                icon: "book",
                title: "Parse & segment",
                body: "The file becomes plain text, split into chapters with titles and previews.",
              },
              {
                icon: "users",
                title: "Dissect",
                body: "Characters, scenes, events, a relationship graph and recurring keywords are extracted with the evidence attached.",
              },
              {
                icon: "sparkles",
                title: "Agent review",
                body: "An AI agent corrects the candidates and files every entity into a refined taxonomy.",
              },
              {
                icon: "film",
                title: "Prompt",
                body: "Story beats become Seedance 2.0 prompts, checked against the hard limits before they leave.",
              },
            ].map((step, i) => (
              <li key={step.title} className="flex gap-3.5">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-mist-300">
                  <Icon name={step.icon} size={15} />
                </span>
                <div>
                  <p className="text-sm font-medium text-mist-100">
                    <span className="mr-2 font-mono text-[11px] text-amber-glow">
                      0{i + 1}
                    </span>
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-mist-400">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <Link
            href="/agent"
            className="btn btn-ghost mt-6 w-full justify-center"
          >
            <Icon name="terminal" size={15} />
            Let an agent drive this
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-mist-100">
            Library
          </h2>
          <span className="text-xs text-mist-400">
            {novels.length} {novels.length === 1 ? "novel" : "novels"}
          </span>
        </div>

        {loading ? (
          <div className="panel p-10 text-center text-sm text-mist-400">
            Loading the library…
          </div>
        ) : novels.length === 0 ? (
          <div className="panel p-10 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-mist-400">
              <Icon name="book" size={22} />
            </span>
            <p className="mt-4 text-sm text-mist-200">No novels yet.</p>
            <p className="mt-1 text-[13px] text-mist-400">
              Upload a file above, or let an agent call the API for you.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {novels.map((novel, i) => (
              <article
                key={novel.id}
                className="panel panel-hover fade-up p-5"
                style={{ animationDelay: `${i * 45}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/novels/${novel.id}`}
                      className="block truncate text-[15px] font-medium text-mist-100 transition-colors hover:text-amber-glow"
                    >
                      {novel.title}
                    </Link>
                    <p className="mt-1 truncate text-xs text-mist-400">
                      {novel.filename}
                    </p>
                  </div>
                  <span className="tag shrink-0 uppercase">{novel.format}</span>
                </div>

                <p className="mt-3 line-clamp-2 min-h-[2.4rem] text-[13px] leading-relaxed text-mist-400">
                  {novel.synopsis || "No synopsis yet — open the analysis to see the extracted material."}
                </p>

                <div className="mt-4 flex flex-wrap gap-1.5">
                  <span className="tag">
                    <Icon name="clock" size={11} />
                    {novel.chapters} ch
                  </span>
                  <span className="tag">{novel.chars.toLocaleString()} chars</span>
                  <span className="tag">v{novel.analysisVersion}</span>
                  <span className="tag uppercase">{novel.language}</span>
                </div>

                <div className="mt-4 flex items-center gap-2 border-t border-white/8 pt-4">
                  <Link
                    href={`/novels/${novel.id}`}
                    className="btn btn-ghost flex-1 justify-center py-1.5 text-[13px]"
                  >
                    Open analysis
                    <Icon name="arrow" size={13} />
                  </Link>
                  <button
                    type="button"
                    onClick={() => void remove(novel.id)}
                    aria-label={`Delete ${novel.title}`}
                    className="btn btn-ghost px-2.5 py-1.5 text-mist-400 hover:text-rose-100"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
