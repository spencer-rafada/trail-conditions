// Cloudflare Web Analytics: free, cookieless visit counts (pages, referrers,
// countries, devices) — no cookies or personal data, so no consent banner.
// Loads only when VITE_CF_ANALYTICS_TOKEN is set (apps/web/.env.production.local);
// the token comes from Cloudflare dashboard → Web Analytics → Add a site.

export function startAnalytics(
  token: string | undefined = import.meta.env.VITE_CF_ANALYTICS_TOKEN as string | undefined,
  doc: Document = document,
): void {
  if (!token) return;
  const script = doc.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  // spa: count each in-app page change (trail pages) as a page view.
  script.setAttribute("data-cf-beacon", JSON.stringify({ token, spa: true }));
  doc.body.appendChild(script);
}
