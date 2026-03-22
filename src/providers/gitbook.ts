import crypto from "node:crypto";
import type { SearchResult, DocsExpertResponse, StreamEvent } from "../types.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

interface GitBookSiteInfo {
  finalUrl: string;
  apiToken: string;
  spaceId: string;
  pageId: string;
  siteId: string;
  organizationId: string;
  basePath: string;
  actionHash: string;
}

// ── Extract site info from GitBook page HTML ──────────────────────────────

async function fetchSiteInfo(docsUrl: string): Promise<GitBookSiteInfo> {
  const url = docsUrl.replace(/\/+$/, "");

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch GitBook site (${res.status}): ${res.statusText}`,
    );
  }

  // Use the final URL after redirects
  const finalUrl = res.url.replace(/\/+$/, "");
  const html = await res.text();

  // Extract JWT apiToken from __next_f scripts
  const tokenMatch = html.match(
    /apiToken(?:%3A|:)(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/,
  );
  if (!tokenMatch) {
    throw new Error("Could not find GitBook API token in page HTML");
  }
  const apiToken = tokenMatch[1];

  // Decode JWT to get site info
  const payload = JSON.parse(
    Buffer.from(apiToken.split(".")[1], "base64").toString(),
  );

  const spaceId = (payload.space as string) ?? "";
  const siteId = (payload.site as string) ?? "";
  const organizationId = (payload.organization as string) ?? "";

  // Extract basePath
  const basePathMatch = html.match(/basePath(?:%3A|:)([^,%"]+)/);
  const basePath = basePathMatch
    ? decodeURIComponent(basePathMatch[1]).replace(/'/g, "")
    : "/";

  // Extract pageId from the first page reference
  const pageIdMatch = html.match(/"pageId":"([^"]+)"/);
  const pageId = pageIdMatch?.[1] ?? "";

  // Find the AI chat action hash from JS chunks
  const actionHash = await discoverActionHash(html);

  return {
    finalUrl,
    apiToken,
    spaceId,
    pageId,
    siteId,
    organizationId,
    basePath,
    actionHash,
  };
}

async function discoverActionHash(html: string): Promise<string> {
  // Find the deployment ID for constructing chunk URLs
  const dplMatch = html.match(/dpl=([a-f0-9]{40})/);
  const dpl = dplMatch?.[1] ?? "";

  // Find the static asset host
  const staticHost =
    html.match(/(https:\/\/static[^/]*\.gitbook\.com)\/_next\//)?.[1] ??
    "https://static-2v.gitbook.com";

  // Find all JS chunk URLs
  const chunkPattern = /static\/chunks\/(\d+)-([a-f0-9]+)\.js/g;
  const chunks = new Set<string>();
  let match;
  while ((match = chunkPattern.exec(html)) !== null) {
    chunks.add(`static/chunks/${match[1]}-${match[2]}.js`);
  }

  // Search chunks for the createServerReference call with streamAIChat
  for (const chunk of chunks) {
    const chunkUrl = `${staticHost}/_next/${chunk}${dpl ? `?dpl=${dpl}` : ""}`;

    try {
      const res = await fetch(chunkUrl, {
        headers: { "User-Agent": USER_AGENT },
      });
      if (!res.ok) continue;
      const js = await res.text();

      const actionMatch = js.match(
        /createServerReference\("([a-f0-9]{40,50})"[^"]*"streamAIChat/,
      );
      if (actionMatch) {
        return actionMatch[1];
      }
    } catch {
      continue;
    }
  }

  // Fallback: try the known hash
  return "405c9c6fe927bf660b75e7675a1019681e1eeda4c4";
}

// ── Parse RSC stream ──────────────────────────────────────────────────────

interface RscBlock {
  nodes?: Array<{
    leaves?: Array<{ text: string; marks?: Array<{ type: string }> }>;
  }>;
}

interface RscEvent {
  type: string;
  operation?: string;
  stepIndex?: number;
  blocks?: RscBlock[];
  toolCall?: {
    tool: string;
    query?: string;
    results?: Array<{
      type: string;
      title?: string;
      description?: string;
      pageId?: string;
      spaceId?: string;
      url?: string;
    }>;
  };
  messageId?: string;
}

function extractTextFromBlocks(blocks: RscBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (!block.nodes) continue;
    for (const node of block.nodes) {
      if (!node.leaves) continue;
      for (const leaf of node.leaves) {
        parts.push(leaf.text);
      }
    }
  }
  return parts.join("");
}

function parseRscLine(
  line: string,
): { id: string; data: unknown } | null {
  const colonIdx = line.indexOf(":");
  if (colonIdx < 0) return null;
  const id = line.slice(0, colonIdx);
  const rest = line.slice(colonIdx + 1);
  try {
    return { id, data: JSON.parse(rest) };
  } catch {
    return null;
  }
}

// ── API call ──────────────────────────────────────────────────────────────

async function postAsk(
  question: string,
  info: GitBookSiteInfo,
): Promise<Response> {
  const askUrl = `${info.finalUrl}/?ask=`;
  const sessionId = `${crypto.randomUUID()}R`;
  const visitorId = `${crypto.randomUUID()}R`;

  const body = JSON.stringify([
    {
      message: question,
      toolCall: "$undefined",
      messageContext: {
        location: { spaceId: info.spaceId, pageId: info.pageId },
      },
      previousResponseId: "$undefined",
      session: { sessionId, visitorId },
      tools: [],
      options: {
        withLinkPreviews: true,
        withToolCalls: false,
        asEmbeddable: false,
      },
    },
  ]);

  const res = await fetch(askUrl, {
    method: "POST",
    headers: {
      "Accept": "text/x-component",
      "Content-Type": "text/plain;charset=UTF-8",
      "Next-Action": info.actionHash,
      "User-Agent": USER_AGENT,
    },
    body,
  });

  if (!res.ok) {
    throw new Error(
      `GitBook API error (${res.status}): ${res.statusText}`,
    );
  }

  return res;
}

// ── Public API ────────────────────────────────────────────────────────────

export async function askGitBookDocs(
  docsUrl: string,
  question: string,
): Promise<DocsExpertResponse> {
  const info = await fetchSiteInfo(docsUrl);
  const res = await postAsk(question, info);
  const rscText = await res.text();

  const sources: SearchResult[] = [];
  // Track the last document text per step — only the final step has the real answer
  let lastDocText = "";
  let maxStep = -1;

  for (const line of rscText.split("\n")) {
    const parsed = parseRscLine(line);
    if (!parsed) continue;
    const data = parsed.data as Record<string, unknown>;
    if (!data || typeof data !== "object" || !("event" in data)) continue;

    const event = data.event as RscEvent;

    if (event.type === "response_document" && event.blocks) {
      const step = event.stepIndex ?? 0;
      const text = extractTextFromBlocks(event.blocks);
      // Only keep text from the highest step index (the final answer)
      if (step >= maxStep) {
        maxStep = step;
        lastDocText = text;
      }
    }

    if (
      event.type === "response_tool_call" &&
      event.toolCall?.tool === "search"
    ) {
      for (const r of event.toolCall.results ?? []) {
        if (r.type === "page" && r.title) {
          sources.push({
            content: r.description ?? "",
            path: r.pageId ?? "",
            title: r.title,
            href: r.url ?? "",
          });
        }
      }
    }
  }

  const content = lastDocText;

  return {
    content: content.trim(),
    messageId: "",
    searchResults: sources,
    suggestions: [],
    usage: null,
  };
}

export async function* askGitBookDocsStream(
  docsUrl: string,
  question: string,
): AsyncGenerator<StreamEvent> {
  const info = await fetchSiteInfo(docsUrl);
  const res = await postAsk(question, info);

  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const textParts: string[] = [];
  const sources: SearchResult[] = [];
  let lastEmittedLength = 0;
  let currentStep = -1;
  let hasSearchResults = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        const parsed = parseRscLine(line);
        if (!parsed) continue;
        const data = parsed.data as Record<string, unknown>;
        if (!data || typeof data !== "object" || !("event" in data)) continue;

        const event = data.event as RscEvent;

        if (event.type === "response_document" && event.blocks) {
          const step = event.stepIndex ?? 0;
          // When we move to a new step, reset text tracking
          if (step > currentStep) {
            currentStep = step;
            lastEmittedLength = 0;
          }

          // Only emit text from the current highest step (skip early reasoning steps)
          // The first step (0) before search is reasoning; after search it's the answer
          if (step === currentStep && hasSearchResults) {
            const text = extractTextFromBlocks(event.blocks);
            if (text.length > lastEmittedLength) {
              const newText = text.slice(lastEmittedLength);
              textParts.push(newText);
              lastEmittedLength = text.length;
              yield { type: "text", text: newText };
            }
          }
        }

        if (
          event.type === "response_tool_call" &&
          event.toolCall?.tool === "search"
        ) {
          hasSearchResults = true;
          const newSources: SearchResult[] = [];
          for (const r of event.toolCall.results ?? []) {
            if (r.type === "page" && r.title) {
              const source: SearchResult = {
                content: r.description ?? "",
                path: r.pageId ?? "",
                title: r.title,
                href: r.url ?? "",
              };
              sources.push(source);
              newSources.push(source);
            }
          }
          if (newSources.length) {
            yield { type: "searchResults", results: newSources };
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield {
    type: "done",
    response: {
      content: textParts.join(""),
      messageId: "",
      searchResults: sources,
      suggestions: [],
      usage: null,
    },
  };
}
