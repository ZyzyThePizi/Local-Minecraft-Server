import { useSyncExternalStore } from 'react';

/**
 * The page speaks English by default and Hungarian on request. Texts are written next to where
 * they are used, as a pair: `t('Start', 'Indítás')`. The choice is kept in this browser.
 */
export type Lang = 'en' | 'hu';

export interface Text {
  en: string;
  hu: string;
}

export const tx = (en: string, hu: string): Text => ({ en, hu });

const KEY = 'lms-lang';
const listeners = new Set<() => void>();

function stored(): Lang {
  try {
    return localStorage.getItem(KEY) === 'hu' ? 'hu' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = stored();
document.documentElement.lang = current;

export const getLang = () => current;

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* private mode: the choice lasts until the tab closes */
  }
  for (const notify of listeners) notify();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The text in the current language. Outside React (API client, formatters) call it directly. */
export function tr(en: string, hu: string): string;
export function tr(text: Text): string;
export function tr(a: string | Text, hu?: string) {
  if (typeof a !== 'string') return a[current];
  return current === 'hu' ? (hu ?? a) : a;
}

export const useLang = () => useSyncExternalStore(subscribe, getLang);

/** Inside a component: re-renders it when the language changes and returns the translator. */
export function useT() {
  useLang();
  return tr;
}
