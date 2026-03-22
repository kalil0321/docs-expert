#!/usr/bin/env node

declare const __VERSION__: string;
declare const __NAME__: string;

import { text, isCancel, cancel } from "@clack/prompts";
import chalk from "chalk";
import { askStream } from "./providers/mintlify/client.js";
import { askClaudeDocsStream, askInkeepDocsStream } from "./providers/claude.js";
import { askStripeDocsStream } from "./providers/stripe.js";
import { askGitBookDocsStream } from "./providers/gitbook.js";
import { askFernDocsStream } from "./providers/fern.js";
import { askReadMeDocsStream } from "./providers/readme.js";
import { askVercelDocsStream } from "./providers/vercel.js";
import { askBetterAuthDocsStream } from "./providers/better-auth.js";
import { resolveProvider, invalidateCachedProvider } from "./provider-detect.js";
import type { ProviderName } from "./provider-detect.js";
import type { DocsExpertResponse, StreamEvent } from "./types.js";

process.title = __NAME__;

const v = chalk.hex("#8b5cf6");
const vB = chalk.hex("#c084fc");
const dim = chalk.dim;
const bold = chalk.bold;

let mdPromise: Promise<import("marked").Marked> | null = null;

async function getMarked(): Promise<import("marked").Marked> {
  if (!mdPromise) {
    mdPromise = (async () => {
      const { Marked } = await import("marked");
      const { markedTerminal } = await import("marked-terminal");
      return new Marked(
        markedTerminal({
          reflowText: true,
          width: Math.min(process.stdout.columns || 80, 100),
          tab: 2,
        }) as unknown as Parameters<typeof Marked.prototype.use>[0],
      );
    })();
  }
  return mdPromise;
}

function fixInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => bold(t))
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_m, t: string) => chalk.italic(t))
    .replace(/`([^`]+)`/g, (_m, t: string) => chalk.cyan(t));
}

async function renderMarkdown(content: string): Promise<string> {
  const md = await getMarked();
  const rendered = (md.parse(content) as string).trimEnd();
  return fixInlineMarkdown(rendered);
}

function banner() {
  console.log();
  console.log(`  ${vB("◆")} ${bold("docs-expert")} ${dim(`v${__VERSION__}`)}`);
  console.log(`  ${dim("query any documentation site's AI assistant")}`);
  console.log();
}

function separator(label: string) {
  const cols = Math.min(process.stdout.columns || 60, 60);
  const line = dim("─".repeat(Math.max(cols - label.length - 4, 10)));
  return `  ${dim("──")} ${vB(label)} ${line}`;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function createSpinner() {
  let frame = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  let currentMsg = "";

  return {
    start(msg: string) {
      currentMsg = msg;
      interval = setInterval(() => {
        const f = v(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
        process.stderr.write(`\r  ${f} ${dim(currentMsg)}`);
        frame++;
      }, 80);
    },
    update(msg: string) {
      currentMsg = msg;
    },
    stop(msg?: string) {
      if (interval) clearInterval(interval);
      process.stderr.write(`\r${" ".repeat(process.stdout.columns || 60)}\r`);
      if (msg) {
        console.error(`  ${v("✓")} ${dim(msg)}`);
      }
    },
  };
}

function getStreamForProvider(
  provider: ProviderName,
  url: string,
  question: string,
): AsyncGenerator<StreamEvent> {
  switch (provider) {
    case "fern":
      return askFernDocsStream(url, question);
    case "gitbook":
      return askGitBookDocsStream(url, question);
    case "readme":
      return askReadMeDocsStream(url, question);
    case "inkeep":
      return askInkeepDocsStream(url, question);
    case "mintlify":
      return askStream(url, question);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`${__NAME__} v${__VERSION__}`);
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  ${bold("Usage:")} docs-expert [options] <url> <question>
         docs-expert --claude <question>
         docs-expert --stripe <question>
         docs-expert --gitbook <url> <question>
         docs-expert --fern <url> <question>
         docs-expert --readme <url> <question>
         docs-expert --vercel <question>
         docs-expert --better-auth <question>
         docs-expert --inkeep <url> <question>

  ${bold("Arguments:")}
    url        Documentation site URL
    question   Question to ask about the docs

  ${bold("Options:")}
    --claude   Query Claude/Anthropic docs (via Inkeep API)
    --stripe   Query Stripe docs (via Stripe AI)
    --gitbook  Query any GitBook-powered docs site
    --fern     Query any Fern-powered docs site
    --readme   Query any ReadMe-powered docs site
    --vercel   Query Vercel docs
    --better-auth  Query Better Auth docs
    --inkeep   Query any Inkeep-powered docs site (auto-detects API key)
    --json     Output raw JSON response
    -v, --version  Show version
    -h, --help     Show this help message

  ${bold("Examples:")}
    ${dim("# Auto-detect provider and query (works with any supported site)")}
    docs-expert https://docs.example.com "How does auth work?"
    docs-expert https://clerk.com/docs "How do I protect API routes?"

    ${dim("# Query Claude/Anthropic docs")}
    docs-expert --claude "How do I use tools in the Agent SDK?"

    ${dim("# Query Stripe docs")}
    docs-expert --stripe "How do I create a payment intent?"

    ${dim("# Query any GitBook docs")}
    docs-expert --gitbook https://docs.gitbook.com "How do I create a space?"

    ${dim("# Query any Fern docs")}
    docs-expert --fern https://openrouter.ai/docs "What models are available?"

    ${dim("# Query any ReadMe docs")}
    docs-expert --readme https://docs.readme.com "How do I set up API docs?"

    ${dim("# Query Vercel docs")}
    docs-expert --vercel "How do I deploy a Next.js app?"

    ${dim("# Query Better Auth docs")}
    docs-expert --better-auth "How do I set up email and password auth?"

    ${dim("# Query any Inkeep-powered docs (Clerk, etc.)")}
    docs-expert --inkeep https://clerk.com/docs "How do I set up auth?"

    ${dim("# Interactive mode (prompts for inputs)")}
    docs-expert
`);
    return;
  }

  const jsonFlag = args.includes("--json");
  const claudeFlag = args.includes("--claude");
  const stripeFlag = args.includes("--stripe");
  const gitbookFlag = args.includes("--gitbook");
  const fernFlag = args.includes("--fern");
  const readmeFlag = args.includes("--readme");
  const vercelFlag = args.includes("--vercel");
  const betterAuthFlag = args.includes("--better-auth");
  const inkeepFlag = args.includes("--inkeep");
  const positional = args.filter((a) => !a.startsWith("--") && !a.startsWith("-"));

  if (!jsonFlag) banner();

  let streamSource: AsyncGenerator<StreamEvent>;

  if (claudeFlag || stripeFlag || vercelFlag || betterAuthFlag) {
    let question = positional[0];

    if (!question) {
      const placeholder = claudeFlag
        ? "How do I use the Agent SDK?"
        : vercelFlag
          ? "How do I deploy a Next.js app?"
          : betterAuthFlag
            ? "How do I set up email and password auth?"
            : "How do I create a payment intent?";
      const result = await text({
        message: `${v("◆")} Your question`,
        placeholder,
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      question = result;
      console.log();
    }

    streamSource = claudeFlag
      ? askClaudeDocsStream(question)
      : vercelFlag
        ? askVercelDocsStream(question)
        : betterAuthFlag
          ? askBetterAuthDocsStream(question)
          : askStripeDocsStream(question);
  } else if (gitbookFlag) {
    let url = positional[0];
    let question = positional[1];

    if (!url) {
      const result = await text({
        message: `${v("◆")} GitBook docs URL`,
        placeholder: "https://docs.gitbook.com",
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      url = result;
      console.log();
    }

    if (!question) {
      const result = await text({
        message: `${v("◆")} Your question`,
        placeholder: "How does this work?",
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      question = result;
      console.log();
    }

    streamSource = askGitBookDocsStream(url, question);
  } else if (fernFlag) {
    let url = positional[0];
    let question = positional[1];

    if (!url) {
      const result = await text({
        message: `${v("◆")} Fern docs URL`,
        placeholder: "https://openrouter.ai/docs",
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      url = result;
      console.log();
    }

    if (!question) {
      const result = await text({
        message: `${v("◆")} Your question`,
        placeholder: "How does this work?",
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      question = result;
      console.log();
    }

    streamSource = askFernDocsStream(url, question);
  } else if (readmeFlag) {
    let url = positional[0];
    let question = positional[1];

    if (!url) {
      const result = await text({
        message: `${v("◆")} ReadMe docs URL`,
        placeholder: "https://docs.readme.com",
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      url = result;
      console.log();
    }

    if (!question) {
      const result = await text({
        message: `${v("◆")} Your question`,
        placeholder: "How does this work?",
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      question = result;
      console.log();
    }

    streamSource = askReadMeDocsStream(url, question);
  } else if (inkeepFlag) {
    let url = positional[0];
    let question = positional[1];

    if (!url) {
      const result = await text({
        message: `${v("◆")} Inkeep-powered docs URL`,
        placeholder: "https://clerk.com/docs",
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      url = result;
      console.log();
    }

    if (!question) {
      const result = await text({
        message: `${v("◆")} Your question`,
        placeholder: "How does this work?",
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      question = result;
      console.log();
    }

    streamSource = askInkeepDocsStream(url, question);
  } else {
    let url = positional[0];
    let question = positional[1];

    if (!url) {
      const result = await text({
        message: `${v("◆")} Documentation site URL`,
        placeholder: "https://docs.example.com",
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      url = result;
      console.log();
    }

    if (!question) {
      const result = await text({
        message: `${v("◆")} Your question`,
        placeholder: "How does authentication work?",
      });
      if (isCancel(result)) {
        cancel("Cancelled.");
        process.exit(0);
      }
      question = result;
      console.log();
    }

    const { provider, fromCache } = await resolveProvider(url);
    streamSource = (async function* () {
      try {
        yield* getStreamForProvider(provider, url, question);
      } catch (err) {
        if (fromCache) {
          await invalidateCachedProvider(url);
          const fresh = await resolveProvider(url);
          yield* getStreamForProvider(fresh.provider, url, question);
        } else {
          throw err;
        }
      }
    })();
  }

  const spin = createSpinner();
  spin.start("Connecting to docs...");

  let response: DocsExpertResponse | undefined;
  const textChunks: string[] = [];
  let gotSearchResults = false;
  let lastSpinnerUpdate = 0;
  const SPINNER_UPDATE_INTERVAL_MS = 300;

  for await (const event of streamSource) {
    if (event.type === "searchResults" && !gotSearchResults) {
      gotSearchResults = true;
      spin.update("Generating answer...");
    } else if (event.type === "text") {
      textChunks.push(event.text);
      const now = Date.now();
      if (now - lastSpinnerUpdate >= SPINNER_UPDATE_INTERVAL_MS) {
        lastSpinnerUpdate = now;
        const words = textChunks.join("").split(/\s+/).length;
        spin.update(`Generating answer... ${dim(`${words} words`)}`);
      }
    } else if (event.type === "done") {
      response = event.response;
    }
  }

  if (!response) {
    spin.stop("No response received.");
    process.exit(1);
  }

  spin.stop("Done.");

  if (jsonFlag) {
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  console.log();
  console.log(separator("Answer"));
  console.log();
  console.log(await renderMarkdown(response.content));
  console.log();

  // Sources
  if (response.searchResults.length > 0) {
    console.log(separator("Sources"));
    console.log();
    for (const r of response.searchResults) {
      console.log(`  ${v("◆")} ${bold(r.title)}`);
      console.log(`    ${dim(r.href)}`);
    }
    console.log();
  }

  // Suggestions
  if (response.suggestions.length > 0) {
    console.log(separator("Suggested"));
    console.log();
    for (const s of response.suggestions) {
      console.log(`  ${v("→")} ${s}`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error(`\n  ${chalk.red("✖")} ${err.message}\n`);
  process.exit(1);
});
