const paths = {
  plus: "M12 5v14M5 12h14",
  search: "M21 21l-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0",
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2v-10a9.5 9.5 0 0 1 19 0Z",
  terminal: "m5 7 5 5-5 5M13 17h6",
  code: "m8 5-6 7 6 7m8-14 6 7-6 7m-3-17-2 20",
  branch:
    "M6 6v12m0-9c0 4 12-1 12 5M6 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm0 16a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-4a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  folder: "M3 5h6l2 2h10v13H3Z",
  arrow: "M12 19V5m-6 6 6-6 6 6",
  chevron: "m9 5 7 7-7 7",
  close: "m6 6 12 12M6 18 18 6",
  panel: "M3 4h18v16H3ZM15 4v16",
  menu: "M4 6h16M4 12h16M4 18h16",
  grid: "M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z",
  activity: "M2 12h5l3-8 4 16 3-8h5",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2",
  cloud: "M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11Z",
  check: "m5 12 4 4L20 5",
  refresh: "M20 8a8 8 0 1 0 1 8M20 3v5h-5",
  external: "M14 3h7v7m0-7L10 14M10 3H3v18h18v-7",
  file: "M5 2h9l5 5v15H5ZM14 2v6h5M9 13h6m-6 4h6",
  copy: "M8 8h13v13H8ZM16 4V2H2v14h2",
  stop: "M6 6h12v12H6Z",
  play: "m8 4 12 8-12 8Z",
  back: "m14 5-7 7 7 7",
} as const;
export function Icon({ name, size = 17 }: { name: keyof typeof paths; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
