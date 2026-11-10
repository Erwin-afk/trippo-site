/*
 * Accountant invite codes: 10 characters from Crockford's base32 (no I, L, O or U), so 50 random bits,
 * shown as ABCDE-FGHJK. Typed by hand from paper, so reading is forgiving: case, spaces and dashes
 * don't matter, O reads as 0 and I or L as 1, and a whole invite link works too.
 * No imports, so the same file runs everywhere: site/invite-code.js and
 * supabase/functions/_shared/invite-code.js are exact copies of this file, and a test fails if they drift.
 */

export const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_LENGTH = 10;
export const INVITE_PATH = '/meghivo/';

/** A code from 10 random bytes (32 divides 256, so every character is equally likely). */
export function inviteCodeFromBytes(bytes) {
  if (!bytes || bytes.length < INVITE_LENGTH) throw new Error('need 10 random bytes');
  let code = '';
  for (let i = 0; i < INVITE_LENGTH; i++) code += INVITE_ALPHABET[bytes[i] & 31];
  return code;
}

/** The stored form (10 characters, no dash) of whatever was typed, pasted or opened; null if it isn't a code. */
export function normalizeInviteCode(input) {
  if (typeof input !== 'string' || input.length > 200) return null;
  let text = input.trim();
  const at = text.toLowerCase().lastIndexOf(INVITE_PATH);
  if (at >= 0) text = text.slice(at + INVITE_PATH.length);
  text = text.split(/[?#]/)[0];
  const code = text
    .toUpperCase()
    .replace(/[\s\-\u2013.\/]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (code.length !== INVITE_LENGTH) return null;
  for (const c of code) if (!INVITE_ALPHABET.includes(c)) return null;
  return code;
}

/** How people see a code: ABCDE-FGHJK. */
export function formatInviteCode(code) {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** The link on paper and in e-mails; the page shows the office and the code to type into the app. */
export function inviteUrl(code, site = 'https://trippo.hu') {
  return `${site}${INVITE_PATH}${formatInviteCode(code)}`;
}

/** A name shown to someone else (an office, a client): one line, no control or direction characters, at most 80. */
export function cleanDisplayName(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
