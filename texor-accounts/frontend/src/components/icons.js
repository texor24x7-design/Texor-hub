/**
 * Navigation icons.
 *
 * Inline SVG at a single stroke weight, so the sidebar never waits on a
 * network request and the set stays visually consistent.
 */
const base = {
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
};

export const UserIcon = () => (
  <svg {...base}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
);

export const ShieldIcon = () => (
  <svg {...base}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
);

export const GridIcon = () => (
  <svg {...base}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);

export const CodeIcon = () => (
  <svg {...base}><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></svg>
);

export const MenuIcon = () => (
  <svg {...base} width="20" height="20"><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /></svg>
);

export const CloseIcon = () => (
  <svg {...base} width="20" height="20"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);

export const LogOutIcon = () => (
  <svg {...base}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></svg>
);

export const CameraIcon = () => (
  <svg {...base}><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
