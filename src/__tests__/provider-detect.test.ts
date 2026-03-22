import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectProvider,
  resolveProvider,
  getCachedProvider,
  setCachedProvider,
  invalidateCachedProvider,
  resetProviderCacheForTesting,
} from "../provider-detect.js";

beforeEach(() => {
  vi.restoreAllMocks();
  resetProviderCacheForTesting();
  process.env.DOCS_EXPERT_CACHE_DIR = path.join(
    os.tmpdir(),
    `docs-expert-detect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
});

function mockHtml(html: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(html),
    }),
  );
}

describe("detectProvider", () => {
  it("detects Mintlify from _mintlify asset path", async () => {
    mockHtml('<link href="/_mintlify/styles.css"/>');
    expect(await detectProvider("https://docs.example.com")).toBe("mintlify");
  });

  it("detects Mintlify from mintlify.app subdomain", async () => {
    mockHtml('<script src="https://test.mintlify.app/script.js"></script>');
    expect(await detectProvider("https://docs.example.com")).toBe("mintlify");
  });

  it("detects Mintlify from leaves.mintlify API", async () => {
    mockHtml("leaves.mintlify.com/api");
    expect(await detectProvider("https://docs.example.com")).toBe("mintlify");
  });

  it("detects GitBook from static.gitbook.com", async () => {
    mockHtml('<link href="https://static.gitbook.com/assets/style.css"/>');
    expect(await detectProvider("https://docs.example.com")).toBe("gitbook");
  });

  it("detects GitBook from gitbook.com/_next", async () => {
    mockHtml('<script src="https://app.gitbook.com/_next/chunk.js"></script>');
    expect(await detectProvider("https://docs.example.com")).toBe("gitbook");
  });

  it("detects Fern from buildwithfern", async () => {
    mockHtml("<!-- Built with buildwithfern -->");
    expect(await detectProvider("https://docs.example.com")).toBe("fern");
  });

  it("detects Fern from fern-docs path", async () => {
    mockHtml('/api/fern-docs/search');
    expect(await detectProvider("https://docs.example.com")).toBe("fern");
  });

  it("detects ReadMe from powered by readme", async () => {
    mockHtml("<footer>Powered by ReadMe</footer>");
    expect(await detectProvider("https://docs.example.com")).toBe("readme");
  });

  it("detects ReadMe from readme-header", async () => {
    mockHtml('<div class="readme-header">Header</div>');
    expect(await detectProvider("https://docs.example.com")).toBe("readme");
  });

  it("detects Inkeep from inkeep script", async () => {
    mockHtml('<script src="https://cdn.inkeep-widget.js"></script>');
    expect(await detectProvider("https://docs.example.com")).toBe("inkeep");
  });

  it("falls back to mintlify on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    expect(await detectProvider("https://docs.example.com")).toBe("mintlify");
  });

  it("prefers Mintlify over Inkeep when both present (Inkeep as widget)", async () => {
    mockHtml(`
      <link href="/_mintlify/styles.css"/>
      <script src="https://cdn.inkeep.js"></script>
      inkeep widget
    `);
    expect(await detectProvider("https://docs.example.com")).toBe("mintlify");
  });

  it("falls back to mintlify on empty HTML", async () => {
    mockHtml("");
    expect(await detectProvider("https://docs.example.com")).toBe("mintlify");
  });
});

describe("provider cache", () => {
  it("returns null for uncached URL", async () => {
    expect(await getCachedProvider("https://docs.example.com")).toBeNull();
  });

  it("caches and retrieves a provider", async () => {
    await setCachedProvider("https://docs.example.com", "fern");
    expect(await getCachedProvider("https://docs.example.com")).toBe("fern");
  });

  it("normalizes trailing slashes", async () => {
    await setCachedProvider("https://docs.example.com/", "gitbook");
    expect(await getCachedProvider("https://docs.example.com")).toBe("gitbook");
  });

  it("invalidates cached provider", async () => {
    await setCachedProvider("https://docs.example.com", "readme");
    await invalidateCachedProvider("https://docs.example.com");
    expect(await getCachedProvider("https://docs.example.com")).toBeNull();
  });

  it("persists to disk across memory resets", async () => {
    await setCachedProvider("https://docs.example.com", "fern");
    resetProviderCacheForTesting();
    expect(await getCachedProvider("https://docs.example.com")).toBe("fern");
  });
});

describe("resolveProvider", () => {
  it("returns cached provider without fetching", async () => {
    await setCachedProvider("https://docs.example.com", "gitbook");
    vi.stubGlobal("fetch", vi.fn());

    const result = await resolveProvider("https://docs.example.com");
    expect(result.provider).toBe("gitbook");
    expect(result.fromCache).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("detects and caches when not cached", async () => {
    mockHtml('<link href="/_mintlify/styles.css"/>');

    const result = await resolveProvider("https://docs.example.com");
    expect(result.provider).toBe("mintlify");
    expect(result.fromCache).toBe(false);

    // Should be cached now
    expect(await getCachedProvider("https://docs.example.com")).toBe("mintlify");
  });
});
