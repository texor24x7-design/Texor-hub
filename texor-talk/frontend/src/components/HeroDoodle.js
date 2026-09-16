/**
 * The illustration on the dashboard.
 *
 * Drawn rather than photographed, for three reasons that matter more than
 * taste: it is a few kilobytes of markup instead of a few hundred of JPEG, it
 * is sharp at any size and on any screen, and it takes its colours from the
 * product rather than from whatever a stock photographer's lighting happened to
 * be. A warm stock photo next to a cool blue interface always looks borrowed.
 *
 * The palette is the logo's own — periwinkle, red and orange from
 * `Talk Icon SVG.svg` — with green and yellow completing the set. They appear
 * here, in decoration, and not on controls: red and orange on a button mean
 * destructive and warning, and that meaning is worth protecting.
 */

const INK = '#1f2b46';
const BLUE = '#6187ce';
const RED = '#fb0102';
const ORANGE = '#fa5908';
const GREEN = '#12a05f';
const YELLOW = '#f5b800';

/** One person: a head and a pair of shoulders. Nothing more is needed. */
function Figure({ x, y, tint }) {
  return (
    <g stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none">
      <circle cx={x} cy={y - 9} r="7.5" fill={tint} />
      <path d={`M${x - 13} ${y + 17} a13 13 0 0 1 26 0`} fill={tint} />
    </g>
  );
}

export function HeroDoodle({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 420 300"
      role="img"
      aria-label="People meeting on a video call"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* A soft ground, so the line art is not floating on flat white. */}
      <path
        d="M52 84c14-42 66-64 118-58 44 5 60 30 106 34 44 4 82 18 90 54 9 40-22 76-72 88-58 14-108 4-160-6-52-10-96-56-82-112Z"
        fill="#eaf0fb"
      />

      {/* ── the call window ── */}
      <g>
        <rect x="62" y="58" width="236" height="166" rx="18" fill="#fff" stroke={INK} strokeWidth="3" />
        <path d="M62 86h236" stroke={INK} strokeWidth="2.4" />
        {/* Three lights, three of the four colours, where every window has them. */}
        <circle cx="80" cy="72" r="4.5" fill={RED} />
        <circle cx="95" cy="72" r="4.5" fill={YELLOW} />
        <circle cx="110" cy="72" r="4.5" fill={GREEN} />

        {/* four participants */}
        {[
          { x: 78, y: 98, tint: '#eaf0fb' },
          { x: 188, y: 98, tint: '#fdeee6' },
          { x: 78, y: 160, tint: '#e8f6ef' },
          { x: 188, y: 160, tint: '#fdf4dd' },
        ].map((tile) => (
          <rect
            key={`${tile.x}-${tile.y}`}
            x={tile.x}
            y={tile.y}
            width="102"
            height="54"
            rx="10"
            fill={tile.tint}
            stroke={INK}
            strokeWidth="2.4"
          />
        ))}

        <Figure x={129} y={127} tint="#fff" />
        <Figure x={239} y={127} tint="#fff" />
        <Figure x={129} y={189} tint="#fff" />
        <Figure x={239} y={189} tint="#fff" />

        {/* The speaker, ringed the way the product rings them. */}
        <rect x="78" y="98" width="102" height="54" rx="10" fill="none" stroke={BLUE} strokeWidth="3" />
      </g>

      {/* ── a message arriving ── */}
      <g>
        <rect x="292" y="36" width="96" height="58" rx="16" fill="#fff" stroke={ORANGE} strokeWidth="3" />
        <path d="M312 94l-4 16 18-16" fill="#fff" stroke={ORANGE} strokeWidth="3" strokeLinejoin="round" />
        <circle cx="318" cy="64" r="4.5" fill={ORANGE} />
        <circle cx="338" cy="64" r="4.5" fill={ORANGE} opacity="0.55" />
        <circle cx="358" cy="64" r="4.5" fill={ORANGE} opacity="0.3" />
      </g>

      {/* ── the microphone, which is the mark ── */}
      <g stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round">
        <circle cx="44" cy="216" r="30" fill="#fff" />
        <rect x="37" y="200" width="14" height="22" rx="7" fill={BLUE} stroke={INK} strokeWidth="2.6" />
        <path d="M31 219a13 13 0 0 0 26 0" />
        <path d="M44 232v7M37 239h14" />
      </g>

      {/* ── a plant, because every desk has one ── */}
      <g stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none">
        <path d="M352 268V236" />
        <path d="M352 244c-14-2-22-12-21-26 14-1 23 9 21 26Z" fill="#e8f6ef" />
        <path d="M352 250c13-3 20-13 18-27-14 0-21 11-18 27Z" fill={GREEN} fillOpacity="0.25" />
        <path d="M335 268h34l-4 20h-26l-4-20Z" fill="#fdeee6" />
      </g>

      {/* ── the scattered marks that make a doodle a doodle ── */}
      <g strokeLinecap="round" strokeWidth="3" fill="none">
        <path d="M338 128l0 14M331 135l14 0" stroke={YELLOW} />
        <path d="M26 118l0 11M20.5 123.5l11 0" stroke={RED} />
        <circle cx="308" cy="196" r="4" fill={BLUE} stroke="none" />
        <circle cx="34" cy="160" r="3.5" fill={GREEN} stroke="none" />
        <circle cx="396" cy="158" r="5" fill={ORANGE} stroke="none" opacity="0.5" />
        <path d="M282 244c10 6 22 6 32 0" stroke={BLUE} strokeWidth="2.6" />
      </g>
    </svg>
  );
}

export default HeroDoodle;
