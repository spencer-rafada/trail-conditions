// Hand-rolled history router (zero new deps, per the ticket's lean-deps
// constraint): pushState for navigation, replaceState for in-page state like
// the selected tab, and a popstate listener so the back button works.

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

export interface AppLocation {
  pathname: string;
  search: string;
}

const NAVIGATE_EVENT = "app:navigate";

const readLocation = (): AppLocation => ({
  pathname: window.location.pathname,
  search: window.location.search,
});

export function useAppLocation(): AppLocation {
  const [location, setLocation] = useState(readLocation);
  useEffect(() => {
    const onChange = () => setLocation(readLocation());
    window.addEventListener("popstate", onChange);
    window.addEventListener(NAVIGATE_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(NAVIGATE_EVENT, onChange);
    };
  }, []);
  return location;
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) {
    window.history.replaceState(null, "", to);
  } else {
    window.history.pushState(null, "", to);
    // pushState is scroll-preserving by spec (scrollRestoration only covers
    // history traversal), so a new page starts at the top explicitly.
    window.scrollTo(0, 0);
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Keep cmd/ctrl-click (new tab) and middle-click native.
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}
