// Original agent portraits, drawn in SVG from the agent's id: a friendly robot whose colours come
// from its team and whose chest badge shows its job. Deterministic (same agent → same face), no
// external images, and deliberately not based on any traditional or religious depiction.
import { AGENTS, type AgentMeta } from '../data/agentsMeta';

// Every agent in the registry has a portrait in public/agents (cut from the owner's agent sheet).
const ART = new Set(AGENTS.map((a) => a.id));

const TEAM: Record<string, [string, string, string]> = {
  // [main, deep, glow]
  master: ['#f5b83d', '#8a4b06', '#ffd98a'],
  sunverse: ['#b06bff', '#3b1680', '#e2c4ff'],
  littleloop: ['#ff7aa8', '#8a1f4d', '#ffd0e0'],
  foliocraft: ['#2fd6c0', '#0b5a55', '#b8fff3'],
  ops: ['#4c8dff', '#123a8f', '#c4d9ff'],
};

// Chest-badge glyphs (24×24 paths), picked by keywords in the role.
const GLYPHS: [RegExp, string][] = [
  [/orchestrat/i, 'M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 15.6 7.1 18.2 8 12.7 4 8.8 9.5 8z'],
  [/music director|composer/i, 'M9 18a3 3 0 1 1-2-2.8V5l11-2v11a3 3 0 1 1-2-2.8V6.3L9 7.6z'],
  [/lyric|script|dialogue/i, 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3'],
  [/vocal|voice/i, 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6'],
  [/sound/i, 'M5 4v16M12 4v16M19 4v16M3 9h4M10 14h4M17 7h4'],
  [/trend|growth|analytic|data/i, 'M4 19h16M6 16l4-5 3 3 5-7M18 7h2v2'],
  [/video|edit|animation(?! prompt)/i, 'M4 6h12v12H4zM16 10l4-2v8l-4-2'],
  [/release|publish|distribution/i, 'M12 3c3 2 5 6 5 10l-2 3H9l-2-3c0-4 2-8 5-10zM12 9a1.5 1.5 0 1 0 0 .1M9 19l-2 2M15 19l2 2'],
  [/artwork|visual identity|character|art designer|design-system|ux/i, 'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2s0-2 1.5-2H18a3 3 0 0 0 3-3 9 9 0 0 0-9-11zM7.5 11a1 1 0 1 0 0 .1M10 7a1 1 0 1 0 0 .1M15 7a1 1 0 1 0 0 .1'],
  [/story/i, 'M4 5c3-1 6-1 8 1 2-2 5-2 8-1v14c-3-1-6-1-8 1-2-2-5-2-8-1zM12 6v14'],
  [/prompt/i, 'M5 19L15 9M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 11l.7 1.3L21 13l-1.3.7L19 15l-.7-1.3L17 13l1.3-.7z'],
  [/planner|research|intelligence|strategy/i, 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM16 16l4 4'],
  [/architect/i, 'M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6'],
  [/software|engineer \(|code/i, 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16'],
  [/monetis|monetiz/i, 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM15 8.5c-.5-1-1.6-1.5-3-1.5-1.8 0-3 .9-3 2.2 0 3 6 1.6 6 4.6 0 1.3-1.3 2.2-3 2.2-1.5 0-2.6-.6-3.1-1.6M12 5.5v13'],
  [/automation/i, 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1'],
  [/recovery|troubleshoot/i, 'M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.5 2.5-2.4-.6-.6-2.4z'],
  [/safety|policy|quality|audit/i, 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5'],
  [/document/i, 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5'],
  [/communication|handoff/i, 'M4 5h16v11H9l-5 4zM8 9h8M8 12h5'],
];
const glyphFor = (role: string) => GLYPHS.find(([re]) => re.test(role))?.[1] ?? GLYPHS[0][1];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function AgentAvatar({ agent, size = 96, className = '' }: { agent: Pick<AgentMeta, 'id' | 'name' | 'team' | 'role'>; size?: number; className?: string }) {
  // Owner-supplied portraits (public/agents/<id>.webp) win; the drawn robot is the fallback.
  if (ART.has(agent.id))
    return <img className={`agent-avatar agent-art ${className}`} src={`./agents/${agent.id}.webp`} alt={`${agent.name} portrait`} width={size} loading="lazy" decoding="async" />;
  const [main, deep, glow] = TEAM[agent.team] ?? TEAM.ops;
  const h = hash(agent.id);
  const eyes = h % 4; // 0 round · 1 visor · 2 happy arcs · 3 ovals
  const antenna = (h >> 3) % 4; // 0 ball · 1 bolt · 2 twin · 3 halo ring
  const ears = (h >> 6) % 3; // 0 round · 1 fins · 2 none
  const tilt = ((h >> 9) % 7) - 3; // a little personality
  const uid = `av-${agent.id}`;
  const glyph = glyphFor(agent.role);
  return (
    <svg className={`agent-avatar ${className}`} viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={`${agent.name} avatar`}>
      <defs>
        <radialGradient id={`${uid}-bg`} cx="50%" cy="38%" r="70%">
          <stop offset="0%" stopColor={main} stopOpacity="0.55" />
          <stop offset="70%" stopColor={deep} stopOpacity="0.9" />
          <stop offset="100%" stopColor="#070c2b" />
        </radialGradient>
        <linearGradient id={`${uid}-head`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={glow} />
        </linearGradient>
        <linearGradient id={`${uid}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={main} />
          <stop offset="100%" stopColor={deep} />
        </linearGradient>
      </defs>
      <circle cx="60" cy="60" r="58" fill={`url(#${uid}-bg)`} />
      <circle cx="60" cy="60" r="57" fill="none" stroke={main} strokeOpacity="0.55" strokeWidth="2" />
      {/* body + chest badge */}
      <path d="M26 118c2-22 15-34 34-34s32 12 34 34z" fill={`url(#${uid}-body)`} />
      <circle cx="60" cy="102" r="11" fill="#070c2b" stroke={glow} strokeWidth="1.5" />
      <g transform="translate(51.5 93.5) scale(0.7)" fill="none" stroke={glow} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d={glyph} />
      </g>
      <g transform={`rotate(${tilt} 60 52)`}>
        {/* antenna */}
        {antenna === 0 && (
          <>
            <line x1="60" y1="24" x2="60" y2="12" stroke={glow} strokeWidth="3" strokeLinecap="round" />
            <circle cx="60" cy="10" r="5" fill={main} stroke="#fff" strokeWidth="1.5" />
          </>
        )}
        {antenna === 1 && <path d="M62 8l-7 11h6l-3 9 9-13h-6z" fill={main} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />}
        {antenna === 2 && (
          <>
            <line x1="50" y1="25" x2="44" y2="12" stroke={glow} strokeWidth="3" strokeLinecap="round" />
            <line x1="70" y1="25" x2="76" y2="12" stroke={glow} strokeWidth="3" strokeLinecap="round" />
            <circle cx="44" cy="11" r="3.5" fill={main} />
            <circle cx="76" cy="11" r="3.5" fill={main} />
          </>
        )}
        {antenna === 3 && <ellipse cx="60" cy="14" rx="16" ry="4.5" fill="none" stroke={main} strokeWidth="3" />}
        {/* ears */}
        {ears === 0 && (
          <>
            <circle cx="27" cy="52" r="7" fill={main} />
            <circle cx="93" cy="52" r="7" fill={main} />
          </>
        )}
        {ears === 1 && (
          <>
            <path d="M30 44l-10 8 10 8z" fill={main} />
            <path d="M90 44l10 8-10 8z" fill={main} />
          </>
        )}
        {/* head */}
        <rect x="29" y="24" width="62" height="56" rx="24" fill={`url(#${uid}-head)`} stroke={main} strokeWidth="2" />
        {/* face screen */}
        <rect x="36" y="36" width="48" height="32" rx="15" fill="#0b1238" />
        {eyes === 0 && (
          <>
            <circle cx="49" cy="51" r="5" fill={glow} />
            <circle cx="71" cy="51" r="5" fill={glow} />
            <circle cx="50.5" cy="49.5" r="1.6" fill="#fff" />
            <circle cx="72.5" cy="49.5" r="1.6" fill="#fff" />
          </>
        )}
        {eyes === 1 && <rect x="42" y="47" width="36" height="8" rx="4" fill={glow} />}
        {eyes === 2 && (
          <>
            <path d="M43 53q6-7 12 0" fill="none" stroke={glow} strokeWidth="3.2" strokeLinecap="round" />
            <path d="M65 53q6-7 12 0" fill="none" stroke={glow} strokeWidth="3.2" strokeLinecap="round" />
          </>
        )}
        {eyes === 3 && (
          <>
            <ellipse cx="49" cy="51" rx="3.6" ry="6" fill={glow} />
            <ellipse cx="71" cy="51" rx="3.6" ry="6" fill={glow} />
          </>
        )}
        <path d="M53 61q7 5 14 0" fill="none" stroke={glow} strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="40" cy="61" r="3" fill={main} opacity="0.5" />
        <circle cx="80" cy="61" r="3" fill={main} opacity="0.5" />
      </g>
    </svg>
  );
}
