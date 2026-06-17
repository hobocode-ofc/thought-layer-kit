import { describe, it, expect } from "vitest";
import { domainsForSlug, isAvailable, registrarSearchUrl, checkDomains, DOMAIN_TLDS } from "./domains";

describe("domainsForSlug", () => {
  it("builds one domain per TLD from a clean slug", () => {
    expect(domainsForSlug("acme", ["com", "io"])).toEqual(["acme.com", "acme.io"]);
  });
  it("sanitizes to lowercase letters/numbers/hyphens", () => {
    expect(domainsForSlug("Acme Dispatch!", ["com"])).toEqual(["acmedispatch.com"]);
  });
  it("defaults to the standard TLD set", () => {
    expect(domainsForSlug("x")).toEqual(DOMAIN_TLDS.map((t) => `x.${t}`));
  });
  it("returns nothing for an empty slug", () => {
    expect(domainsForSlug("")).toEqual([]);
    expect(domainsForSlug("!!!")).toEqual([]);
  });
});

describe("isAvailable", () => {
  it("treats an 'available' status as registrable (case-insensitive)", () => {
    expect(isAvailable("available")).toBe(true);
    expect(isAvailable("AVAILABLE")).toBe(true);
  });
  it("treats anything else as taken", () => {
    expect(isAvailable("registered")).toBe(false);
    expect(isAvailable("reserved")).toBe(false);
    expect(isAvailable("")).toBe(false);
    expect(isAvailable(undefined)).toBe(false);
  });
});

describe("registrarSearchUrl", () => {
  it("links to a domain search for the slug", () => {
    expect(registrarSearchUrl("Acme")).toContain("instantdomainsearch.com");
    expect(registrarSearchUrl("Acme")).toContain("q=acme");
  });
});

describe("checkDomains no-key fallback (no network)", () => {
  it("returns null with no key so the caller shows registrar links", async () => {
    await expect(checkDomains("acme", "")).resolves.toBeNull();
    await expect(checkDomains("acme", undefined)).resolves.toBeNull();
  });
  it("returns an empty list for an empty slug even with a key (no fetch)", async () => {
    await expect(checkDomains("", "fake-key")).resolves.toEqual([]);
  });
});
