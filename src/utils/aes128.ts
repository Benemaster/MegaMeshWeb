/**
 * AES-128-GCM helpers using the browser Web Crypto API.
 *
 * Key format  : 32 uppercase hex characters (16 bytes = 128 bits)
 * Wire format : "AES128:<base64(12-byte IV ‖ ciphertext ‖ 16-byte auth-tag)>"
 *
 * AES-128-GCM provides both confidentiality AND integrity (authenticated
 * encryption). Any bit-flip or key mismatch causes decryption to throw.
 */

const ALGO = 'AES-GCM' as const;
const KEY_BITS = 128;
const IV_BYTES = 12; // 96-bit IV recommended for GCM
export const MSG_PREFIX = 'AES128:';
export const KEY_HEX_LENGTH = 32; // 16 bytes * 2

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new RangeError('Odd-length hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach(b => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importKey(hexKey: string, usages: KeyUsage[]): Promise<CryptoKey> {
  const raw = hexToBytes(hexKey);
  // raw.buffer is an ArrayBuffer (not SharedArrayBuffer) because hexToBytes uses new Uint8Array(n)
  return crypto.subtle.importKey('raw', raw.buffer as ArrayBuffer, { name: ALGO, length: KEY_BITS }, false, usages);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 128-bit key as 32 uppercase hex chars.
 * Uses browser Web Crypto, NOT Math.random or Arduino random().
 */
export function generateKeyHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Returns true if the string looks like a valid 32-char AES-128 hex key. */
export function isValidKeyHex(hex: string): boolean {
  return /^[0-9A-Fa-f]{32}$/.test(hex);
}

/** Returns true if a message was encrypted with encryptMessage(). */
export function isEncryptedMessage(message: string): boolean {
  return message.startsWith(MSG_PREFIX);
}

/**
 * AES-128-GCM encrypt.
 * Returns a string of the form  "AES128:<base64>"  where the base64 payload is
 *   [ 12-byte IV ‖ N-byte ciphertext ‖ 16-byte GCM auth-tag ]
 *
 * Overhead vs. plaintext: 28 bytes + ~33 % base64 expansion + 7-char prefix.
 * A 100-char message becomes ≈ 171 chars — fits within the 180-byte firmware limit.
 */
export async function encryptMessage(plaintext: string, peerKeyHex: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await importKey(peerKeyHex, ['encrypt']);
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuf = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);

  // Pack: IV (12) ‖ ciphertext+tag
  const combined = new Uint8Array(IV_BYTES + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), IV_BYTES);

  return MSG_PREFIX + toBase64(combined);
}

/**
 * AES-128-GCM decrypt.
 * Returns the plaintext string, or null if:
 *  – the message does not carry the AES128 prefix
 *  – the key is wrong
 *  – the ciphertext has been tampered with (GCM auth-tag mismatch)
 */
export async function decryptMessage(message: string, senderKeyHex: string): Promise<string | null> {
  if (!message.startsWith(MSG_PREFIX)) return null;

  try {
    const combined = fromBase64(message.slice(MSG_PREFIX.length));
    if (combined.length < IV_BYTES + 16) return null; // too short to be valid

    const iv = combined.slice(0, IV_BYTES);
    const cipherWithTag = combined.slice(IV_BYTES);

    const key = await importKey(senderKeyHex, ['decrypt']);
    const plainBuf = await crypto.subtle.decrypt({ name: ALGO, iv }, key, cipherWithTag);
    return new TextDecoder().decode(plainBuf);
  } catch {
    // Wrong key or tampered message — return null, never throw to caller
    return null;
  }
}
