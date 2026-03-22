import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => {
  vi.restoreAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────

function makeTextResponse(text: string) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(text),
  });
}

function makeJsonResponse(data: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function makeStreamBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const text = lines.join("\n") + "\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function makeStreamResponse(lines: string[]) {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(lines.join("\n") + "\n"),
    body: makeStreamBody(lines),
  });
}

function makeErrorResponse(status: number, statusText: string) {
  return Promise.resolve({
    ok: false,
    status,
    statusText,
  });
}

// ── Better Auth ──────────────────────────────────────────────────────────

describe("better-auth", () => {
  it("askBetterAuthDocs parses SSE text and sources", async () => {
    const sseLines = [
      'data: {"type":"text","text":"Better Auth is "}',
      'data: {"type":"text","text":"an auth library."}',
      'data: {"type":"source","title":"Introduction","url":"https://better-auth.com/docs/introduction"}',
      "data: [DONE]",
    ];

    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeTextResponse(sseLines.join("\n"))));

    const { askBetterAuthDocs } = await import("../providers/better-auth.js");
    const res = await askBetterAuthDocs("What is Better Auth?");

    expect(res.content).toBe("Better Auth is an auth library.");
    expect(res.searchResults).toHaveLength(1);
    expect(res.searchResults[0].title).toBe("Introduction");
    expect(res.searchResults[0].href).toBe("https://better-auth.com/docs/introduction");
  });

  it("askBetterAuthDocs throws on API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeErrorResponse(500, "Internal Server Error")));

    const { askBetterAuthDocs } = await import("../providers/better-auth.js");
    await expect(askBetterAuthDocs("test")).rejects.toThrow("Better Auth API error (500)");
  });

  it("askBetterAuthDocs throws on SSE error event", async () => {
    const sseLines = ['data: {"type":"error","errorText":"Rate limited"}'];
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeTextResponse(sseLines.join("\n"))));

    const { askBetterAuthDocs } = await import("../providers/better-auth.js");
    await expect(askBetterAuthDocs("test")).rejects.toThrow("Rate limited");
  });

  it("askBetterAuthDocsStream yields text and done events", async () => {
    const sseLines = [
      'data: {"type":"text","text":"Hello "}',
      'data: {"type":"text","text":"world"}',
      'data: {"type":"source","title":"Docs","url":"https://better-auth.com/docs"}',
      "data: [DONE]",
    ];

    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeStreamResponse(sseLines)));

    const { askBetterAuthDocsStream } = await import("../providers/better-auth.js");
    const events = [];
    for await (const e of askBetterAuthDocsStream("test")) {
      events.push(e);
    }

    expect(events.filter((e) => e.type === "text")).toHaveLength(2);
    expect(events.filter((e) => e.type === "searchResults")).toHaveLength(1);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.response.content).toBe("Hello world");
    }
  });

  it("askBetterAuthDocsStream throws on missing body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body: null }),
    );

    const { askBetterAuthDocsStream } = await import("../providers/better-auth.js");
    await expect(async () => {
      for await (const _ of askBetterAuthDocsStream("test")) { /* drain */ }
    }).rejects.toThrow("No response body");
  });

  it("askBetterAuthDocsStream throws on API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeErrorResponse(500, "Server Error")));

    const { askBetterAuthDocsStream } = await import("../providers/better-auth.js");
    await expect(async () => {
      for await (const _ of askBetterAuthDocsStream("test")) { /* drain */ }
    }).rejects.toThrow("Better Auth API error (500)");
  });

  it("askBetterAuthDocsStream throws on SSE error event", async () => {
    const sseLines = [
      'data: {"type":"text","text":"partial"}',
      'data: {"type":"error","errorText":"Something broke"}',
    ];
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeStreamResponse(sseLines)));

    const { askBetterAuthDocsStream } = await import("../providers/better-auth.js");
    await expect(async () => {
      for await (const _ of askBetterAuthDocsStream("test")) { /* drain */ }
    }).rejects.toThrow("Something broke");
  });
});

// ── Vercel ────────────────────────────────────────────────────────────────

describe("vercel", () => {
  it("askVercelDocs parses text-delta and tool-output-available", async () => {
    const sseLines = [
      'data: {"type":"start"}',
      'data: {"type":"text-delta","delta":"Vercel "}',
      'data: {"type":"text-delta","delta":"deploys apps."}',
      'data: {"type":"tool-output-available","toolName":"search","output":[{"title":"Deploy","url":"https://vercel.com/docs/deploy"}]}',
      'data: {"type":"finish"}',
    ];

    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeTextResponse(sseLines.join("\n"))));

    const { askVercelDocs } = await import("../providers/vercel.js");
    const res = await askVercelDocs("How to deploy?");

    expect(res.content).toBe("Vercel deploys apps.");
    expect(res.searchResults).toHaveLength(1);
    expect(res.searchResults[0].title).toBe("Deploy");
  });

  it("askVercelDocs throws on API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeErrorResponse(403, "Forbidden")));

    const { askVercelDocs } = await import("../providers/vercel.js");
    await expect(askVercelDocs("test")).rejects.toThrow("Vercel API error (403)");
  });

  it("askVercelDocsStream yields events correctly", async () => {
    const sseLines = [
      'data: {"type":"text-delta","delta":"Hi "}',
      'data: {"type":"text-delta","delta":"there"}',
      'data: {"type":"tool-output-available","output":[{"title":"Guide","url":"https://vercel.com/docs/guide"}]}',
    ];

    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeStreamResponse(sseLines)));

    const { askVercelDocsStream } = await import("../providers/vercel.js");
    const events = [];
    for await (const e of askVercelDocsStream("test")) {
      events.push(e);
    }

    expect(events.filter((e) => e.type === "text")).toHaveLength(2);
    expect(events.filter((e) => e.type === "searchResults")).toHaveLength(1);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.response.content).toBe("Hi there");
      expect(done.response.searchResults).toHaveLength(1);
    }
  });

  it("askVercelDocsStream throws on missing body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body: null }),
    );

    const { askVercelDocsStream } = await import("../providers/vercel.js");
    await expect(async () => {
      for await (const _ of askVercelDocsStream("test")) { /* drain */ }
    }).rejects.toThrow("No response body");
  });

  it("askVercelDocsStream throws on API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeErrorResponse(500, "Error")));

    const { askVercelDocsStream } = await import("../providers/vercel.js");
    await expect(async () => {
      for await (const _ of askVercelDocsStream("test")) { /* drain */ }
    }).rejects.toThrow("Vercel API error (500)");
  });
});

// ── Fern ──────────────────────────────────────────────────────────────────

describe("fern", () => {
  it("askFernDocs parses data-sources and text-delta", async () => {
    const sseLines = [
      'data: {"type":"data-sources","data":[{"title":"API Reference","url":"https://docs.example.com/api"}]}',
      'data: {"type":"text-delta","delta":"Use the "}',
      'data: {"type":"text-delta","delta":"API endpoint."}',
      'data: {"type":"finish"}',
    ];

    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeTextResponse(sseLines.join("\n"))));

    const { askFernDocs } = await import("../providers/fern.js");
    const res = await askFernDocs("https://docs.example.com", "How to use API?");

    expect(res.content).toBe("Use the API endpoint.");
    expect(res.searchResults).toHaveLength(1);
    expect(res.searchResults[0].title).toBe("API Reference");
  });

  it("askFernDocs throws on API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeErrorResponse(500, "Server Error")));

    const { askFernDocs } = await import("../providers/fern.js");
    await expect(askFernDocs("https://docs.example.com", "test")).rejects.toThrow("Fern API error (500)");
  });

  it("askFernDocsStream yields events correctly", async () => {
    const sseLines = [
      'data: {"type":"data-sources","data":[{"title":"Guide","url":"https://docs.example.com/guide"}]}',
      'data: {"type":"text-delta","delta":"Hello"}',
    ];

    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeStreamResponse(sseLines)));

    const { askFernDocsStream } = await import("../providers/fern.js");
    const events = [];
    for await (const e of askFernDocsStream("https://docs.example.com", "test")) {
      events.push(e);
    }

    expect(events.filter((e) => e.type === "text")).toHaveLength(1);
    expect(events.filter((e) => e.type === "searchResults")).toHaveLength(1);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.response.content).toBe("Hello");
    }
  });

  it("sends correct x-fern-host header", async () => {
    const sseLines = ['data: {"type":"text-delta","delta":"ok"}'];
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeTextResponse(sseLines.join("\n"))));

    const { askFernDocs } = await import("../providers/fern.js");
    await askFernDocs("https://docs.example.com/api", "test");

    expect(fetch).toHaveBeenCalledWith(
      "https://docs.example.com/docs/api/fern-docs/search/v2/chat",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-fern-host": "docs.example.com" }),
      }),
    );
  });

  it("askFernDocsStream throws on missing body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, body: null }),
    );

    const { askFernDocsStream } = await import("../providers/fern.js");
    await expect(async () => {
      for await (const _ of askFernDocsStream("https://docs.example.com", "test")) { /* drain */ }
    }).rejects.toThrow("No response body");
  });

  it("askFernDocsStream throws on API error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeErrorResponse(502, "Bad Gateway")));

    const { askFernDocsStream } = await import("../providers/fern.js");
    await expect(async () => {
      for await (const _ of askFernDocsStream("https://docs.example.com", "test")) { /* drain */ }
    }).rejects.toThrow("Fern API error (502)");
  });
});

// ── ReadMe ────────────────────────────────────────────────────────────────

describe("readme", () => {
  it("askReadMeDocs detects subdomain and returns response", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Subdomain detection page
          return makeTextResponse('"subdomain": "my-project"');
        }
        // API response
        return makeTextResponse(
          "Here is the answer. See [Guide](https://docs.example.com/guide) for more.",
        );
      }),
    );

    const { askReadMeDocs } = await import("../providers/readme.js");
    const res = await askReadMeDocs("https://docs.example.com", "How does it work?");

    expect(res.content).toContain("Here is the answer");
    expect(res.searchResults).toHaveLength(1);
    expect(res.searchResults[0].title).toBe("Guide");
    expect(res.searchResults[0].href).toBe("https://docs.example.com/guide");
  });

  it("askReadMeDocs throws on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeErrorResponse(404, "Not Found")));

    const { askReadMeDocs } = await import("../providers/readme.js");
    await expect(askReadMeDocs("https://docs.example.com", "test")).rejects.toThrow("Failed to fetch ReadMe site");
  });

  it("askReadMeDocs throws on API error", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeTextResponse('"subdomain": "test"');
        return makeErrorResponse(500, "Server Error");
      }),
    );

    const { askReadMeDocs } = await import("../providers/readme.js");
    await expect(askReadMeDocs("https://docs.example.com", "test")).rejects.toThrow("ReadMe API error (500)");
  });

  it("askReadMeDocsStream yields text and done events", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeTextResponse('"subdomain": "proj"');
        return makeTextResponse("Answer with [Link](https://example.com)");
      }),
    );

    const { askReadMeDocsStream } = await import("../providers/readme.js");
    const events = [];
    for await (const e of askReadMeDocsStream("https://docs.example.com", "test")) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events.some((e) => e.type === "searchResults")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("falls back to 'main' when no subdomain found", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeTextResponse("<html><body>No subdomain here</body></html>");
        return makeTextResponse("Answer");
      }),
    );

    const { askReadMeDocs } = await import("../providers/readme.js");
    await askReadMeDocs("https://docs.example.com", "test");

    // Second call should use "main" as subdomain
    expect(fetch).toHaveBeenCalledWith(
      "https://docs.example.com/main/chatgpt/ask",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

// ── Stripe ────────────────────────────────────────────────────────────────

describe("stripe", () => {
  it("askStripeDocs creates thread and polls for response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        // Page content fetch
        if (url.includes("/.md")) {
          return makeTextResponse("Stripe docs content");
        }
        // Create thread
        if (url.includes("/assistant/thread")) {
          return makeJsonResponse({
            thread_id: "thread-1",
            conversation_id: "conv-1",
            answerable: true,
            sources: [{ title: "Payments", url: "/payments" }],
          });
        }
        // Poll response
        if (url.includes("get-streaming-ask-summary-state")) {
          return makeJsonResponse({
            content: "Use PaymentIntents API.",
            is_complete: true,
          });
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askStripeDocs } = await import("../providers/stripe.js");
    const res = await askStripeDocs("How to create a payment?");

    expect(res.content).toBe("Use PaymentIntents API.");
    expect(res.messageId).toBe("thread-1");
    expect(res.searchResults).toHaveLength(1);
    expect(res.searchResults[0].title).toBe("Payments");
    expect(res.searchResults[0].href).toBe("https://docs.stripe.com/payments");
  });

  it("askStripeDocs handles unanswerable questions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/.md")) return makeTextResponse("");
        if (url.includes("/assistant/thread")) {
          return makeJsonResponse({
            thread_id: "thread-2",
            conversation_id: "conv-2",
            answerable: false,
            sources: [],
          });
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askStripeDocs } = await import("../providers/stripe.js");
    const res = await askStripeDocs("Unrelated question");

    expect(res.content).toContain("not answerable");
  });

  it("askStripeDocsStream yields search results and text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/.md")) return makeTextResponse("");
        if (url.includes("/assistant/thread")) {
          return makeJsonResponse({
            thread_id: "thread-3",
            conversation_id: "conv-3",
            answerable: true,
            sources: [{ title: "API", url: "https://stripe.com/docs/api" }],
          });
        }
        if (url.includes("get-streaming-ask-summary-state")) {
          return makeJsonResponse({ content: "Answer chunk.", is_complete: true });
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askStripeDocsStream } = await import("../providers/stripe.js");
    const events = [];
    for await (const e of askStripeDocsStream("test")) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "searchResults")).toBe(true);
    expect(events.some((e) => e.type === "text")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("askStripeDocsStream handles unanswerable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/.md")) return makeTextResponse("");
        if (url.includes("/assistant/thread")) {
          return makeJsonResponse({
            thread_id: "t-4",
            conversation_id: "c-4",
            answerable: false,
          });
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askStripeDocsStream } = await import("../providers/stripe.js");
    const events = [];
    for await (const e of askStripeDocsStream("test")) {
      events.push(e);
    }

    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.response.content).toContain("not answerable");
    }
  });

  it("askStripeDocs polls multiple times before completion", async () => {
    let pollCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/.md")) return makeTextResponse("");
        if (url.includes("/assistant/thread")) {
          return makeJsonResponse({
            thread_id: "t-poll",
            conversation_id: "c-poll",
            answerable: true,
            sources: [],
          });
        }
        if (url.includes("get-streaming-ask-summary-state")) {
          pollCount++;
          if (pollCount === 1) {
            return makeJsonResponse({ content: "Part 1. ", is_complete: false });
          }
          return makeJsonResponse({ content: "Part 2.", is_complete: true });
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askStripeDocs } = await import("../providers/stripe.js");
    const res = await askStripeDocs("test");
    expect(res.content).toBe("Part 1. Part 2.");
    expect(pollCount).toBe(2);
  });

  it("handles absolute source URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/.md")) return makeTextResponse("");
        if (url.includes("/assistant/thread")) {
          return makeJsonResponse({
            thread_id: "t-5",
            conversation_id: "c-5",
            answerable: false,
            sources: [{ title: "External", url: "https://example.com/doc" }],
          });
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askStripeDocs } = await import("../providers/stripe.js");
    const res = await askStripeDocs("test");
    expect(res.searchResults[0].href).toBe("https://example.com/doc");
  });
});

// ── Claude / Inkeep ──────────────────────────────────────────────────────

describe("claude", () => {
  it("askClaudeDocs solves challenge and returns response", async () => {
    // Pre-compute a challenge: sha256("salt42") to simulate
    const crypto = await import("node:crypto");
    const salt = "test-salt-";
    const number = 42;
    const challenge = crypto.createHash("sha256").update(`${salt}${number}`).digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/v1/challenge")) {
          return makeJsonResponse({
            challenge,
            salt,
            maxnumber: 100,
            algorithm: "SHA-256",
            signature: "sig-123",
          });
        }
        if (url.includes("/v1/chat/completions")) {
          return makeJsonResponse({
            choices: [
              {
                message: {
                  content: "The Agent SDK allows building agents.",
                  tool_calls: [
                    {
                      function: {
                        name: "provideLinks",
                        arguments: JSON.stringify({
                          text: "",
                          links: [
                            { title: "Agent SDK", url: "https://docs.anthropic.com/agent-sdk", label: "SDK" },
                          ],
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          });
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askClaudeDocs } = await import("../providers/claude.js");
    const res = await askClaudeDocs("What is the Agent SDK?");

    expect(res.content).toBe("The Agent SDK allows building agents.");
    expect(res.searchResults).toHaveLength(1);
    expect(res.searchResults[0].title).toBe("Agent SDK");
  });

  it("askClaudeDocs uses provideLinks text when no direct content", async () => {
    const crypto = await import("node:crypto");
    const salt = "s-";
    const challenge = crypto.createHash("sha256").update(`${salt}0`).digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/v1/challenge")) {
          return makeJsonResponse({
            challenge,
            salt,
            maxnumber: 10,
            algorithm: "SHA-256",
            signature: "sig",
          });
        }
        if (url.includes("/v1/chat/completions")) {
          return makeJsonResponse({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: "provideLinks",
                        arguments: JSON.stringify({ text: "Fallback text", links: [] }),
                      },
                    },
                  ],
                },
              },
            ],
          });
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askClaudeDocs } = await import("../providers/claude.js");
    const res = await askClaudeDocs("test");
    expect(res.content).toBe("Fallback text");
  });

  it("askClaudeDocs throws on API error", async () => {
    const crypto = await import("node:crypto");
    const salt = "s-";
    const challenge = crypto.createHash("sha256").update(`${salt}0`).digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/v1/challenge")) {
          return makeJsonResponse({
            challenge,
            salt,
            maxnumber: 10,
            algorithm: "SHA-256",
            signature: "sig",
          });
        }
        return makeErrorResponse(429, "Too Many Requests");
      }),
    );

    const { askClaudeDocs } = await import("../providers/claude.js");
    await expect(askClaudeDocs("test")).rejects.toThrow("Inkeep API error (429)");
  });

  it("askClaudeDocsStream yields text events and accumulates tool calls", async () => {
    const crypto = await import("node:crypto");
    const salt = "x-";
    const challenge = crypto.createHash("sha256").update(`${salt}1`).digest("hex");

    const sseLines = [
      `data: {"choices":[{"delta":{"content":"Hello "}}]}`,
      `data: {"choices":[{"delta":{"content":"world"}}]}`,
      `data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\\"text\\":\\"\\"}"}}]}}]}`,
      "data: [DONE]",
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/v1/challenge")) {
          return makeJsonResponse({
            challenge,
            salt,
            maxnumber: 10,
            algorithm: "SHA-256",
            signature: "sig",
          });
        }
        if (url.includes("/v1/chat/completions")) {
          return makeStreamResponse(sseLines);
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askClaudeDocsStream } = await import("../providers/claude.js");
    const events = [];
    for await (const e of askClaudeDocsStream("test")) {
      events.push(e);
    }

    const textEvents = events.filter((e) => e.type === "text");
    expect(textEvents).toHaveLength(2);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.response.content).toBe("Hello world");
    }
  });

  it("askClaudeDocsStream yields links from accumulated tool calls", async () => {
    const crypto = await import("node:crypto");
    const salt = "link-";
    const challenge = crypto.createHash("sha256").update(`${salt}0`).digest("hex");

    const toolArgs = JSON.stringify({
      text: "Fallback from tool",
      links: [{ title: "Doc", url: "https://docs.anthropic.com/guide", label: "Guide" }],
    });
    // Split tool args across multiple chunks to test accumulation
    const half = Math.floor(toolArgs.length / 2);
    const part1 = toolArgs.slice(0, half);
    const part2 = toolArgs.slice(half);

    const sseLines = [
      `data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":${JSON.stringify(part1)}}}]}}]}`,
      `data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":${JSON.stringify(part2)}}}]}}]}`,
      "data: [DONE]",
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/v1/challenge")) {
          return makeJsonResponse({
            challenge,
            salt,
            maxnumber: 10,
            algorithm: "SHA-256",
            signature: "sig",
          });
        }
        if (url.includes("/v1/chat/completions")) {
          return makeStreamResponse(sseLines);
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askClaudeDocsStream } = await import("../providers/claude.js");
    const events = [];
    for await (const e of askClaudeDocsStream("test")) {
      events.push(e);
    }

    // Should have searchResults from tool call links
    expect(events.some((e) => e.type === "searchResults")).toBe(true);
    // Should have text from fallback (no direct content was streamed)
    expect(events.some((e) => e.type === "text" && "text" in e && e.text === "Fallback from tool")).toBe(true);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.response.content).toBe("Fallback from tool");
      expect(done.response.searchResults).toHaveLength(1);
    }
  });

  it("askClaudeDocsStream throws on missing body", async () => {
    const crypto = await import("node:crypto");
    const salt = "nb-";
    const challenge = crypto.createHash("sha256").update(`${salt}0`).digest("hex");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        if (url.includes("/v1/challenge")) {
          return makeJsonResponse({
            challenge,
            salt,
            maxnumber: 10,
            algorithm: "SHA-256",
            signature: "sig",
          });
        }
        return Promise.resolve({ ok: true, status: 200, body: null });
      }),
    );

    const { askClaudeDocsStream } = await import("../providers/claude.js");
    await expect(async () => {
      for await (const _ of askClaudeDocsStream("test")) { /* drain */ }
    }).rejects.toThrow("No response body");
  });

  it("askInkeepDocsStream detects key and streams", async () => {
    const crypto = await import("node:crypto");
    const salt = "is-";
    const challenge = crypto.createHash("sha256").update(`${salt}2`).digest("hex");

    const sseLines = [
      `data: {"choices":[{"delta":{"content":"Streamed"}}]}`,
      "data: [DONE]",
    ];

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        callCount++;
        const url = _url as string;
        if (callCount === 1) {
          // Site HTML with API key
          return Promise.resolve({
            ok: true,
            status: 200,
            url: "https://example.com/docs",
            text: () =>
              Promise.resolve(
                '<script>apiKey="abcdef1234567890abcdef1234567890abcdef1234"</script>',
              ),
          });
        }
        if (url.includes("/v1/challenge")) {
          return makeJsonResponse({
            challenge,
            salt,
            maxnumber: 10,
            algorithm: "SHA-256",
            signature: "sig",
          });
        }
        if (url.includes("/v1/chat/completions")) {
          return makeStreamResponse(sseLines);
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askInkeepDocsStream } = await import("../providers/claude.js");
    const events = [];
    for await (const e of askInkeepDocsStream("https://example.com/docs", "test")) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "text")).toBe(true);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.response.content).toBe("Streamed");
    }
  });

  it("detectInkeepApiKey finds key in inline scripts", async () => {
    const crypto = await import("node:crypto");
    const salt = "inkeep-salt-";
    const number = 5;
    const challenge = crypto.createHash("sha256").update(`${salt}${number}`).digest("hex");

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        callCount++;
        const url = _url as string;
        // First call: site HTML with inline apiKey
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            url: "https://example.com/docs",
            text: () =>
              Promise.resolve(
                '<script>var config = {apiKey: "abcdef1234567890abcdef1234567890abcdef1234"};</script>',
              ),
          });
        }
        // Challenge
        if (url.includes("/v1/challenge")) {
          return makeJsonResponse({
            challenge,
            salt,
            maxnumber: 100,
            algorithm: "SHA-256",
            signature: "sig",
          });
        }
        // Chat completions
        if (url.includes("/v1/chat/completions")) {
          return makeJsonResponse({ choices: [{ message: { content: "ok" } }] });
        }
        return makeErrorResponse(404, "Not Found");
      }),
    );

    const { askInkeepDocs } = await import("../providers/claude.js");
    const res = await askInkeepDocs("https://example.com/docs", "test");
    expect(res.content).toBe("ok");
  });
});

// ── GitBook ──────────────────────────────────────────────────────────────

describe("gitbook", () => {
  function makeGitBookHtml() {
    // Create a fake JWT with space/site/organization
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ space: "space-1", site: "site-1", organization: "org-1" }),
    ).toString("base64url");
    const token = `${header}.${payload}.fakesig`;

    return `
      <html>
      <script>apiToken:${token}</script>
      <script>"pageId":"page-1"</script>
      <script>basePath:/docs</script>
      <script>static/chunks/123-abc123.js</script>
      <link href="https://static-2v.gitbook.com/_next/static/chunks/123-abc123.js"/>
      </html>
    `;
  }

  it("askGitBookDocs fetches site info and parses RSC response", async () => {
    const rscResponse = [
      '1:{"event":{"type":"response_tool_call","toolCall":{"tool":"search","results":[{"type":"page","title":"Getting Started","description":"Intro","pageId":"p1","url":"https://docs.example.com/start"}]}}}',
      '2:{"event":{"type":"response_document","stepIndex":0,"blocks":[{"nodes":[{"leaves":[{"text":"The answer is here."}]}]}]}}',
    ].join("\n");

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        callCount++;
        // First call: page HTML
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            url: "https://docs.example.com",
            text: () => Promise.resolve(makeGitBookHtml()),
          });
        }
        // JS chunk fetch (for action hash discovery)
        if (url.includes("static/chunks")) {
          return makeTextResponse('createServerReference("abcdef1234567890abcdef1234567890abcdef1234ab","streamAIChat');
        }
        // RSC POST
        return makeTextResponse(rscResponse);
      }),
    );

    const { askGitBookDocs } = await import("../providers/gitbook.js");
    const res = await askGitBookDocs("https://docs.example.com", "How to get started?");

    expect(res.content).toBe("The answer is here.");
    expect(res.searchResults).toHaveLength(1);
    expect(res.searchResults[0].title).toBe("Getting Started");
  });

  it("askGitBookDocs throws when token not found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://docs.example.com",
        text: () => Promise.resolve("<html>No token here</html>"),
      }),
    );

    const { askGitBookDocs } = await import("../providers/gitbook.js");
    await expect(askGitBookDocs("https://docs.example.com", "test")).rejects.toThrow(
      "Could not find GitBook API token",
    );
  });

  it("askGitBookDocs throws on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(makeErrorResponse(503, "Service Unavailable")));

    const { askGitBookDocs } = await import("../providers/gitbook.js");
    await expect(askGitBookDocs("https://docs.example.com", "test")).rejects.toThrow(
      "Failed to fetch GitBook site",
    );
  });

  it("askGitBookDocsStream yields text and search events", async () => {
    const rscLines = [
      '1:{"event":{"type":"response_tool_call","toolCall":{"tool":"search","results":[{"type":"page","title":"Intro","description":"Desc","pageId":"p1","url":"https://docs.example.com/intro"}]}}}',
      '2:{"event":{"type":"response_document","stepIndex":1,"blocks":[{"nodes":[{"leaves":[{"text":"Streamed answer."}]}]}]}}',
    ];

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            url: "https://docs.example.com",
            text: () => Promise.resolve(makeGitBookHtml()),
          });
        }
        if (url.includes("static/chunks")) {
          return makeTextResponse('createServerReference("abcdef1234567890abcdef1234567890abcdef1234ab","streamAIChat');
        }
        // RSC stream response
        return makeStreamResponse(rscLines);
      }),
    );

    const { askGitBookDocsStream } = await import("../providers/gitbook.js");
    const events = [];
    for await (const e of askGitBookDocsStream("https://docs.example.com", "test")) {
      events.push(e);
    }

    expect(events.some((e) => e.type === "searchResults")).toBe(true);
    expect(events.some((e) => e.type === "text")).toBe(true);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    if (done?.type === "done") {
      expect(done.response.content).toBe("Streamed answer.");
      expect(done.response.searchResults).toHaveLength(1);
    }
  });

  it("askGitBookDocsStream throws on missing body", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string) => {
        const url = _url as string;
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            url: "https://docs.example.com",
            text: () => Promise.resolve(makeGitBookHtml()),
          });
        }
        if (url.includes("static/chunks")) {
          return makeTextResponse('createServerReference("abcdef1234567890abcdef1234567890abcdef1234ab","streamAIChat');
        }
        // No body
        return Promise.resolve({ ok: true, status: 200, body: null, text: () => Promise.resolve("") });
      }),
    );

    const { askGitBookDocsStream } = await import("../providers/gitbook.js");
    await expect(async () => {
      for await (const _ of askGitBookDocsStream("https://docs.example.com", "test")) { /* drain */ }
    }).rejects.toThrow("No response body");
  });

  it("falls back to known hash when no chunks match", async () => {
    // HTML with no chunk URLs
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ space: "s1", site: "si1", organization: "o1" }),
    ).toString("base64url");
    const token = `${header}.${payload}.fakesig`;
    const htmlNoChunks = `<html><script>apiToken:${token}</script><script>"pageId":"p1"</script></html>`;

    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            status: 200,
            url: "https://docs.example.com",
            text: () => Promise.resolve(htmlNoChunks),
          });
        }
        // RSC response
        return makeTextResponse('1:{"event":{"type":"response_document","stepIndex":0,"blocks":[{"nodes":[{"leaves":[{"text":"ok"}]}]}]}}');
      }),
    );

    const { askGitBookDocs } = await import("../providers/gitbook.js");
    const res = await askGitBookDocs("https://docs.example.com", "test");
    expect(res.content).toBe("ok");
  });
});
