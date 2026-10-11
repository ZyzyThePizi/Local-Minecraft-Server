/**
 * Everything the panel shows comes in English and Hungarian. The backend keeps both and the reader
 * picks one: the hub sends its language in Accept-Language, the backend's own console prints Hungarian.
 */
export type Lang = 'en' | 'hu';

export interface Text {
  en: string;
  hu: string;
}

export const tx = (en: string, hu: string): Text => ({ en, hu });

/** A value with no translation (a file name, a mod's own message) reads the same in both. */
export const same = (s: string): Text => ({ en: s, hu: s });

export const toText = (t: Text | string): Text => (typeof t === 'string' ? same(t) : t);

export const pick = (t: Text | string, lang: Lang) => (typeof t === 'string' ? t : t[lang]);

/** The hub sends exactly "en" or "hu"; anything else (curl, an old page) reads English. */
export const langOf = (acceptLanguage: string | undefined): Lang => (/^\s*hu\b/i.test(acceptLanguage ?? '') ? 'hu' : 'en');

/** An error whose message exists in both languages. */
export class LocalError extends Error {
  text: Text;
  constructor(message: Text | string) {
    const text = toText(message);
    super(text.en);
    this.text = text;
  }
}

export const errorText = (err: unknown): Text => (err instanceof LocalError ? err.text : same(err instanceof Error ? err.message : String(err)));
