'use client';

import { DynamicIcon } from 'lucide-react/dynamic';

/**
 * Any lucide icon by its kebab-case name — module icons are chosen by people and
 * stored as names, so they cannot be static imports. Each icon is its own small
 * chunk, loaded when first drawn.
 */
export function Icon({ name, size, className, ...props }) {
  return <DynamicIcon name={name || 'circle'} size={size} className={className} aria-hidden="true" fallback={() => <span style={{ width: size ?? 16, height: size ?? 16, display: 'inline-block' }} />} {...props} />;
}

/** A curated set for the module icon picker. */
export const MODULE_ICONS = [
  'layout-dashboard', 'users', 'user-round', 'contact', 'building-2', 'store', 'receipt', 'receipt-indian-rupee', 'file-text', 'file-pen-line',
  'wallet', 'indian-rupee', 'credit-card', 'banknote', 'banknote-arrow-down', 'hand-coins', 'package', 'boxes', 'sparkles', 'spray-can', 'wrench', 'cog', 'shield-check',
  'calendar-check', 'calendar-clock', 'calendar-days', 'clipboard-list', 'clipboard-check', 'car', 'car-front', 'bike', 'truck', 'utensils-crossed',
  'chef-hat', 'coffee', 'armchair', 'scissors', 'tv', 'smartphone', 'laptop', 'plug', 'folder-kanban', 'kanban', 'briefcase-business', 'pen-tool',
  'megaphone', 'tag', 'tags', 'star', 'heart', 'gift', 'map-pin', 'phone', 'mail', 'message-circle', 'clock', 'timer', 'hammer', 'paintbrush',
  'shirt', 'dumbbell', 'stethoscope', 'pill', 'graduation-cap', 'book-open', 'home', 'key-round', 'warehouse', 'blocks', 'layers', 'list-checks',
];
