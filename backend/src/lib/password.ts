import argon2 from 'argon2';
import { z } from 'zod';

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain);

export const verifyPassword = (hash: string, plain: string): Promise<boolean> =>
  argon2.verify(hash, plain).catch(() => false);

/**
 * Password policy, following NCSC guidance rather than the classic
 * "one of each character class" rule — that rule pushes people toward
 * `Passw0rd!`, which satisfies every complexity requirement and is also among
 * the first things any attacker tries.
 *
 * What actually resists guessing is length and unpredictability, so we:
 *   • require a real minimum length
 *   • require variety, but let a long passphrase satisfy it instead
 *   • reject the passwords that actually appear in credential stuffing
 *   • reject anything built from the member's own name or email
 *
 * The app scores with the same rules (mirrored in lib/password_policy.dart), so
 * the strength meter can never promise something the server then rejects.
 */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200; // argon2 takes long input; cap to bound cost

/**
 * Passwords common enough that any other rule is beside the point. Not a full
 * breach corpus — production should also check Have I Been Pwned's k-anonymity
 * range API — but it catches what members actually pick.
 */
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'qwerty',
  'qwerty123', 'qwertyuiop', 'letmein', 'welcome', 'welcome1', 'iloveyou',
  'admin', 'admin123', 'football', 'monkey', 'dragon', 'sunshine', 'princess',
  'abc123', '123456', '1234567', '12345678', '123456789', '1234567890',
  '111111', '000000', 'saveondrive', 'saveondrive1', 'saveondrive123', 'liverpool',
  'arsenal', 'chelsea', 'charlie', 'trustno1', 'superman', 'batman',
]);

export interface PasswordIssue {
  code: string;
  message: string;
}

/** 0 weak · 1 fair · 2 good · 3 strong — mirrored by the app's meter. */
export type PasswordScore = 0 | 1 | 2 | 3;

/**
 * Conservative leet folding: only substitutions that can't be a real digit in a
 * password. Crucially it leaves 1/3/7 alone, so "p@ssw0rd123" folds to
 * "password123" (a known-common password) instead of "passwordi2e".
 */
function deLeetSafe(s: string): string {
  return s
    .toLowerCase()
    .replace(/@/g, 'a')
    .replace(/4/g, 'a')
    .replace(/\$/g, 's')
    .replace(/5/g, 's')
    .replace(/0/g, 'o')
    .replace(/\+/g, 't');
}

/** Aggressive folding, for words spelled entirely in leet ("l3tm31n"). */
function deLeetAggressive(s: string): string {
  return deLeetSafe(s)
    .replace(/3/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/7/g, 't');
}

/** Used for identity matching, where mangling digits doesn't matter. */
function deLeet(s: string): string {
  return deLeetAggressive(s);
}

/**
 * Is this a known-common password? Tests several normalisations, because
 * "password123", "P@ssw0rd!", "passw0rd" and "l3tm31n" are all the same few
 * passwords wearing different hats.
 */
function isCommon(pw: string): boolean {
  // A common password wears many hats: "letmein" also arrives as "L3tM3In123",
  // "l3tm31n!!!", "p@ssw0rd", "Welcome1!!". Rather than chase each disguise,
  // generate every plausible normalisation and test them all.
  //
  // Order is load-bearing in BOTH directions, which is why we do both:
  //   • "p@ssw0rd" must be folded WITH its symbols intact (@ → a).
  //   • "L3tM3In123" must have its trailing digits stripped BEFORE folding,
  //     or the aggressive 1→i rule rewrites the "1" of "123" into "i".
  const variants = new Set<string>();
  const lower = pw.toLowerCase();
  const alnum = lower.replace(/[^a-z0-9]/g, '');

  // Candidate "cores" — the word an attacker would recognise.
  const cores = [
    lower,
    alnum,
    alnum.replace(/\d+$/, ''), // password123 → password
    alnum.replace(/^\d+/, ''), // 123password → password
    alnum.replace(/^\d+|\d+$/g, ''),
  ];

  for (const core of cores) {
    for (const folded of [core, deLeetSafe(core), deLeetAggressive(core)]) {
      variants.add(folded);
      variants.add(folded.replace(/[^a-z0-9]/g, ''));
      variants.add(folded.replace(/[^a-z]/g, '')); // drop digits entirely
      variants.add(folded.replace(/[^a-z0-9]/g, '').replace(/\d+$/, ''));
    }
  }

  for (const v of variants) {
    if (v.length >= 4 && COMMON.has(v)) return true;
  }
  return false;
}

/** A run of 4+ repeated or sequential characters ("aaaa", "1234", "dcba"). */
function hasWeakRun(pw: string): boolean {
  const s = pw.toLowerCase();
  let repeat = 1;
  let asc = 1;
  let desc = 1;
  for (let i = 1; i < s.length; i++) {
    const prev = s.charCodeAt(i - 1);
    const cur = s.charCodeAt(i);
    repeat = cur === prev ? repeat + 1 : 1;
    asc = cur === prev + 1 ? asc + 1 : 1;
    desc = cur === prev - 1 ? desc + 1 : 1;
    if (repeat >= 4 || asc >= 4 || desc >= 4) return true;
  }
  return false;
}

/**
 * Validate a new password. `identity` carries the member's email and name — a
 * password containing their own address is trivially guessable however long it is.
 */
export function checkPassword(
  password: string,
  identity: { email?: string; firstName?: string; lastName?: string } = {},
): { ok: boolean; score: PasswordScore; issues: PasswordIssue[] } {
  const issues: PasswordIssue[] = [];
  const pw = password ?? '';

  if (pw.length < PASSWORD_MIN) {
    issues.push({ code: 'too_short', message: `Use at least ${PASSWORD_MIN} characters` });
  }
  if (pw.length > PASSWORD_MAX) {
    issues.push({ code: 'too_long', message: `Keep it under ${PASSWORD_MAX} characters` });
  }

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;

  // A long passphrase is strong without symbols, so only demand variety of
  // shorter passwords — "correct horse battery staple" must pass.
  if (pw.length < 16 && classes < 3) {
    issues.push({
      code: 'not_varied',
      message: 'Mix upper and lower case, numbers or symbols — or use a longer passphrase',
    });
  }

  if (isCommon(pw)) {
    issues.push({ code: 'common', message: 'This password is too common — pick something else' });
  }

  if (hasWeakRun(pw)) {
    issues.push({ code: 'sequence', message: 'Avoid runs like "1234" or "aaaa"' });
  }

  const flat = deLeet(pw);
  const parts = [
    identity.email?.split('@')[0],
    identity.firstName,
    identity.lastName,
  ]
    .filter((p): p is string => !!p && p.length >= 3)
    .map((p) => deLeet(p));
  if (parts.some((p) => flat.includes(p))) {
    issues.push({
      code: 'contains_identity',
      message: "Don't use your name or email address in your password",
    });
  }

  return { ok: issues.length === 0, score: scorePassword(pw), issues };
}

/** Strength for the meter. A hint, not the gate — checkPassword() is the gate. */
export function scorePassword(pw: string): PasswordScore {
  if (!pw || isCommon(pw) || pw.length < PASSWORD_MIN) return 0;

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (hasWeakRun(pw)) return Math.min(1, classes) as PasswordScore;

  // Length is weighted above class count on purpose: a long lowercase
  // passphrase genuinely beats a short "complex" one.
  let points = 0;
  if (pw.length >= 10) points++;
  if (pw.length >= 14) points++;
  if (pw.length >= 20) points++;
  if (pw.length >= 24) points++;
  if (classes >= 3) points++;
  if (classes === 4) points++;

  // Penalise genuine repetition ("aaaaaaaaaaab" ≈ 0.17) but not ordinary
  // English, where repeated letters are normal — "correct horse battery
  // staple" is ≈ 0.46 unique and is a genuinely strong passphrase.
  if (new Set(pw).size / pw.length < 0.35) points--;

  return Math.max(0, Math.min(3, points - 1)) as PasswordScore;
}

/**
 * Zod schema for a new password. Identity-aware checks can't live here (Zod
 * sees the field alone), so routes also call checkPassword() with the email.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX)
  .superRefine((pw, ctx) => {
    for (const issue of checkPassword(pw).issues) {
      ctx.addIssue({ code: 'custom', message: issue.message });
    }
  });
