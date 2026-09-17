/**
 * The landing illustration: a bill being made, and being paid.
 *
 * Not the app's own screens — those are the right subject once somebody is
 * inside. This is the idea the page sells: a receipt with its work on it, a
 * stamp that says the money arrived, and a coin on its way.
 *
 * Drawn in the Finvoice mark's mint over an ink outline, in the same
 * hand-drawn manner as Texor Talk's illustration so the two read as one
 * family. It moves gently, and not at all for anybody who asked for less
 * motion.
 */

const INK = '#0c1916';
const MINT = '#4addb1';
const DEEP = '#097a5e';

/** One line of an invoice: a description rule and an amount block. */
function Row({ y, width, amount = 34, faded }) {
  return (
    <g opacity={faded ? 0.45 : 1}>
      <rect x="54" y={y} width={width} height="7" rx="3.5" fill={INK} opacity="0.18" />
      <rect x={250 - amount} y={y} width={amount} height="7" rx="3.5" fill={DEEP} opacity="0.55" />
    </g>
  );
}

export function LandingDoodle({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 460 400"
      role="img"
      aria-label="An invoice with its line items, stamped paid, with a coin and a receipt beside it"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <linearGradient id="fvPaper" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#f4fbf8" />
        </linearGradient>
      </defs>

      {/* The receipt behind, echoing the Finvoice mark's curl. */}
      <g className="fvd-receipt">
        <path
          d="M292 96c0-9 7-16 16-16h74c9 0 16 7 16 16v190c0 7-8 11-13 7l-13-10-14 11c-3 2-7 2-10 0l-14-11-13 10c-6 4-14 0-14-7V96Z"
          fill="#fff" stroke={INK} strokeWidth="3" strokeLinejoin="round"
        />
        <rect x="308" y="112" width="58" height="8" rx="4" fill={MINT} />
        {[134, 152, 170, 188].map((y, i) => (
          <rect key={y} x="308" y={y} width={i % 2 ? 44 : 58} height="6" rx="3" fill={INK} opacity="0.16" />
        ))}
        <rect x="308" y="214" width="58" height="6" rx="3" fill={DEEP} opacity="0.5" />
      </g>

      {/* The invoice itself. */}
      <g className="fvd-sheet">
        <rect x="30" y="40" width="240" height="300" rx="18" fill="url(#fvPaper)" stroke={INK} strokeWidth="3.4" />

        {/* Header band: the business, and the document's name. */}
        <rect x="30" y="40" width="240" height="56" rx="18" fill={MINT} />
        <rect x="30" y="78" width="240" height="18" fill={MINT} />
        <circle cx="62" cy="68" r="13" fill="#fff" stroke={INK} strokeWidth="2.6" />
        <path d="M56 68h12M56 63h12M56 73h8" stroke={INK} strokeWidth="2.4" strokeLinecap="round" />
        <rect x="86" y="60" width="84" height="8" rx="4" fill={INK} opacity="0.7" />
        <rect x="86" y="74" width="52" height="6" rx="3" fill={INK} opacity="0.45" />

        <Row y={126} width={128} />
        <Row y={152} width={96} amount={28} />
        <Row y={178} width={140} amount={42} />
        <Row y={204} width={78} amount={26} faded />

        <path d="M54 232h192" stroke={INK} strokeWidth="2" strokeDasharray="6 7" strokeLinecap="round" opacity="0.4" />

        {/* The total, the one number anybody looks for. */}
        <rect x="150" y="248" width="96" height="30" rx="10" fill={DEEP} />
        <path d="M168 258h14m-14 5h14m-11 10 10-10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
        <rect x="192" y="259" width="38" height="8" rx="4" fill="#fff" opacity="0.92" />

        {/* A signature, drawn on. */}
        <path
          className="fvd-sign"
          d="M62 300c10-14 16 8 24-2s10-16 18-6 12 12 20 2 12-10 18-2"
          fill="none" stroke={INK} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"
        />
        <path d="M58 316h84" stroke={INK} strokeWidth="2" opacity="0.3" strokeLinecap="round" />
      </g>

      {/* PAID, stamped at an angle. */}
      <g className="fvd-stamp" transform="rotate(-13 188 196)">
        <rect x="120" y="168" width="136" height="56" rx="12" fill="none" stroke={DEEP} strokeWidth="4" opacity="0.9" />
        <rect x="128" y="176" width="120" height="40" rx="8" fill={MINT} opacity="0.22" />
        <path d="M146 198l10 11 20-24" fill="none" stroke={DEEP} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="186" y="190" width="52" height="12" rx="6" fill={DEEP} opacity="0.85" />
      </g>

      {/* A coin on its way in. */}
      <g className="fvd-coin">
        <circle cx="386" cy="66" r="30" fill={MINT} stroke={INK} strokeWidth="3" />
        <circle cx="386" cy="66" r="21" fill="none" stroke={INK} strokeWidth="2" opacity="0.5" />
        <path d="M378 56h16m-16 7h16m-12 14 12-14" stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </g>

      {/* Two small arcs, the way a hand-drawn thing shows movement. */}
      <g className="fvd-spark" stroke={DEEP} strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.75">
        <path d="M330 40c8-8 20-10 30-6" />
        <path d="M322 24c14-12 32-14 48-7" opacity="0.6" />
      </g>
    </svg>
  );
}

export default LandingDoodle;
