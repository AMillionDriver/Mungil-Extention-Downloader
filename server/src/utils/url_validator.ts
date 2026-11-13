const ALLOWED_HOSTS = new Set([
  'anoboy.ninja',
  'anoboy.at',
  'anoboy.quest',
  'anoboy.online',
  'anoboy.pro',
  'www.anoboy.at',
  'www.anoboy.ninja',
  'www.anoboy.quest',
  'doodstream.com',
  'dood.so',
  'dood.ws',
  'dood.to',
  'dood.pm',
  'dood.sh'
]);

export function validateTargetUrl(rawUrl: string, dynamicHosts?: string[]): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;

    // Check against static whitelist
    const hostname = parsed.hostname.toLowerCase();
    if (ALLOWED_HOSTS.has(hostname)) return true;

    // Check against dynamic active domains from KV
    if (dynamicHosts && dynamicHosts.map((h) => h.toLowerCase()).includes(hostname)) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

