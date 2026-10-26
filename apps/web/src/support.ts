// "Support this site" link (Ko-fi or similar). Voluntary donations keep the
// site within Open-Meteo's non-commercial free tier (its terms allow a tip
// jar; ads and subscriptions would not be). Set VITE_SUPPORT_URL in
// apps/web/.env.production.local; unset or invalid hides every link.

/** The link if it's a well-formed https URL, else null (link hidden). */
export function supportUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export const SUPPORT_URL = supportUrl(import.meta.env.VITE_SUPPORT_URL as string | undefined);
