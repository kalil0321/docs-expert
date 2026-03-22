import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

interface CacheEntry {
  subdomain: string;
  cachedAt: number;
}

interface CacheData {
  entries: Record<string, CacheEntry>;
}

function getCacheDir(): string {
  const env = process.env.DOCS_EXPERT_CACHE_DIR;
  if (env) return env;
  const home = os.homedir();
  return path.join(home, ".config", "docs-expert");
}

function getCachePath(): string {
  return path.join(getCacheDir(), "subdomain-cache.json");
}

let memoryCache: CacheData | null = null;

async function loadCache(): Promise<CacheData> {
  if (memoryCache) return memoryCache;

  const cachePath = getCachePath();
  try {
    const data = await fs.readFile(cachePath, "utf-8");
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
  const cachePath = getCachePath();
  try {
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(data, null, 0), "utf-8");
  } catch {
    // Ignore write errors (e.g. permissions, disk full)
  }
}

export async function getCachedSubdomain(docsUrl: string): Promise<string | null> {
  const cache = await loadCache();
  const entry = cache.entries[docsUrl];
  return entry?.subdomain ?? null;
}

export async function setCachedSubdomain(docsUrl: string, subdomain: string): Promise<void> {
  const cache = await loadCache();
  cache.entries[docsUrl] = { subdomain, cachedAt: Date.now() };
  await saveCache(cache);
}

export async function invalidateCachedSubdomain(docsUrl: string): Promise<void> {
  const cache = await loadCache();
  delete cache.entries[docsUrl];
  await saveCache(cache);
}

export function resetCacheForTesting(): void {
  memoryCache = null;
}
