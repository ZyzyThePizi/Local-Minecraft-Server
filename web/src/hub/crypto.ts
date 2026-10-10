// Small WebCrypto helpers for the hub: base64url, machine fingerprints, signature checks.

export const b64url = {
  encode(bytes: Uint8Array) {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text: string): Uint8Array<ArrayBuffer> {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  },
};

export const utf8 = (s: string) => new TextEncoder().encode(s);

// Same alphabet and length as the backend (Crockford base32 of the key's SHA-256).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export async function fingerprintOf(publicKey: string) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', b64url.decode(publicKey)));
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of hash) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5 && out.length < 16) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** 3HPBGX98B0YS2RPQ → 3HPB-GX98-B0YS-2RPQ */
export const groupFingerprint = (id: string) => id.match(/.{1,4}/g)?.join('-') ?? id;
export const shortFingerprint = (id: string) => `${id.slice(0, 4)}-${id.slice(4, 8)}`;

let ed25519: boolean | null = null;

/** Whether this browser can check Ed25519 signatures (Chrome 137+, Firefox 129+, Safari 17+). */
export async function canVerify() {
  if (ed25519 === null) {
    try {
      await crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'Ed25519' }, false, ['verify']);
      ed25519 = true;
    } catch {
      ed25519 = false;
    }
  }
  return ed25519;
}

export async function verifySignature(publicKey: string, signature: string, message: string) {
  const key = await crypto.subtle.importKey('raw', b64url.decode(publicKey), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'Ed25519' }, key, b64url.decode(signature), utf8(message));
}

export const randomToken = (bytes = 18) => b64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));

/** 32-bit seed for the island generator, derived from the machine id. */
export function seedOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
