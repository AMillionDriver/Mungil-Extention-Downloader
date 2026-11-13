export function isValidAnoBoyToken(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const clean = token.trim().toLowerCase();
  if (!clean || clean === 'none' || clean === 'null' || clean === 'undefined') {
    return false;
  }
  return clean.length >= 10;
}

