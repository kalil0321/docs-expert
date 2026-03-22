#!/usr/bin/env npx tsx
/**
 * Discover Mintlify-powered documentation sites.
 *
 * Strategies:
 *   1. Scrape mintlify.com/customers for listed companies
 *   2. Search GitHub for repos containing mint.json
 *   3. Probe known/candidate domains for Mintlify signatures
 *   4. Merge with existing mintlify_sites.json (dedup by domain)
 *
 * Usage:
 *   npx tsx scripts/discover-mintlify.ts              # full discovery
 *   npx tsx scripts/discover-mintlify.ts --verify-only # just verify existing entries
 *   npx tsx scripts/discover-mintlify.ts --github-only # just search GitHub
 */

import fs from "node:fs";
import path from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

interface Site {
  name: string;
  domain: string | null;
  mintlify_domain: string | null;
  verified?: boolean;
}

// ── Config ─────────────────────────────────────────────────────────────────

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const SITES_PATH = path.resolve(import.meta.dirname!, "..", "mintlify_sites.json");
const CONCURRENCY = 5;
const TIMEOUT_MS = 10_000;

// Signatures that prove a site is Mintlify-powered
const MINTLIFY_SIGNATURES = [
  /mintlify/i,
  /leaves\.mintlify\.com/,
  /_mintlify/,
  /mintlify-assets/,
  /data-subdomain=/,
  /"subdomain"\s*:\s*"/,
];

// ── Helpers ────────────────────────────────────────────────────────────────

async function fetchText(url: string, allowNonOk = false): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!allowNonOk && !res.ok) return null;
    // For non-ok responses, still return text if status isn't 404
    if (allowNonOk && res.status === 404) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function isMintlify(html: string): boolean {
  return MINTLIFY_SIGNATURES.some((sig) => sig.test(html));
}

function loadExisting(): Site[] {
  if (!fs.existsSync(SITES_PATH)) return [];
  return JSON.parse(fs.readFileSync(SITES_PATH, "utf-8")) as Site[];
}

function save(sites: Site[]) {
  // Sort by name, remove duplicates by domain
  const seen = new Set<string>();
  const deduped: Site[] = [];
  for (const site of sites) {
    const key = site.domain ?? site.mintlify_domain ?? site.name;
    if (seen.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    deduped.push(site);
  }
  deduped.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(SITES_PATH, JSON.stringify(deduped, null, 2) + "\n");
  return deduped;
}

async function runConcurrent<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ── Strategy 1: Mintlify Customers Page ────────────────────────────────────

async function scrapeCustomersPage(): Promise<Site[]> {
  console.log("\n  Strategy 1: Scraping mintlify.com/customers...");
  const sites: Site[] = [];

  const html = await fetchText("https://mintlify.com/customers");
  if (!html) {
    console.log("   ! Could not fetch customers page");
    return sites;
  }

  const caseStudyPattern = /\/customers\/([a-z0-9-]+)/gi;
  const slugs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = caseStudyPattern.exec(html)) !== null) {
    slugs.add(match[1]);
  }

  for (const slug of slugs) {
    const name = slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
    sites.push({ name, domain: null, mintlify_domain: null });
  }

  const docsUrlPattern = /https?:\/\/(?:docs|developer[s]?)\.([a-z0-9.-]+\.[a-z]+)/gi;
  while ((match = docsUrlPattern.exec(html)) !== null) {
    const domain = match[0].replace(/^https?:\/\//, "");
    const existing = sites.find(
      (s) => s.domain === domain || s.name.toLowerCase() === match![1].toLowerCase(),
    );
    if (existing) {
      existing.domain = domain;
    }
  }

  console.log(`   + Found ${sites.length} companies`);
  return sites;
}

// ── Strategy 2: GitHub Search ──────────────────────────────────────────────

async function searchGitHub(): Promise<Site[]> {
  console.log("\n  Strategy 2: Searching GitHub for mint.json...");
  const sites: Site[] = [];

  const queries = [
    "filename:mint.json mintlify",
    "filename:mint.json $schema mintlify",
    '"mintlify.com" filename:mint.json',
  ];

  for (const query of queries) {
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=100`;
    const res = await fetchText(url);
    if (!res) continue;

    try {
      const data = JSON.parse(res) as {
        items?: Array<{ repository: { full_name: string; html_url: string } }>;
      };
      if (!data.items) continue;

      for (const item of data.items) {
        const repoName = item.repository.full_name.split("/").pop() ?? "";
        const name = repoName
          .replace(/[-_]docs?$/i, "")
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());

        // Try to find docs URL from the repo
        const readmeUrl = `https://raw.githubusercontent.com/${item.repository.full_name}/HEAD/README.md`;
        const readme = await fetchText(readmeUrl);
        let domain: string | null = null;
        if (readme) {
          const docsMatch = readme.match(
            /https?:\/\/(?:docs|developer[s]?)\.([a-z0-9.-]+\.[a-z]+)/i,
          );
          if (docsMatch) {
            domain = docsMatch[0].replace(/^https?:\/\//, "");
          }
        }

        // Check for mintlify.app subdomain in mint.json
        const mintJsonUrl = `https://raw.githubusercontent.com/${item.repository.full_name}/HEAD/mint.json`;
        const mintJson = await fetchText(mintJsonUrl);
        let mintlifyDomain: string | null = null;
        if (mintJson) {
          const subdomainMatch = mintJson.match(/"subdomain"\s*:\s*"([^"]+)"/);
          if (subdomainMatch) {
            mintlifyDomain = `${subdomainMatch[1]}.mintlify.app`;
          }
        }

        if (!sites.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
          sites.push({ name, domain, mintlify_domain: mintlifyDomain });
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  console.log(`   + Found ${sites.length} repos with mint.json`);
  return sites;
}

// ── Strategy 3: Probe Candidate Domains ────────────────────────────────────

async function probeDomains(candidates: string[]): Promise<Site[]> {
  console.log(`\n  Strategy 3: Probing ${candidates.length} candidate domains...`);
  const verified: Site[] = [];

  const results = await runConcurrent(
    candidates,
    async (domain) => {
      const html = await fetchText(`https://${domain}`);
      if (html && isMintlify(html)) {
        return { domain, confirmed: true };
      }
      return { domain, confirmed: false };
    },
    CONCURRENCY,
  );

  for (const r of results) {
    if (r.confirmed) {
      const name = r.domain
        .replace(/^docs\./, "")
        .replace(/\.[a-z]+$/, "")
        .replace(/[-_]/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      verified.push({ name, domain: r.domain, mintlify_domain: null, verified: true });
    }
  }

  console.log(`   + ${verified.length} confirmed as Mintlify`);
  return verified;
}

// ── Strategy 4: Verify Existing Entries ────────────────────────────────────

async function verifyExisting(sites: Site[]): Promise<Site[]> {
  const toVerify = sites.filter((s) => s.domain && !s.verified);
  if (toVerify.length === 0) {
    console.log("\n  All entries already verified");
    return sites;
  }

  console.log(`\n  Strategy 4: Verifying ${toVerify.length} existing entries...`);
  let confirmed = 0;
  let failed = 0;

  await runConcurrent(
    toVerify,
    async (site) => {
      const html = await fetchText(`https://${site.domain}`);
      if (html && isMintlify(html)) {
        site.verified = true;
        confirmed++;
      } else {
        failed++;
      }
    },
    CONCURRENCY,
  );

  console.log(`   + ${confirmed} confirmed, ${failed} could not be verified`);
  return sites;
}

// ── Strategy 5: Brute-force common mintlify.app subdomains ─────────────────

async function bruteforceSubdomains(): Promise<Site[]> {
  console.log("\n  Strategy 5: Probing common *.mintlify.app subdomains...");

  // Also include existing known mintlify_domain subdomains to re-check
  const existingSubs = loadExisting()
    .filter((s) => s.mintlify_domain)
    .map((s) => s.mintlify_domain!.replace(/\.mintlify\.(app|dev)$/, ""));

  const hardcodedCandidates = [
    // AI / LLM companies
    "anthropic", "openai", "cohere", "mistral", "stability", "huggingface",
    "perplexity", "replicate", "together", "fireworks", "baseten", "anyscale",
    "modal", "beam", "banana", "deepgram", "assembly", "whisper", "speechmatics",
    "bland", "retell", "vocode", "vapi", "elevenlabs", "cursor", "lovable",
    "replit", "cline", "agno", "ollama", "mem0", "cognition", "decagon",
    "glean", "captions", "novita", "friendli", "groq", "cerebras", "sambanova",
    "ai21", "aleph-alpha", "databricks", "snowflake", "palantir",
    // MLOps / AI tooling
    "langchain", "langsmith", "langfuse", "braintrust", "humanloop",
    "promptlayer", "pezzo", "helicone", "wandb", "weights-and-biases",
    "labelbox", "scale", "snorkel", "cleanlab", "ray",
    // Dev tools / infra
    "vercel", "supabase", "railway", "render", "fly", "deno", "bun",
    "neon", "xata", "convex", "planetscale", "turso", "upstash",
    "clerk", "stytch", "privy", "dynamic", "magic", "web3auth",
    "resend", "loops", "sendbird", "knock", "novu", "courier",
    "trigger", "triggerdev", "inngest", "temporal", "windmill",
    "infisical", "doppler", "vault", "hashicorp",
    "flatfile", "unkey", "browserbase", "hyperbrowser",
    "axiom", "highlight", "sentry", "datadog", "grafana",
    "posthog", "amplitude", "mixpanel", "segment", "rudderstack",
    // Frameworks / libraries
    "astro", "remix", "svelte", "nuxt", "vite", "vitest",
    "drizzle", "prisma", "trpc", "hono", "elysia", "nitro",
    "payload", "directus", "medusa", "strapi", "sanity", "contentful",
    "liveblocks", "tiptap", "plate", "lexical",
    "scalar", "swagger", "stoplight", "redocly",
    // Fintech / payments
    "stripe", "coinbase", "hubspot", "paypal", "plaid", "ramp",
    "mercury", "brex", "moov", "unit", "treasury-prime", "bond",
    "sardine", "alloy", "persona", "onfido", "jumio",
    "metronome", "kalshi", "polymarket", "worldcoin",
    // Web scraping / automation
    "browserless", "crawlee", "firecrawl", "apify", "scrapingbee",
    "bright-data", "smartproxy", "zenrows", "scrapeops",
    // Auth / identity
    "supertokens", "lucia", "authjs", "arctic", "oslo", "better-auth",
    "fusionauth", "keycloak", "auth0", "okta",
    // CMS / headless
    "saleor", "vendure", "shopify", "bigcommerce", "commercetools",
    // Communication
    "twilio", "vonage", "messagebird", "telnyx", "bandwidth",
    "stream", "getstream", "ably", "pusher", "pubnub",
    // Misc dev tools
    "cal", "documenso", "formbricks", "crowd", "lago",
    "plane", "hoppscotch", "appwrite", "wrangler",
    "frigade", "vessel", "fleet", "dub", "goody", "layers",
    "meter", "mirage", "koala", "helius", "jupiter", "crossmint",
    // Additional known/likely
    "fern", "speakeasy", "stainless", "orb", "openmeter",
    "depot", "zephyr", "sst", "seed", "arc", "stack",
    "val-town", "val", "coolify", "dokploy", "kamal",
    "aiven", "timescale", "questdb", "clickhouse", "materialize",
    "pinecone", "weaviate", "qdrant", "milvus", "chroma", "zilliz",
    "buildship", "pipedream", "make", "zapier", "n8n",
    "composio", "toolhouse", "e2b", "daytona", "gitpod", "codespaces",
    "mintlify", "readme", "gitbook", "docusaurus",
    "propel", "tinybird", "rockset", "imply", "startree",
    "svix", "hookdeck", "ngrok", "tailscale", "cloudflare",
    "prefix", "ssoready", "workos", "descope",
    "dopt", "frigade", "appcues", "userflow", "chameleon",
    "knock", "magicbell", "engagespot", "notificationapi",
    "plain", "intercom", "crisp", "tawk", "chatwoot",
    "cal-com", "calendly", "savvycal", "reclaim",
    "polar", "lemon-squeezy", "paddle", "chargebee", "recurly",
    "stigg", "schematichq", "bucket", "statsig", "launchdarkly",
    "openpanel", "june", "koala-ai", "canny", "productboard",
    "linear", "shortcut", "notion", "height", "attio",
    "nango", "merge", "unified", "apideck", "vessel-api",
    "stackone", "finch", "kombo", "knit", "hot-mesh",
  ];

  // Deduplicate
  const candidates = [...new Set([...hardcodedCandidates, ...existingSubs])];

  const sites: Site[] = [];

  await runConcurrent(
    candidates,
    async (sub) => {
      const url = `https://${sub}.mintlify.app`;
      const html = await fetchText(url, true);
      if (html && isMintlify(html)) {
        const name = sub
          .replace(/[-_]/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        sites.push({
          name,
          domain: null,
          mintlify_domain: `${sub}.mintlify.app`,
          verified: true,
        });
      }
    },
    CONCURRENCY,
  );

  console.log(`   + Found ${sites.length} active mintlify.app subdomains`);
  return sites;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const verifyOnly = args.includes("--verify-only");
  const githubOnly = args.includes("--github-only");
  const bruteOnly = args.includes("--brute-only");

  console.log("Mintlify Docs Discovery Tool");
  console.log("============================");

  const existing = loadExisting();
  console.log(`Loaded ${existing.length} existing entries from mintlify_sites.json`);

  let newSites: Site[] = [];

  if (verifyOnly) {
    const verified = await verifyExisting(existing);
    save(verified);
  } else if (githubOnly) {
    newSites = await searchGitHub();
  } else if (bruteOnly) {
    newSites = await bruteforceSubdomains();
  } else {
    // Run all strategies
    const [customers, github, brute] = await Promise.all([
      scrapeCustomersPage(),
      searchGitHub(),
      bruteforceSubdomains(),
    ]);
    newSites = [...customers, ...github, ...brute];
  }

  if (!verifyOnly) {
    // Merge new sites with existing
    const merged = [...existing];
    let added = 0;

    for (const site of newSites) {
      const key = (site.domain ?? site.mintlify_domain ?? site.name).toLowerCase();
      const existingEntry = merged.find((s) => {
        const eKey = (s.domain ?? s.mintlify_domain ?? s.name).toLowerCase();
        return eKey === key || s.name.toLowerCase() === site.name.toLowerCase();
      });

      if (existingEntry) {
        if (!existingEntry.domain && site.domain) existingEntry.domain = site.domain;
        if (!existingEntry.mintlify_domain && site.mintlify_domain)
          existingEntry.mintlify_domain = site.mintlify_domain;
        if (site.verified) existingEntry.verified = true;
      } else {
        merged.push(site);
        added++;
      }
    }

    const final = save(merged);
    console.log(`\nMerged: ${final.length} total sites (${added} new)`);

    // Probe any new domains we don't have verification for
    const unverified = final.filter((s) => s.domain && !s.verified);
    if (unverified.length > 0 && !githubOnly && !bruteOnly) {
      const probed = await probeDomains(unverified.map((s) => s.domain!));
      for (const p of probed) {
        const entry = final.find((s) => s.domain === p.domain);
        if (entry) entry.verified = true;
      }
      save(final);
    }
  }

  // Print summary
  const all = loadExisting();
  console.log(`\nSummary:`);
  console.log(`   Total sites:        ${all.length}`);
  console.log(`   With custom domain: ${all.filter((s) => s.domain).length}`);
  console.log(`   With mintlify.app:  ${all.filter((s) => s.mintlify_domain).length}`);
  console.log(`   Verified:           ${all.filter((s) => s.verified).length}`);
}

main().catch(console.error);
