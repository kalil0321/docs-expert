import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectSubdomain } from "../providers/mintlify/subdomain.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(html: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Not Found",
      text: () => Promise.resolve(html),
    }),
  );
}

describe("detectSubdomain", () => {
  it('detects subdomain from "subdomain":"xxx" pattern', async () => {
    mockFetch('<script>{"subdomain":"metronome-b35a6a36"}</script>');
    const result = await detectSubdomain("https://docs.metronome.com");
    expect(result).toBe("metronome-b35a6a36");
  });

  it("detects subdomain from favicon asset path", async () => {
    mockFetch(
      '<link rel="icon" href="https://mintlify-assets/_mintlify/favicons/notte-abc123/favicon.ico">',
    );
    const result = await detectSubdomain("https://docs.notte.cc");
    expect(result).toBe("notte-abc123");
  });

  it("detects subdomain from API assistant path", async () => {
    mockFetch(
      '<script src="/api/assistant/my-subdomain-42/config.js"></script>',
    );
    const result = await detectSubdomain("https://docs.example.com");
    expect(result).toBe("my-subdomain-42");
  });

  it("detects subdomain from data-subdomain attribute", async () => {
    mockFetch('<div data-subdomain="test-sub-123"></div>');
    const result = await detectSubdomain("https://docs.example.com");
    expect(result).toBe("test-sub-123");
  });

  it("detects subdomain from generic mintlify asset path", async () => {
    mockFetch(
      '<script src="/mintlify-assets/_mintlify/scripts/my-project-99/main.js"></script>',
    );
    const result = await detectSubdomain("https://docs.example.com");
    expect(result).toBe("my-project-99");
  });

  it("throws when no subdomain found", async () => {
    mockFetch("<html><body>No mintlify here</body></html>");
    await expect(
      detectSubdomain("https://example.com"),
    ).rejects.toThrow("Could not auto-detect Mintlify subdomain");
  });

  it("throws on HTTP error", async () => {
    mockFetch("", 404);
    await expect(
      detectSubdomain("https://example.com"),
    ).rejects.toThrow("Failed to fetch docs site");
  });

  it("strips trailing slashes from URL", async () => {
    mockFetch('<script>{"subdomain":"test-123"}</script>');
    await detectSubdomain("https://docs.example.com///");
    expect(fetch).toHaveBeenCalledWith(
      "https://docs.example.com",
      expect.any(Object),
    );
  });

  it("detects subdomain via streaming body reader", async () => {
    const encoder = new TextEncoder();
    const html = '<script>{"subdomain":"streamed-sub"}</script>';
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(html));
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        body,
      }),
    );

    const result = await detectSubdomain("https://docs.example.com");
    expect(result).toBe("streamed-sub");
  });

  it("reads multiple chunks from streaming body", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("<html><head>"));
        controller.enqueue(encoder.encode('<script>{"subdomain":"multi-chunk"}</script>'));
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        body,
      }),
    );

    const result = await detectSubdomain("https://docs.example.com");
    expect(result).toBe("multi-chunk");
  });

  it("throws when streaming body has no subdomain", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("<html>no subdomain</html>"));
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        body,
      }),
    );

    await expect(detectSubdomain("https://example.com")).rejects.toThrow(
      "Could not auto-detect Mintlify subdomain",
    );
  });
});
