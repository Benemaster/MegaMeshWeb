/**
 * AES-128 key management helpers for the MegaMesh web client.
 *
 * Key format: 32 uppercase hex characters (16 bytes = 128 bits).
 *
 * The actual AES-128-CTR encryption / decryption is handled by the ESP32
 * firmware.  The web client only manages keys and syncs them to the firmware
 * via serial / BLE commands (/mykey set, /key set).
 */

export const KEY_HEX_LENGTH = 32; // 16 bytes * 2

/**
 * Generate a cryptographically random 128-bit key as 32 uppercase hex chars.
 * Uses browser Web Crypto (secure random).
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
