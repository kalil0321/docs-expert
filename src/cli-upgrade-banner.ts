import chalk from "chalk";

const dim = chalk.dim;
const bold = chalk.bold;
const mono = chalk.hex("#a78bfa");

const NPM_REGISTRY = "https://registry.npmjs.org";

export async function fetchLatestNpmVersion(
  packageName: string,
  timeoutMs = 2500,
): Promise<string | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${NPM_REGISTRY}/${encodeURIComponent(packageName)}/latest`, {
      signal: ac.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** True when `current` is strictly older than `latest` (semver x.y.z prefix only). */
export function isInstalledVersionOlder(current: string, latest: string): boolean {
  const parse = (v: string): [number, number, number] | null => {
    const m = v.trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const a = parse(current);
  const b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

export function printUpgradeBanner(current: string, latest: string): void {
  const cols = Math.min(process.stdout.columns || 60, 60);
  const bar = dim("─".repeat(cols));
  console.log(`  ${bar}`);
  console.log(
    `  ${chalk.yellow("▲")} ${bold("Update available")}  ${dim(mono(`v${current}`))} ${dim("→")} ${mono(`v${latest}`)}`,
  );
  console.log(`  ${dim("Run")} ${mono(`npm i -g docs-expert@latest`)} ${dim("to update")}`);
  console.log(`  ${bar}`);
  console.log();
}

export async function maybePrintUpgradeBanner(
  packageName: string,
  currentVersion: string,
): Promise<void> {
  const latest = await fetchLatestNpmVersion(packageName);
  if (!latest || !isInstalledVersionOlder(currentVersion, latest)) return;
  printUpgradeBanner(currentVersion, latest);
}
