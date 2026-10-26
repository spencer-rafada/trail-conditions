// The explore view the rider last saw (search, filter, map position), so the
// trail page's "Trails" breadcrumb returns to it instead of a fresh map.
// Module-level: it must outlive Home unmounting; a reload starts at "/".

let lastExploreUrl = "/";

export function rememberExploreUrl(url: string): void {
  lastExploreUrl = url;
}

export function exploreReturnUrl(): string {
  return lastExploreUrl;
}
