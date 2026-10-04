import type { ReactNode } from "react";

const paths: Record<string, ReactNode> = {
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  external: (
    <>
      <path d="M8 5H5v14h14v-3M12 5h7v7M19 5 9 15" />
    </>
  ),
  chevron: <path d="m8 5 7 7-7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  layers: (
    <>
      <path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H5v18h14V8l-5-5Z" />
      <path d="M14 3v5h5M8 12h8M8 16h5" />
    </>
  ),
  agent: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  flow: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="15" width="6" height="6" rx="1" />
      <path d="M9 6h6a3 3 0 0 1 3 3v6M6 9v6a3 3 0 0 0 3 3h6" />
    </>
  ),
  command: (
    <>
      <path d="M9 9h6v6H9zM9 9H6a3 3 0 1 1 3-3v3Zm6 0V6a3 3 0 1 1 3 3h-3ZM9 15v3a3 3 0 1 1-3-3h3Zm6 0h3a3 3 0 1 1-3 3v-3Z" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  code: (
    <>
      <path d="m7 6-5 6 5 6m10-12 5 6-5 6m-4-15-2 18" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="m5 5 14 14M19 5 5 19" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3H9Z" />
    </>
  ),
  activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" />
    </>
  ),
  folder: <path d="M3 6V4h7l3 3h8v13H3V6Z" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  play: <path d="m8 4 12 8-12 8V4Z" />,
  send: (
    <>
      <path d="m3 3 18 9-18 9 4-9-4-9ZM7 12h14" />
    </>
  ),
  chart: (
    <>
      <path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4" />
    </>
  ),
  message: (
    <>
      <path d="M3 4h18v13H9l-6 4V4Z" />
      <path d="M7 8h10M7 12h7" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  className = "",
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name] ?? paths.layers}
    </svg>
  );
}

export function NexusMark({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 25V7l20 18V7M6 7h7m6 18h7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="square"
      />
      <circle cx="6" cy="7" r="2.5" fill="currentColor" />
      <circle cx="26" cy="25" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`nx-brand${small ? " nx-brand-small" : ""}`}>
      <NexusMark size={small ? 23 : 30} />
      <span>NEXUS</span>
    </span>
  );
}
