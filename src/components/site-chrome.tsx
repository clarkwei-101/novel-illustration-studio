import Link from "next/link";

/** Inline SVG icon set — no emoji anywhere in the UI. */
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    book: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </>
    ),
    upload: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <path d="M7 10l5-5 5 5" />
        <path d="M12 5v12" />
      </>
    ),
    network: (
      <>
        <circle cx="12" cy="5" r="2.5" />
        <circle cx="5" cy="19" r="2.5" />
        <circle cx="19" cy="19" r="2.5" />
        <path d="M12 7.5v4M12 11.5L6 17M12 11.5L18 17" />
      </>
    ),
    sparkles: (
      <>
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
      </>
    ),
    terminal: (
      <>
        <path d="M4 17l6-5-6-5" />
        <path d="M12 19h8" />
      </>
    ),
    check: <path d="M20 6L9 17l-5-5" />,
    alert: (
      <>
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      </>
    ),
    arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    users: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    map: (
      <>
        <path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" />
        <path d="M8 2v16M16 6v16" />
      </>
    ),
    film: (
      <>
        <rect x="2" y="3" width="20" height="18" rx="2" />
        <path d="M7 3v18M17 3v18M2 9h20M2 15h20" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    copy: (
      <>
        <rect x="9" y="9" width="12" height="12" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.sparkles}
    </svg>
  );
}

const NAV = [
  { href: "/", label: "Library", icon: "book" },
  { href: "/workflow", label: "Workflow", icon: "sparkles" },
  { href: "/agent", label: "Agent Guide", icon: "terminal" },
];

/**
 * The Society's cross-site identity. Every project built inside the
 * `ai应用社` workspace embeds the Cyber Foundation logo and links back to
 * the society site by default (see AGENTS.md).
 */
const CYBER_FOUNDATION_URL = "https://cyber-foundation-ten.vercel.app";

export function CyberFoundationBadge({ compact = false }: { compact?: boolean }) {
  return (
    <a
      href={CYBER_FOUNDATION_URL}
      target="_blank"
      rel="noreferrer noopener"
      title="Cyber Foundation — HKUST AI应用社"
      className="group flex items-center gap-2 rounded-lg border border-white/8 px-2 py-1 transition-colors hover:border-amber-glow/35 hover:bg-amber-glow/8"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.svg"
        alt="Cyber Foundation"
        width={compact ? 18 : 22}
        height={compact ? 18 : 22}
        className="shrink-0 rounded-[5px]"
      />
      {!compact && (
        <span className="whitespace-nowrap text-[11px] font-medium tracking-wide text-mist-300 transition-colors group-hover:text-mist-100">
          Cyber Foundation
        </span>
      )}
    </a>
  );
}

export function SiteHeader({ active }: { active?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-ink-950/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-5 py-3.5">
        <Link href="/" className="group flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-amber-glow/35 bg-amber-glow/10 text-amber-glow transition-colors group-hover:bg-amber-glow/16">
            <Icon name="book" size={17} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight text-mist-100">
              Novel Illustration Studio
            </span>
            <span className="mt-0.5 text-[10.5px] uppercase tracking-[0.18em] text-mist-400">
              Agent-driven workflow
            </span>
          </span>
        </Link>

        <nav className="ml-auto flex items-center gap-1">
          {NAV.map((item) => {
            const isActive = active === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                  isActive
                    ? "bg-white/8 text-mist-100"
                    : "text-mist-400 hover:bg-white/5 hover:text-mist-200"
                }`}
              >
                <Icon name={item.icon} size={15} />
                {item.label}
              </Link>
            );
          })}
          <span className="mx-1 h-5 w-px bg-white/10" aria-hidden="true" />
          <CyberFoundationBadge />
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto mt-20 max-w-7xl border-t border-white/8 px-5 py-8 text-[12px] text-mist-400">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p>
          Novel Illustration Studio — deterministic parsing and Seedance prompt
          assembly, with an AI agent in the loop.
        </p>
        <p className="flex flex-wrap items-center gap-4">
          <Link href="/workflow" className="transition-colors hover:text-mist-200">
            Workflow
          </Link>
          <Link href="/agent" className="transition-colors hover:text-mist-200">
            Agent Guide
          </Link>
          <a
            href={CYBER_FOUNDATION_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="transition-colors hover:text-mist-200"
          >
            Cyber Foundation
          </a>
        </p>
      </div>
      <p className="mt-4 flex items-center gap-2 text-[11px] text-mist-400">
        <CyberFoundationBadge compact />
        A project of Cyber Foundation — HKUST AI应用社.
      </p>
    </footer>
  );
}
