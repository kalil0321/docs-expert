import { describe, it, expect } from "vitest";
import {
  parseStreamLine,
  lineIterator,
  processStreamResponse,
} from "../providers/mintlify/stream-parser.js";

describe("parseStreamLine", () => {
  it("parses text chunk (type 0)", () => {
    const result = parseStreamLine('0:"Hello world"');
    expect(result).toEqual({ type: "0", data: "Hello world" });
  });

  it("parses message metadata (type f)", () => {
    const result = parseStreamLine('f:{"messageId":"abc123"}');
    expect(result).toEqual({ type: "f", data: { messageId: "abc123" } });
  });

  it("parses tool result (type a)", () => {
    const input = 'a:{"result":{"type":"search","results":[]}}';
    const result = parseStreamLine(input);
    expect(result).toEqual({
      type: "a",
      data: { result: { type: "search", results: [] } },
    });
  });

  it("parses usage stats (type e)", () => {
    const input = 'e:{"usage":{"promptTokens":100,"completionTokens":50}}';
    const result = parseStreamLine(input);
    expect(result).toEqual({
      type: "e",
      data: { usage: { promptTokens: 100, completionTokens: 50 } },
    });
  });

  it("returns empty for empty string", () => {
    expect(parseStreamLine("")).toEqual({ type: "", data: null });
  });

  it("returns empty for string without colon", () => {
    expect(parseStreamLine("nocolon")).toEqual({ type: "", data: null });
  });

  it("handles malformed JSON gracefully", () => {
    const result = parseStreamLine("0:{broken json");
    expect(result).toEqual({ type: "0", data: "{broken json" });
  });

  it("handles unknown type", () => {
    const result = parseStreamLine("x:some data");
    expect(result).toEqual({ type: "x", data: "some data" });
  });
});

describe("lineIterator", () => {
  function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  it("splits a single chunk into lines", async () => {
    const stream = makeStream(['0:"hello"\n0:" world"\n']);
    const lines: string[] = [];
    for await (const line of lineIterator(stream)) {
      lines.push(line);
    }
    expect(lines).toEqual(['0:"hello"', '0:" world"']);
  });

  it("handles lines split across chunks", async () => {
    const stream = makeStream(['0:"hel', 'lo"\n0:" world"\n']);
    const lines: string[] = [];
    for await (const line of lineIterator(stream)) {
      lines.push(line);
    }
    expect(lines).toEqual(['0:"hello"', '0:" world"']);
  });

  it("handles trailing data without newline", async () => {
    const stream = makeStream(['0:"hello"']);
    const lines: string[] = [];
    for await (const line of lineIterator(stream)) {
      lines.push(line);
    }
    expect(lines).toEqual(['0:"hello"']);
  });

  it("skips empty lines", async () => {
    const stream = makeStream(['0:"a"\n\n0:"b"\n']);
    const lines: string[] = [];
    for await (const line of lineIterator(stream)) {
      lines.push(line);
    }
    expect(lines).toEqual(['0:"a"', '0:"b"']);
  });
});

describe("processStreamResponse", () => {
  function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
  }

  it("yields parsed stream lines", async () => {
    const stream = makeStream([
      'f:{"messageId":"msg1"}\n0:"Hello"\n0:" there"\ne:{"usage":{"tokens":10}}\n',
    ]);

    const results = [];
    for await (const line of processStreamResponse(stream)) {
      results.push(line);
    }

    expect(results).toEqual([
      { type: "f", data: { messageId: "msg1" } },
      { type: "0", data: "Hello" },
      { type: "0", data: " there" },
      { type: "e", data: { usage: { tokens: 10 } } },
    ]);
  });

  it("filters out lines with empty type", async () => {
    const stream = makeStream(["invalid\n", '0:"valid"\n']);

    const results = [];
    for await (const line of processStreamResponse(stream)) {
      results.push(line);
    }

    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("0");
  });
});
