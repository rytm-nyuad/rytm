// ─── Access control ───────────────────────────────────────────────────────────
// To open access to everyone, set this to null or remove the check entirely.
// Changing this requires a redeploy.
export const ALLOWED_EMAILS: string[] | null = [
  'youssofsaleh7@gmail.com',
  'aa9656@nyu.edu',
  'mah9994@nyu.edu',
  'reniespinosa3@gmail.com',
  // add more emails here
];

/** Returns true if the email is on the allowlist (or if the allowlist is disabled). */
export function isEmailAllowed(email: string | undefined | null): boolean {
  if (!ALLOWED_EMAILS) return true; // allowlist disabled
  if (!email) return false;
  return ALLOWED_EMAILS.includes(email);
}
