import { SiteHeader, SiteFooter } from "@/components/site-chrome";
import { LibraryView } from "@/components/library-view";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="/" />

      <main className="mx-auto max-w-7xl px-5 pt-14">
        <section className="mb-12 max-w-3xl">
          <p className="tag tag-amber">
            <Icon2 /> Novel → analysis → Seedance prompts
          </p>
          <h1 className="mt-5 text-[2.6rem] font-semibold leading-[1.1] tracking-tight text-mist-100">
            Turn a novel into a{" "}
            <span className="text-amber-glow">shot-by-shot prompt plan</span>
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-mist-300">
            Upload a book. The studio dissects it into characters, scenes,
            events and a relationship graph, then an AI agent you control turns
            the story beats into Seedance 2.0 prompts — every one of them
            checked against the model&apos;s hard limits before it leaves the
            building.
          </p>
        </section>

        <LibraryView />
      </main>

      <SiteFooter />
    </div>
  );
}

function Icon2() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
