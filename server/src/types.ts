export interface Env {
  APP_STORAGE: KVNamespace;
  RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}

export interface StreamResolutionResult {
  success: boolean;
  source: 'anoboy' | 'doodstream' | 'unknown';
  resolvedQuality: string;
  directUrl: string;
  title?: string;
  mirrors?: Array<{
    quality: string;
    url: string;
    label?: string;
  }>;
  cachedAt?: number;
  error?: string;
}

export interface DomainHealthStatus {
  domain: string;
  status: 'ONLINE' | 'OFFLINE' | 'UNSTABLE';
  httpStatus?: number;
  lastChecked: number;
  latencyMs: number;
}

