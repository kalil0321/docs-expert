import crypto from "node:crypto";
import type { SearchResult, DocsExpertResponse, StreamEvent } from "../types.js";

const CLAUDE_API_KEY = "338b6cdd7488066de9b9dc40e996d96b11488d29ef05b56d";
const BASE_URL = "https://api.inkeep.com";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

async function detectInkeepApiKey(docsUrl: string): Promise<string> {
  const url = docsUrl.replace(/\/+$/, "");
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Failed to fetch site (${res.status})`);

  const html = await res.text();

  // Check inline scripts for apiKey
  const inlineMatch = html.match(
    /apiKey\s*[=:]\s*["']([a-f0-9]{40,50})["']/,
  );
  if (inlineMatch) return inlineMatch[1];

  // Search JS chunks for apiKey
  const dplMatch = html.match(/dpl=([a-zA-Z0-9_-]+)/);
  const dpl = dplMatch?.[1] ?? "";
  const chunkPattern = /_next\/static\/chunks\/(\d+)-([a-f0-9]+)\.js/g;
  const chunks: string[] = [];
  let chunkMatch;
  while ((chunkMatch = chunkPattern.exec(html)) !== null) {
    chunks.push(`_next/static/chunks/${chunkMatch[1]}-${chunkMatch[2]}.js`);
  }

  const origin = new URL(res.url).origin;
  for (const chunk of chunks) {
    const chunkUrl = `${origin}/${chunk}${dpl ? `?dpl=${dpl}` : ""}`;
    try {
      const r = await fetch(chunkUrl, { headers: { "User-Agent": USER_AGENT } });
      if (!r.ok) continue;
      const js = await r.text();
      if (!js.includes("inkeep")) continue;
      const keyMatch = js.match(/apiKey\s*[=:]\s*["']([a-f0-9]{40,50})["']/);
      if (keyMatch) return keyMatch[1];
    } catch { continue; }
  }

  throw new Error("Could not detect Inkeep API key from the site");
}

interface ChallengeData {
  challenge: string;
  salt: string;
  maxnumber: number;
  algorithm: string;
  signature: string;
}

function solveChallenge(data: ChallengeData): string {
  if (data.algorithm !== "SHA-256") {
    throw new Error(`Unsupported algorithm: ${data.algorithm}`);
  }

  for (let n = 0; n <= data.maxnumber; n++) {
    const hash = crypto
      .createHash("sha256")
      .update(`${data.salt}${n}`)
      .digest("hex");

    if (hash === data.challenge) {
      const solution = {
        number: n,
        algorithm: data.algorithm,
        challenge: data.challenge,
        maxnumber: data.maxnumber,
        salt: data.salt,
        signature: data.signature,
      };
      return Buffer.from(JSON.stringify(solution)).toString("base64");
    }
  }

  throw new Error("Could not solve challenge within maxnumber iterations");
}

function buildPayload(question: string, stream: boolean) {
  const messageId = `${Date.now()}-${crypto.randomUUID().slice(0, 4)}-1`;

  return {
    model: "inkeep-qa-expert",
    messages: [{ id: messageId, role: "user", content: question }],
    stream,
    tools: [
      {
        type: "function",
        function: {
          name: "provideLinks",
          description: "Provides links",
          parameters: {
            type: "object",
            properties: {
              links: {
                anyOf: [
                  {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        label: { type: ["string", "null"] },
                        url: { type: "string" },
                        title: { type: ["string", "null"] },
                        description: { type: ["string", "null"] },
                      },
                      required: ["url"],
                      additionalProperties: true,
                    },
                  },
                  { type: "null" },
                ],
              },
              text: { type: "string" },
            },
            required: ["text"],
            additionalProperties: false,
            $schema: "http://json-schema.org/draft-07/schema#",
          },
        },
      },
    ],
    tool_choice: "auto",
  };
}

async function getChallengeSolution(apiKey: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/v1/challenge`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": USER_AGENT,
      "Origin": "https://platform.claude.com",
      "Referer": "https://platform.claude.com/",
    },
  });
  if (!res.ok) throw new Error(`Challenge request failed (${res.status})`);
  const data = (await res.json()) as ChallengeData;
  return solveChallenge(data);
}

function authHeaders(apiKey: string, solution: string) {
  return {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "Origin": "https://platform.claude.com",
    "Referer": "https://platform.claude.com/",
    "Authorization": `Bearer ${apiKey}`,
    "X-Inkeep-Challenge-Solution": solution,
  };
}

export async function askClaudeDocs(
  question: string,
  apiKey = CLAUDE_API_KEY,
): Promise<DocsExpertResponse> {
  const solution = await getChallengeSolution(apiKey);
  const payload = buildPayload(question, false);
  const headers = authHeaders(apiKey, solution);

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Inkeep API error (${res.status}): ${res.statusText}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  let content = "";
  const sources: SearchResult[] = [];

  const choices = data.choices as Array<Record<string, unknown>> | undefined;
  if (choices?.[0]) {
    const msg = choices[0].message as Record<string, unknown> | undefined;
    if (msg?.content) {
      content = msg.content as string;
    }
    // Extract tool call links if present
    const toolCalls = msg?.tool_calls as Array<Record<string, unknown>> | undefined;
    if (toolCalls) {
      for (const call of toolCalls) {
        const fn = call.function as Record<string, unknown> | undefined;
        if (fn?.name === "provideLinks" && fn.arguments) {
          try {
            const args = JSON.parse(fn.arguments as string) as Record<string, unknown>;
            const links = args.links as Array<Record<string, string>> | undefined;
            if (links) {
              for (const link of links) {
                sources.push({
                  content: link.description ?? "",
                  path: link.url ?? "",
                  title: link.title ?? link.label ?? "",
                  href: link.url ?? "",
                });
              }
            }
            // Use text content from provideLinks if no direct content
            if (!content && args.text) {
              content = args.text as string;
            }
          } catch { /* ignore parse errors */ }
        }
      }
    }
  }

  return {
    content,
    messageId: "",
    searchResults: sources,
    suggestions: [],
    usage: null,
  };
}

export async function* askClaudeDocsStream(
  question: string,
  apiKey = CLAUDE_API_KEY,
): AsyncGenerator<StreamEvent> {
  const solution = await getChallengeSolution(apiKey);
  const payload = buildPayload(question, true);
  const headers = {
    ...authHeaders(apiKey, solution),
    "Accept": "text/event-stream",
  };

  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Inkeep API error (${res.status}): ${res.statusText}`);
  }

  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const textParts: string[] = [];
  const sources: SearchResult[] = [];
  let toolArgBuffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6);
        if (raw === "[DONE]") break;

        try {
          const chunk = JSON.parse(raw) as Record<string, unknown>;
          const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
          if (!choices?.[0]) continue;

          const delta = choices[0].delta as Record<string, unknown> | undefined;
          if (!delta) continue;

          const content = delta.content as string | undefined;
          if (content) {
            textParts.push(content);
            yield { type: "text", text: content };
          }

          // Accumulate tool call arguments
          const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
          if (toolCalls) {
            for (const tc of toolCalls) {
              const fn = tc.function as Record<string, unknown> | undefined;
              if (fn?.arguments) {
                toolArgBuffer += fn.arguments as string;
              }
            }
          }
        } catch { /* ignore parse errors */ }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Parse accumulated tool call for links
  if (toolArgBuffer) {
    try {
      const args = JSON.parse(toolArgBuffer) as Record<string, unknown>;
      const links = args.links as Array<Record<string, string>> | undefined;
      if (links) {
        for (const link of links) {
          sources.push({
            content: link.description ?? "",
            path: link.url ?? "",
            title: link.title ?? link.label ?? "",
            href: link.url ?? "",
          });
        }
        if (sources.length) {
          yield { type: "searchResults", results: sources };
        }
      }
      // If no text content was streamed, use the text from provideLinks
      if (textParts.length === 0 && args.text) {
        const text = args.text as string;
        textParts.push(text);
        yield { type: "text", text };
      }
    } catch { /* ignore */ }
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

// ── Generalized Inkeep provider (auto-detects API key from any site) ──────

export async function askInkeepDocs(
  docsUrl: string,
  question: string,
): Promise<DocsExpertResponse> {
  const apiKey = await detectInkeepApiKey(docsUrl);
  return askClaudeDocs(question, apiKey);
}

export async function* askInkeepDocsStream(
  docsUrl: string,
  question: string,
): AsyncGenerator<StreamEvent> {
  const apiKey = await detectInkeepApiKey(docsUrl);
  yield* askClaudeDocsStream(question, apiKey);
}
