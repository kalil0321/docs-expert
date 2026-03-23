import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ProviderName = "mintlify" | "gitbook" | "fern" | "readme" | "inkeep";

// ── Cache ──────────────────────────────────────────────

interface CacheEntry {
  provider: ProviderName;
  cachedAt: number;
}

interface CacheData {
  entries: Record<string, CacheEntry>;
}

function getCacheDir(): string {
  const env = process.env.DOCS_EXPERT_CACHE_DIR;
  if (env) return env;
  return path.join(os.homedir(), ".config", "docs-expert");
}

function getCachePath(): string {
  return path.join(getCacheDir(), "provider-cache.json");
}

let memoryCache: CacheData | null = null;

async function loadCache(): Promise<CacheData> {
  if (memoryCache) return memoryCache;

  try {
    const data = await fs.readFile(getCachePath(), "utf-8");
    const parsed = JSON.parse(data) as CacheData;
    if (parsed.entries && typeof parsed.entries === "object") {
      memoryCache = parsed;
      return memoryCache;
    }
  } catch {
    // File missing or invalid
  }

  memoryCache = { entries: {} };
  return memoryCache;
}

async function saveCache(data: CacheData): Promise<void> {
  memoryCache = data;
  const cacheDir = getCacheDir();
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(getCachePath(), JSON.stringify(data, null, 0), "utf-8");
  } catch {
    // Ignore write errors
  }
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function getCachedProvider(url: string): Promise<ProviderName | null> {
  const cache = await loadCache();
  const entry = cache.entries[normalizeUrl(url)];
  return entry?.provider ?? null;
}

export async function setCachedProvider(url: string, provider: ProviderName): Promise<void> {
  const cache = await loadCache();
  cache.entries[normalizeUrl(url)] = { provider, cachedAt: Date.now() };
  await saveCache(cache);
}

export async function invalidateCachedProvider(url: string): Promise<void> {
  const cache = await loadCache();
  delete cache.entries[normalizeUrl(url)];
  await saveCache(cache);
}

export function resetProviderCacheForTesting(): void {
  memoryCache = null;
}

// ── Detection ──────────────────────────────────────────

/**
 * Score-based provider detection.
 *
 * Each provider gets a score based on how specific the matching signals are.
 * Structural markers (asset paths, API endpoints, script sources) score higher
 * than generic keyword mentions which may appear in page content or as embedded
 * third-party widgets (e.g. Mintlify sites often embed Inkeep for search).
 */
export async function detectProvider(url: string): Promise<ProviderName> {
  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "docs-expert" },
      redirect: "follow",
    });
    html = await res.text();
  } catch {
    return "mintlify"; // fallback on network error
  }

  const lower = html.toLowerCase();

  const scores: Record<ProviderName, number> = {
    mintlify: 0,
    gitbook: 0,
    fern: 0,
    readme: 0,
    inkeep: 0,
  };

  // ── Mintlify signals ──
  // Strong structural markers
  if (lower.includes("_mintlify"))          scores.mintlify += 10; // asset path like /_mintlify/
  if (lower.includes("mintlify.app"))       scores.mintlify += 10; // subdomain pattern
  if (lower.includes("leaves.mintlify"))    scores.mintlify += 10; // Mintlify API host
  if (lower.includes("mintcdn.com"))        scores.mintlify += 10; // Mintlify CDN assets
  // Weaker signals
  if (lower.includes("mintlify"))           scores.mintlify += 2;  // generic mention (footer, etc.)

  // ── Fern signals ──
  if (lower.includes("buildwithfern"))      scores.fern += 10;
  if (lower.includes("fern-docs"))          scores.fern += 10; // API path /api/fern-docs/
  if (lower.includes("fern.docs"))          scores.fern += 5;

  // ── GitBook signals ──
  if (lower.includes("static.gitbook.com")) scores.gitbook += 10; // CDN assets
  if (lower.includes("gitbook.com/_next"))  scores.gitbook += 10; // Next.js GitBook app
  if (/apitoken[:%]/.test(lower) && lower.includes("gitbook"))
                                            scores.gitbook += 8;  // JWT token pattern
  // Weaker — "gitbook" alone could appear in content
  if (lower.includes("gitbook"))            scores.gitbook += 2;

  // ── ReadMe signals ──
  if (lower.includes("powered by readme"))  scores.readme += 10;
  if (lower.includes("readme-header"))      scores.readme += 8;
  if (/"subdomain"\s*:\s*"/.test(html) && lower.includes("readme"))
                                            scores.readme += 8;
  // readme.com alone is weak — pages may link to readme.com in content
  if (lower.includes("readme.com"))         scores.readme += 2;

  // ── Inkeep signals ──
  // Inkeep is often embedded as a widget in other providers (especially Mintlify).
  // Only treat as primary provider when no stronger provider is detected.
  if (/inkeep[^"]*\.js/.test(lower))        scores.inkeep += 5;  // script source
  if (lower.includes("inkeep"))             scores.inkeep += 2;  // generic mention

  // ── Pick winner ──
  let best: ProviderName = "mintlify";
  let bestScore = 0;

  for (const [name, score] of Object.entries(scores) as [ProviderName, number][]) {
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }

  return best;
}

// ── Resolver ───────────────────────────────────────────

export interface ResolveResult {
  provider: ProviderName;
  fromCache: boolean;
}

export async function resolveProvider(url: string): Promise<ResolveResult> {
  const cached = await getCachedProvider(url);
  if (cached) return { provider: cached, fromCache: true };

  const provider = await detectProvider(url);
  await setCachedProvider(url, provider);
  return { provider, fromCache: false };
}
