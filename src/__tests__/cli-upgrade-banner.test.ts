import { describe, expect, it } from "vitest";
import { isInstalledVersionOlder } from "../cli-upgrade-banner.js";

describe("isInstalledVersionOlder", () => {
  it("returns true when patch is behind", () => {
    expect(isInstalledVersionOlder("0.2.0", "0.2.1")).toBe(true);
  });

  it("returns true when minor is behind", () => {
    expect(isInstalledVersionOlder("0.1.9", "0.2.0")).toBe(true);
  });

  it("returns false when equal", () => {
    expect(isInstalledVersionOlder("0.2.0", "0.2.0")).toBe(false);
  });

  it("returns false when ahead", () => {
    expect(isInstalledVersionOlder("0.3.0", "0.2.0")).toBe(false);
  });

  it("ignores v prefix on current", () => {
    expect(isInstalledVersionOlder("v0.1.0", "0.2.0")).toBe(true);
  });
});
