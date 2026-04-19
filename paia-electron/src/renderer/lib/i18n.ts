// Tiny i18n runtime.
//
// Design goals:
//   - Zero deps. Strings are plain TS objects that esbuild tree-shakes.
//   - Dotted-key lookups: `t('panel.close')`.
//   - Strict-by-construction: non-English locales are typed as
//     `DeepPartial<Strings>` so partial translations compile cleanly
//     and missing keys fall back to English at runtime.
//   - React-friendly: the singleton emits a change event whenever the
//     user switches locales, and a hook subscribes components to it.
//
// Extraction workflow for future contributors:
//   1. Add the new key to `locales/en.ts` (mandatory — that's the base).
//   2. Translate it in whatever languages you can; leave the key out
//      of any language you can't translate yet (English fallback
//      kicks in automatically).

import { useSyncExternalStore } from 'react';
import type { LocaleId } from '../../shared/types';
import { en, type Strings } from '../locales/en';
import { es } from '../locales/es';
import { fr } from '../locales/fr';
import { de } from '../locales/de';
import { hi } from '../locales/hi';
import { ja } from '../locales/ja';
import { zh } from '../locales/zh';

/**
 * `DeepPartial` for translations. String leaves widen to `string` rather
 * than retaining their English literal — otherwise `"Join"` would reject
 * `"Unirse"` since the base catalog is declared `as const`.
 */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string
    ? string
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

const catalogs: Record<LocaleId, DeepPartial<Strings>> = {
  en,
  es,
  fr,
  de,
  hi,
  ja,
  zh,
};

export const AVAILABLE_LOCALES: { id: LocaleId; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'fr', label: 'Français' },
  { id: 'de', label: 'Deutsch' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'ja', label: '日本語' },
  { id: 'zh', label: '中文' },
];

let current: LocaleId = 'en';
const listeners = new Set<() => void>();

export function setLocale(id: LocaleId): void {
  if (id === current) return;
  current = id;
  // Set lang / dir on <html> so CSS pseudo-classes and screen readers
  // respect the active locale.
  const root = document.documentElement;
  root.setAttribute('lang', id);
  root.setAttribute('dir', 'ltr'); // none of our current locales are RTL
  for (const l of listeners) l();
}

export function getLocale(): LocaleId {
  return current;
}

function lookup(catalog: unknown, dotted: string): string | undefined {
  const parts = dotted.split('.');
  let cur: unknown = catalog;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * Translate a dotted key. Interpolates `{{name}}` placeholders from the
 * optional `vars` map. Falls back to English if the current locale is
 * missing the key, then to the key itself as a last resort so a
 * developer mistake is loud rather than silent.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const tried = lookup(catalogs[current], key) ?? lookup(catalogs.en, key) ?? key;
  if (!vars) return tried;
  return tried.replace(/\{\{(\w+)\}\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{{${name}}}`));
}

// ─── React binding ───────────────────────────────────────────────

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): LocaleId {
  return current;
}

/** Subscribes the caller component to locale changes. Returns the live `t`. */
export function useT(): { t: typeof t; locale: LocaleId } {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { t, locale };
}
