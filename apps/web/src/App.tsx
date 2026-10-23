// App shell: route dispatch plus the footer that must be on every page and
// state (spec §10).

import { Footer } from "./components/Footer";
import { Home } from "./pages/Home";
import { Trail } from "./pages/Trail";
import { Link, useAppLocation } from "./router";

export function App() {
  const location = useAppLocation();
  const trailMatch = location.pathname.match(/^\/trails\/([^/]+)$/);

  let page;
  if (trailMatch) {
    page = <Trail id={decodeURIComponent(trailMatch[1]!)} />;
  } else if (location.pathname === "/") {
    page = <Home search={location.search} />;
  } else {
    page = (
      <main>
        <p className="status-screen">Page not found.</p>
        <p className="center">
          <Link to="/">All trails</Link>
        </p>
      </main>
    );
  }

  return (
    <div className="app">
      {page}
      <Footer />
    </div>
  );
}
