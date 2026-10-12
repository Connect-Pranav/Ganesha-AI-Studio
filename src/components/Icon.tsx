const paths = {
  overview: 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z',
  littleloop: 'M4 6h16v12H4zM8 6V4m8 2V4M8 20v-2m8 2v-2M10 9.5v5l4-2.5z',
  sunverse: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  foliocraft: 'M4 4h16v16H4zM4 9h16M9 9v11',
  agents: 'M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm2 4h6v6H9z',
  connection: 'M9 2v6m6-6v6M6 8h12v3a6 6 0 0 1-12 0zm6 9v5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  collapse: 'M15 6l-6 6 6 6',
  expand: 'M9 6l6 6-6 6',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  content: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  research: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm10 2l-4.35-4.35',
  code: 'M16 18l6-6-6-6M8 6l-6 6 6 6',
  analytics: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  refresh: 'M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6',
  check: 'M5 12l5 5L20 7',
  alert: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  arrow: 'M5 12h14m-6-6l6 6-6 6',
  universe: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M3.5 9.5c3-4 14-4 17 0M3.5 14.5c3 4 14 4 17 0M19 5.5h.01M5 18.5h.01',
  pipelines: 'M5 6a2 2 0 1 0 0-.01M19 6a2 2 0 1 0 0-.01M12 18a2 2 0 1 0 0-.01M7 6h10M6.5 7.5l4.5 9M17.5 7.5l-4.5 9',
} satisfies Record<string, string>;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
