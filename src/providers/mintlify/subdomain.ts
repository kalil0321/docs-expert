const SUBDOMAIN_PATTERNS = [
  /"subdomain"\s*:\s*"([a-zA-Z0-9-]+)"/,
  /mintlify-assets\/_mintlify\/favicons\/([a-zA-Z0-9-]+)\//,
  /\/api\/assistant\/([a-zA-Z0-9-]+)\//,
  /data-subdomain="([a-zA-Z0-9-]+)"/,
  /\/mintlify-assets\/_mintlify\/[^/]+\/([a-zA-Z0-9-]+)\//,
];

const MAX_BYTES = 100_000;

export async function detectSubdomain(docsUrl: string): Promise<string> {
  const url = docsUrl.replace(/\/+$/, "");

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch docs site (${response.status}): ${response.statusText}`,
    );
  }

  const body = response.body;
  let buffer: string;

  if (body) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    buffer = "";
    let totalRead = 0;

    try {
      while (totalRead < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        totalRead += value.length;

        for (const pattern of SUBDOMAIN_PATTERNS) {
          const match = buffer.match(pattern);
          if (match) {
            reader.cancel();
            return match[1];
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  } else {
    buffer = await response.text();
  }

  for (const pattern of SUBDOMAIN_PATTERNS) {
    const match = buffer.match(pattern);
    if (match) return match[1];
  }

  throw new Error(
    `Could not auto-detect Mintlify subdomain from ${url}. Please provide it manually via the subdomain option.`,
  );
}
