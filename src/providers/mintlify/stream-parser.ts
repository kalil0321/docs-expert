import type { StreamLine } from "../../types.js";

export function parseStreamLine(line: string): StreamLine {
  if (!line || !line.includes(":")) {
    return { type: "", data: null };
  }

  const type = line[0];
  const data = line.slice(2);

  try {
    if (type === "f" || type === "9" || type === "a" || type === "e") {
      return { type, data: JSON.parse(data) };
    } else if (type === "0") {
      return { type, data: JSON.parse(data) };
    }
    return { type, data };
  } catch {
    return { type, data };
  }
}

export async function* lineIterator(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        if (line) yield line;
      }
    }

    if (buffer) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

export async function* processStreamResponse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamLine> {
  for await (const line of lineIterator(body)) {
    const parsed = parseStreamLine(line);
    if (parsed.type) {
      yield parsed;
    }
  }
}
