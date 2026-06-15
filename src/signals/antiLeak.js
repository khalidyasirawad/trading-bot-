/**
 * Anti-leak watermarking using zero-width Unicode characters.
 * U+200B = ZERO WIDTH SPACE   → bit 0
 * U+200C = ZERO WIDTH NON-JOINER → bit 1
 *
 * The watermark encodes a 32-character hex hash of the subscriber ID
 * (128 bits) as a sequence of 128 invisible chars appended to the message.
 */

import crypto from 'crypto';

const BIT_0 = '​'; // zero-width space
const BIT_1 = '‌'; // zero-width non-joiner
const SEPARATOR = '‍'; // zero-width joiner (marks start/end of watermark)

/**
 * Encode a subscriberId into an invisible zero-width character string.
 * @param {string} subscriberId
 * @returns {string} invisible watermark string
 */
export function encodeWatermark(subscriberId) {
  const hash = crypto.createHash('sha256').update(String(subscriberId)).digest('hex').slice(0, 16);
  const bits = Buffer.from(hash, 'hex')
    .reduce((acc, byte) => {
      for (let i = 7; i >= 0; i--) acc.push((byte >> i) & 1);
      return acc;
    }, [])
    .map(bit => (bit === 0 ? BIT_0 : BIT_1))
    .join('');
  return SEPARATOR + bits + SEPARATOR;
}

/**
 * Decode a subscriber hash from text containing zero-width chars.
 * @param {string} text  The leaked message text
 * @returns {string|null} hex hash string, or null if no watermark found
 */
export function decodeWatermark(text) {
  const match = text.match(new RegExp(`${SEPARATOR}([${BIT_0}${BIT_1}]+)${SEPARATOR}`));
  if (!match) return null;

  const bits = match[1].split('').map(c => (c === BIT_0 ? 0 : 1));
  if (bits.length !== 64) return null;

  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = bits.slice(i, i + 4).reduce((acc, b, j) => acc | (b << (3 - j)), 0);
    hex += nibble.toString(16);
  }
  return hex;
}

/**
 * Append a watermark for a specific subscriber to a message.
 * Returns the message + invisible watermark.
 * @param {string} message
 * @param {string} subscriberId
 * @returns {string}
 */
export function applyWatermark(message, subscriberId) {
  return message + encodeWatermark(subscriberId);
}

/**
 * Strip all zero-width characters from text (for display/logging).
 * @param {string} text
 * @returns {string}
 */
export function stripWatermark(text) {
  return text.replace(/[​‌‍]/g, '');
}

/**
 * Look up which subscriber a leaked message came from.
 * Compares the decoded hash against hashes of all subscriber IDs.
 * @param {string} leakedText
 * @param {string[]} subscriberIds
 * @returns {{ subscriberId: string, hash: string } | null}
 */
export function identifyLeaker(leakedText, subscriberIds) {
  const leakedHash = decodeWatermark(leakedText);
  if (!leakedHash) return null;

  for (const id of subscriberIds) {
    const hash = crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 16);
    if (hash === leakedHash) return { subscriberId: id, hash };
  }
  return null;
}
