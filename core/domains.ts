// Domain availability via the Domains API on RapidAPI. The key is the user's
// own (BYOK); it is sent only to this host. With no key, checkDomains returns
// null and the caller falls back to a registrar search link, so nothing leaves
// the machine uninvited. Ported from the web app's src/lib/domains.js.

export const DOMAIN_HOST = "domains-api.p.rapidapi.com";
export const DOMAIN_TLDS = ["com", "io", "app", "co"] as const;

export interface DomainResult {
  domain: string;
  status: string;
  available: boolean;
  error?: boolean;
}

export interface CheckOptions {
  signal?: AbortSignal;
  tlds?: readonly string[];
}

// A slug -> the candidate domains we test for it.
export function domainsForSlug(slug: string, tlds: readonly string[] = DOMAIN_TLDS): string[] {
  const base = String(slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!base) return [];
  return tlds.map((t) => `${base}.${t}`);
}

// The API returns availability as "available" | "registered" (and a few others
// like "reserved"). Only an outright "available" counts as registrable.
export function isAvailable(availability: string | null | undefined): boolean {
  return String(availability || "").toLowerCase() === "available";
}

// Returns null when there is no key (caller shows registrar links instead),
// otherwise [{ domain, status, available, error? }]. The API takes a single
// domain per request, so we fan out one request per candidate TLD in parallel.
// Each lookup is resilient: one TLD failing (some return 500 for certain names)
// marks just that chip as a failed check, it does not sink the whole batch.
export async function checkDomains(
  slug: string,
  domainKey: string | null | undefined,
  { signal, tlds }: CheckOptions = {},
): Promise<DomainResult[] | null> {
  if (!domainKey) return null;
  const domains = domainsForSlug(slug, tlds);
  if (domains.length === 0) return [];
  return Promise.all(
    domains.map(async (domain): Promise<DomainResult> => {
      try {
        const res = await fetch(`https://${DOMAIN_HOST}/domains/${encodeURIComponent(domain)}`, {
          signal,
          headers: { "x-rapidapi-key": domainKey, "x-rapidapi-host": DOMAIN_HOST },
        });
        if (!res.ok) return { domain, status: "error", available: false, error: true };
        const data = (await res.json()) as { availability?: string };
        return { domain, status: data.availability || "unknown", available: isAvailable(data.availability) };
      } catch {
        return { domain, status: "error", available: false, error: true };
      }
    }),
  );
}

// Outbound search used when no domain key is set (privacy-clean: a click, not a call).
export function registrarSearchUrl(slug: string): string {
  return `https://instantdomainsearch.com/?q=${encodeURIComponent(String(slug || "").toLowerCase())}`;
}
