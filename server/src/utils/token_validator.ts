/**
 * Cleans and sanitizes raw candidate strings from AnoBoy markup into pure Blogger video tokens.
 * Handles patterns like:
 * - /uploads/adsbatch720.php?url=AD6v5dzq...&origin=gghhssaa.blogspot.com
 * - /uploads/adsbatch720.php?url=none
 * - token=AD6v5dzq...
 *
 * @param raw - Raw string or attribute value from page
 * @returns Clean video token or null if invalid/poisoned
 */
export function cleanAnoBoyToken(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const str = raw.trim();
  if (!str) return null;

  // 1. If it's a URL query pattern like ?url=... or &url=...
  const urlParamMatch = str.match(/[?&]url=([^&'"\s]+)/i);
  let candidate = urlParamMatch ? urlParamMatch[1] : str;

  // 2. If it's a token= parameter
  const tokenParamMatch = candidate.match(/[?&]token=([^&'"\s]+)/i);
  if (tokenParamMatch) {
    candidate = tokenParamMatch[1];
  }

  // 3. Strip any query parameters or fragments if candidate still has them
  candidate = candidate.split('&')[0].split('?')[0].split('#')[0].trim();

  // 4. Validate through strict poison filter
  return isValidAnoBoyToken(candidate) ? candidate : null;
}

/**
 * Strictly verifies whether a candidate string is a genuine, non-poisoned Blogger video token.
 *
 * @param token - Token string to inspect
 * @returns True if token is valid and safe for stream resolution
 */
export function isValidAnoBoyToken(token: unknown): boolean {
  if (typeof token !== 'string') return false;
  const clean = token.trim();
  const lower = clean.toLowerCase();

  // Reject empty or common poison payloads
  if (!clean || lower === 'none' || lower === 'null' || lower === 'undefined') {
    return false;
  }

  // Reject paths, ads endpoints, or strings containing 'none'
  if (
    lower.includes('none') ||
    lower.includes('adsbatch') ||
    lower.includes('/') ||
    lower.includes('\\') ||
    lower.includes('.php') ||
    lower.includes('.html')
  ) {
    return false;
  }

  // Legitimate Blogger video tokens are Base64/alphanumeric strings >= 10 characters
  return clean.length >= 10;
}
