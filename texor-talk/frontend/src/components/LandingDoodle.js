/**
 * The landing page illustration.
 *
 * Deliberately not the dashboard's. That one is a call window — the product
 * doing its job, which is the right subject for somebody already inside it.
 * This one is the idea the page is selling: people in different places joined
 * up, which is what "Talk beyond boundaries" means.
 *
 * It moves, gently. Bubbles drift, the lines between them carry a flow, the
 * sound arcs breathe. All of it is slow and small — an illustration that
 * demands attention on a page whose job is to be read has got the balance
 * wrong. It stops entirely for anybody who has asked for less motion.
 *
 * Colours are the stops of the globe in the Texor mark, taken from the CSS
 * variables the page defines, so this illustration and the brand cannot drift
 * apart.
 */

const INK = '#14213d';

/** A head and a pair of shoulders, in a bubble. */
function Bubble({ x, y, r, tint, className }) {
  return (
    <g className={className}>
      <circle cx={x} cy={y} r={r} fill="#fff" stroke={INK} strokeWidth="2.6" />
      <circle cx={x} cy={y - r * 0.18} r={r * 0.27} fill={tint} stroke={INK} strokeWidth="2.2" />
      <path
        d={`M${x - r * 0.46} ${y + r * 0.52} a${r * 0.46} ${r * 0.46} 0 0 1 ${r * 0.92} 0`}
        fill={tint}
        stroke={INK}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </g>
  );
}

export function LandingDoodle({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 480 380"
      role="img"
      aria-label="People in different places joined together on a call"
      preserveAspectRatio="xMidYMid meet"
    >
      {/*
        * The lines first, so everything else sits over them.
        *
        * Dashed and animated, which is the cheapest way to say "this is a
        * connection carrying something" rather than "this is a line".
        */}
      <g className="dd-flow" fill="none" strokeWidth="2.4" strokeLinecap="round" opacity="0.55">
        <path d="M96 96C140 120 150 140 168 156" stroke="var(--tx-orange)" />
        <path d="M392 88C352 116 340 134 320 152" stroke="var(--tx-cyan)" />
        <path d="M84 294C132 274 146 254 166 232" stroke="var(--tx-lime)" />
        <path d="M400 286C356 266 342 248 322 230" stroke="var(--tx-indigo)" />
      </g>

      {/* ── the call ── */}
      <g>
        <rect x="160" y="112" width="160" height="164" rx="20" fill="#fff" stroke={INK} strokeWidth="3" />
        <path d="M160 142h160" stroke={INK} strokeWidth="2.4" />
        <circle cx="176" cy="127" r="4" fill="var(--tx-red)" />
        <circle cx="190" cy="127" r="4" fill="var(--tx-amber)" />
        <circle cx="204" cy="127" r="4" fill="var(--tx-green)" />

        {/* the person on the call */}
        <circle cx="240" cy="188" r="23" fill="var(--tx-sky)" fillOpacity="0.28" stroke={INK} strokeWidth="2.8" />
        <path
          d="M208 254a32 32 0 0 1 64 0"
          fill="var(--tx-sky)"
          fillOpacity="0.28"
          stroke={INK}
          strokeWidth="2.8"
          strokeLinecap="round"
        />

        {/* their own picture, in the corner, as every product puts it */}
        <rect x="278" y="232" width="34" height="26" rx="6" fill="#eef2fb" stroke={INK} strokeWidth="2.2" />
        <circle cx="295" cy="242" r="4.5" fill={INK} opacity="0.45" />
        <path d="M288 254a7 7 0 0 1 14 0" fill={INK} opacity="0.45" />
      </g>

      {/* ── the voice ── */}
      <g className="dd-waves" fill="none" stroke="var(--tx-aqua)" strokeWidth="3" strokeLinecap="round">
        <path className="dd-wave dd-wave--1" d="M132 178a22 22 0 0 0 0 32" />
        <path className="dd-wave dd-wave--2" d="M116 166a40 40 0 0 0 0 56" />
        <path className="dd-wave dd-wave--3" d="M348 178a22 22 0 0 1 0 32" />
        <path className="dd-wave dd-wave--4" d="M364 166a40 40 0 0 1 0 56" />
      </g>

      {/* ── the people joining from elsewhere ── */}
      <Bubble x={72} y={74} r={30} tint="var(--tx-orange)" className="dd-float dd-float--a" />
      <Bubble x={412} y={66} r={26} tint="var(--tx-cyan)" className="dd-float dd-float--b" />
      <Bubble x={62} y={312} r={26} tint="var(--tx-lime)" className="dd-float dd-float--c" />
      <Bubble x={418} y={304} r={30} tint="var(--tx-indigo)" className="dd-float dd-float--d" />

      {/* ── marks ── */}
      <g className="dd-spark">
        <path d="M240 68v16M232 76h16" stroke="var(--tx-amber)" strokeWidth="3.2" strokeLinecap="round" fill="none" />
        <circle cx="150" cy="330" r="4.5" fill="var(--tx-mint)" />
        <circle cx="330" cy="342" r="5.5" fill="var(--tx-orange)" opacity="0.6" />
        <circle cx="440" cy="180" r="4" fill="var(--tx-red)" opacity="0.7" />
        <circle cx="38" cy="186" r="5" fill="var(--tx-indigo)" opacity="0.55" />
      </g>
    </svg>
  );
}

export default LandingDoodle;
