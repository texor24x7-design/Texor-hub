/**
 * Inline SVG icons.
 *
 * Drawn here rather than pulled from an icon font, because loading Material
 * Symbols would mean a request to fonts.googleapis.com on every page — and this
 * product does not reach outside itself for anything. They are plain paths on a
 * 24×24 grid, sized by `font-size` through `1em` so a button controls its own
 * icon, and filled with `currentColor` so they inherit state colours for free.
 */

const Icon = ({ children, label }) => (
  <svg
    viewBox="0 0 24 24"
    width="1em"
    height="1em"
    fill="currentColor"
    aria-hidden={label ? undefined : 'true'}
    role={label ? 'img' : undefined}
    focusable="false"
  >
    {label ? <title>{label}</title> : null}
    {children}
  </svg>
);

export const MicIcon = (props) => (
  <Icon {...props}>
    <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z" />
    <path d="M17 11a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
  </Icon>
);

export const MicOffIcon = (props) => (
  <Icon {...props}>
    <path d="M15 10.6V5a3 3 0 0 0-5.94-.6l5.9 5.9.04-.7Z" />
    <path d="M19 11h-2a4.9 4.9 0 0 1-.86 2.8l1.45 1.45A6.94 6.94 0 0 0 19 11Z" />
    <path d="M3.41 2 2 3.41l7 7V11a3 3 0 0 0 4.53 2.58l1.45 1.45A5 5 0 0 1 7 11H5a7 7 0 0 0 6 6.92V21h2v-3.08a6.86 6.86 0 0 0 2.6-.94L20.59 22 22 20.59 3.41 2Z" />
  </Icon>
);

export const CameraIcon = (props) => (
  <Icon {...props}>
    <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4Z" />
  </Icon>
);

export const CameraOffIcon = (props) => (
  <Icon {...props}>
    <path d="M21 6.5 17 10.5V7a1 1 0 0 0-1-1H9.83l11.17 11.17V6.5Z" />
    <path d="M3.41 2 2 3.41 4.59 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.2 0 .39-.06.55-.16L20.59 22 22 20.59 3.41 2Z" />
  </Icon>
);

export const PresentIcon = (props) => (
  <Icon {...props}>
    <path d="M20 3H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h6v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 14H4V5h16v12Z" />
    <path d="M12 7.5 8 11.5h2.5V15h3v-3.5H16L12 7.5Z" />
  </Icon>
);

export const PresentOffIcon = (props) => (
  <Icon {...props}>
    <path d="M2 3.41 3.41 2 22 20.59 20.59 22l-3-3H15v2H9v-2H4a2 2 0 0 1-2-2V5c0-.35.09-.68.25-.96L2 3.41ZM4 17h11.59L4 5.41V17Z" />
    <path d="M20 3a2 2 0 0 1 2 2v12c0 .2-.03.39-.09.57L7.83 3H20Z" />
  </Icon>
);

export const HangUpIcon = (props) => (
  <Icon {...props}>
    <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a.98.98 0 0 1-.7.28c-.28 0-.53-.11-.71-.29L.29 13.08A.98.98 0 0 1 0 12.37c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.66c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.66-1.85.996.996 0 0 1-.56-.9v-3.1A15.6 15.6 0 0 0 12 9Z" />
  </Icon>
);

export const PeopleIcon = (props) => (
  <Icon {...props}>
    <path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5Z" />
  </Icon>
);

export const ChatIcon = (props) => (
  <Icon {...props}>
    <path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm-2 12H6v-2h12v2Zm0-3H6V9h12v2Zm0-3H6V6h12v2Z" />
  </Icon>
);

export const InfoIcon = (props) => (
  <Icon {...props}>
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z" />
  </Icon>
);

export const CloseIcon = (props) => (
  <Icon {...props}>
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41Z" />
  </Icon>
);

export const SendIcon = (props) => (
  <Icon {...props}>
    <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2 .01 7Z" />
  </Icon>
);

export const CopyIcon = (props) => (
  <Icon {...props}>
    <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z" />
  </Icon>
);

export const CheckIcon = (props) => (
  <Icon {...props}>
    <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" />
  </Icon>
);

export const GridIcon = (props) => (
  <Icon {...props}>
    <path d="M3 3h8v8H3V3Zm10 0h8v8h-8V3ZM3 13h8v8H3v-8Zm10 0h8v8h-8v-8Z" />
  </Icon>
);

/** Sliders — the meeting's quality budget. */
export const TuneIcon = (props) => (
  <Icon {...props}>
    <path d="M3 17v2h6v-2H3ZM3 5v2h10V5H3Zm10 16v-2h8v-2h-8v-2h-2v6h2ZM7 9v2H3v2h4v2h2V9H7Zm14 4v-2H11v2h10Zm-6-4h2V7h4V5h-4V3h-2v6Z" />
  </Icon>
);

export const HomeIcon = (props) => (
  <Icon {...props}>
    <path d="M12 3 2.6 11l1.3 1.5L5 11.6V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-8.4l1.1.9 1.3-1.5L12 3Z" />
  </Icon>
);

/** Recordings — a circle in a circle, the universal record dot. */
export const RecordIcon = (props) => (
  <Icon {...props}>
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2.2a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6Zm0 3.3a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
  </Icon>
);

/** Notes — a page with lines on it. */
export const NotesIcon = (props) => (
  <Icon {...props}>
    <path d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm8 1.5V9h4.5L13 4.5ZM7 12h10v1.6H7V12Zm0 4h7v1.6H7V16Zm0-8h4v1.6H7V8Z" />
  </Icon>
);

export const BoldIcon = (props) => (
  <Icon {...props}>
    <path d="M7 4h6.2a4.3 4.3 0 0 1 2.9 7.5A4.6 4.6 0 0 1 14.2 20H7V4Zm3 2.6v4h3a2 2 0 0 0 0-4h-3Zm0 6.5v4.3h3.9a2.15 2.15 0 0 0 0-4.3H10Z" />
  </Icon>
);

export const ItalicIcon = (props) => (
  <Icon {...props}>
    <path d="M10 4h8v2.4h-2.9l-3 11.2H15V20H7v-2.4h2.9l3-11.2H10V4Z" />
  </Icon>
);

export const CodeIcon = (props) => (
  <Icon {...props}>
    <path d="m8.5 16.6-1.7 1.7L1.5 13l5.3-5.3 1.7 1.7L4.9 13l3.6 3.6Zm7 0 3.6-3.6-3.6-3.6 1.7-1.7L22.5 13l-5.3 5.3-1.7-1.7Z" />
  </Icon>
);

/** Highlighter — a marker pen with a nib. */
export const HighlightIcon = (props) => (
  <Icon {...props}>
    <path d="M15.6 2.7 21.3 8.4l-8 8-1.4-1.4-3.6 3.6H4.5l-1.8 2H2v-2.6l2-1.8v-3.8l3.6-3.6-1.4-1.4 9.4-4.7ZM6.6 17.4h1.9l2.6-2.6-1.9-1.9-2.6 2.6v1.9Z" />
  </Icon>
);

export const HeadingIcon = (props) => (
  <Icon {...props}>
    <path d="M6 4h2.6v6.5h6.8V4H18v16h-2.6v-6.9H8.6V20H6V4Z" />
  </Icon>
);

export const BulletIcon = (props) => (
  <Icon {...props}>
    <path d="M4.5 5.2a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Zm0 6.1a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4Zm0 6.1a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4ZM9 6h11v1.8H9V6Zm0 6.1h11v1.8H9v-1.8ZM9 18.2h11V20H9v-1.8Z" />
  </Icon>
);

export const TodoIcon = (props) => (
  <Icon {...props}>
    <path d="M4 4h9v2H6v12h12v-7h2v9H4V4Zm14.6.3L20 5.7l-7.3 7.3-3.4-3.4 1.4-1.4 2 2 5.9-5.9Z" />
  </Icon>
);

export const QuoteIcon = (props) => (
  <Icon {...props}>
    <path d="M7.4 6C4.9 6 3 8 3 10.5c0 2.3 1.7 4.1 3.9 4.1.3 0 .6 0 .9-.1-.5 1.7-2 3-3.8 3.4V20c3.9-.5 6.8-3.9 6.8-8.1C10.8 8.2 9.4 6 7.4 6Zm9.2 0c-2.5 0-4.4 2-4.4 4.5 0 2.3 1.7 4.1 3.9 4.1.3 0 .6 0 .9-.1-.5 1.7-2 3-3.8 3.4V20c3.9-.5 6.8-3.9 6.8-8.1C20 8.2 18.6 6 16.6 6Z" />
  </Icon>
);

export const TrashIcon = (props) => (
  <Icon {...props}>
    <path d="M9 3h6l1 1.5h4V7H4V4.5h4L9 3ZM5.5 8.5h13L17.6 21H6.4L5.5 8.5ZM10 11v7h1.6v-7H10Zm2.4 0v7H14v-7h-1.6Z" />
  </Icon>
);

export const LockIcon = (props) => (
  <Icon {...props}>
    <path d="M12 2a5 5 0 0 1 5 5v2h1.5A1.5 1.5 0 0 1 20 10.5v9A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-9A1.5 1.5 0 0 1 5.5 9H7V7a5 5 0 0 1 5-5Zm0 2.4A2.6 2.6 0 0 0 9.4 7v2h5.2V7A2.6 2.6 0 0 0 12 4.4Z" />
  </Icon>
);

export const ShareIcon = (props) => (
  <Icon {...props}>
    <path d="M18 16.1c-.8 0-1.5.3-2 .8l-7.1-4.1c.1-.3.1-.5.1-.8s0-.5-.1-.8l7-4.1c.5.5 1.3.8 2.1.8a3 3 0 1 0-3-3v.4L7.9 9.5A3 3 0 1 0 6 15a3 3 0 0 0 1.9-.7l7.1 4.2v.4a3 3 0 1 0 3-2.8Z" />
  </Icon>
);

export const SearchIcon = (props) => (
  <Icon {...props}>
    <path d="M10 3a7 7 0 1 1-4.2 12.6l-3.1 3.1-1.4-1.4 3.1-3.1A7 7 0 0 1 10 3Zm0 2.2a4.8 4.8 0 1 0 0 9.6 4.8 4.8 0 0 0 0-9.6Z" />
  </Icon>
);

export const PlusIcon = (props) => (
  <Icon {...props}>
    <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z" />
  </Icon>
);

export const RemovePersonIcon = (props) => (
  <Icon {...props}>
    <path d="M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-2.67 0-8 1.34-8 4v2h12.26A6 6 0 0 1 9 14Zm8.5-1a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM20 18h-5v-1.5h5V18Z" />
  </Icon>
);

/** A smiley, matching the "send a reaction" affordance people expect. */
export const ReactionIcon = (props) => (
  <Icon {...props}>
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <circle cx="15.5" cy="9.5" r="1.5" />
    <path d="M12 17.5c2.03 0 3.8-1.11 4.75-2.75h-9.5A5.48 5.48 0 0 0 12 17.5Z" />
  </Icon>
);

export const HandIcon = (props) => (
  <Icon {...props}>
    <path d="M13 1.5a1.5 1.5 0 0 0-3 0V10H9V3.5a1.5 1.5 0 0 0-3 0V13l-1.2-1.7a1.5 1.5 0 0 0-2.5 1.65l3.1 5.2A6 6 0 0 0 10.6 21H14a5 5 0 0 0 5-5V6.5a1.5 1.5 0 0 0-3 0V10h-1V3.5a1.5 1.5 0 0 0-3 0V10h1Z" />
  </Icon>
);

export const PinIcon = (props) => (
  <Icon {...props}>
    <path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3Z" />
  </Icon>
);

export const FullscreenIcon = (props) => (
  <Icon {...props}>
    <path d="M7 14H5v5h5v-2H7v-3Zm-2-4h2V7h3V5H5v5Zm12 7h-3v2h5v-5h-2v3ZM14 5v2h3v3h2V5h-5Z" />
  </Icon>
);

export const FullscreenExitIcon = (props) => (
  <Icon {...props}>
    <path d="M5 16h3v3h2v-5H5v2Zm3-8H5v2h5V5H8v3Zm6 11h2v-3h3v-2h-5v5Zm2-11V5h-2v5h5V8h-3Z" />
  </Icon>
);

export const MenuIcon = (props) => (
  <Icon {...props}>
    <path d="M3 18h18v-2H3v2Zm0-5h18v-2H3v2Zm0-7v2h18V6H3Z" />
  </Icon>
);

export const CalendarIcon = (props) => (
  <Icon {...props}>
    <path d="M17 3V1h-2v2H9V1H7v2H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-1ZM6 20V9h12v11H6Z" />
  </Icon>
);

export const SettingsIcon = (props) => (
  <Icon {...props}>
    <path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.62l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.58.24-1.12.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.86a.5.5 0 0 0 .12.62l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.62l1.92 3.32c.13.22.38.3.6.22l2.39-.96c.5.38 1.04.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.58-.24 1.12-.56 1.62-.94l2.39.96c.22.08.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.62l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" />
  </Icon>
);

export const VideoPlusIcon = (props) => (
  <Icon {...props}>
    <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4ZM11 15H9v-2H7v-2h2V9h2v2h2v2h-2v2Z" />
  </Icon>
);

export const ChevronIcon = (props) => (
  <Icon {...props}>
    <path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z" />
  </Icon>
);

export const MoreIcon = (props) => (
  <Icon {...props}>
    <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
  </Icon>
);

export const GridDotsIcon = (props) => (
  <Icon {...props}>
    <circle cx="6" cy="6" r="1.7" /><circle cx="12" cy="6" r="1.7" /><circle cx="18" cy="6" r="1.7" />
    <circle cx="6" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="18" cy="12" r="1.7" />
    <circle cx="6" cy="18" r="1.7" /><circle cx="12" cy="18" r="1.7" /><circle cx="18" cy="18" r="1.7" />
  </Icon>
);

/** A clock face, for "how long this has been running". */
/** A small pane in the corner of a larger one: picture-in-picture. */
export const PipIcon = (props) => (
  <Icon {...props}>
    <path d="M21 3H3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h18a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2Zm0 16H3V5h18v14Z" />
    <path d="M12 11h8v6h-8z" />
  </Icon>
);

export const ClockIcon = (props) => (
  <Icon {...props}>
    <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z" />
    <path d="M12.75 7h-1.5v5.44l4.2 2.52.75-1.24-3.45-2.07V7Z" />
  </Icon>
);

export const ShieldIcon = (props) => (
  <Icon {...props}>
    <path d="M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4Zm-1.2 15L7 12.2l1.4-1.4 2.4 2.4 5-5 1.4 1.4-6.4 6.4Z" />
  </Icon>
);

export default {
  MicIcon, MicOffIcon, CameraIcon, CameraOffIcon, PresentIcon, PresentOffIcon,
  HangUpIcon, PeopleIcon, ChatIcon, InfoIcon, CloseIcon, SendIcon, CopyIcon,
  CalendarIcon, CheckIcon, ChevronIcon, FullscreenIcon, FullscreenExitIcon, GridIcon,
  GridDotsIcon, HandIcon, MenuIcon, MoreIcon, PinIcon, SettingsIcon, VideoPlusIcon,
  ReactionIcon, RemovePersonIcon, ShieldIcon, TuneIcon, NotesIcon, BoldIcon, ItalicIcon,
  CodeIcon, HighlightIcon, HeadingIcon, BulletIcon, TodoIcon, QuoteIcon, TrashIcon,
  LockIcon, ShareIcon, SearchIcon, PlusIcon, HomeIcon, RecordIcon,
};

/* ── the ones this product needed and Texor Talk did not ─────────────────── */

export const ArchiveIcon = (props) => (
  <Icon {...props}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v2A1.5 1.5 0 0 1 18.5 9h-13A1.5 1.5 0 0 1 4 7.5v-2ZM5.5 10.5h13V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19v-8.5Zm4 2.5v1.8h5V13h-5Z" />
  </Icon>
);

export const LabelIcon = (props) => (
  <Icon {...props}>
    <path d="M3.5 6.5A2 2 0 0 1 5.5 4.5h7.2a2 2 0 0 1 1.5.7l6 6.5a1.2 1.2 0 0 1 0 1.6l-6 6.5a2 2 0 0 1-1.5.7H5.5a2 2 0 0 1-2-2v-12Zm4 1.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" />
  </Icon>
);

export const KeyIcon = (props) => (
  <Icon {...props}>
    <path d="M14 3a7 7 0 0 0-6.6 9.3L3 16.7V21h4.3l1.4-1.4V18h1.6v-1.7h1.7l1.3-1.3A7 7 0 1 0 14 3Zm2.6 5.2a1.8 1.8 0 1 1-2.5-2.5 1.8 1.8 0 0 1 2.5 2.5Z" />
  </Icon>
);

export const RestoreIcon = (props) => (
  <Icon {...props}>
    <path d="M12 5V2L7.5 6.5 12 11V8a5 5 0 1 1-5 5H4.8A7.2 7.2 0 1 0 12 5Z" />
  </Icon>
);

export const PaletteIcon = (props) => (
  <Icon {...props}>
    <path d="M12 3a9 9 0 0 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.2 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-4-4-7-9-7Zm-5 9.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm4 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm3.5 2.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
  </Icon>
);
