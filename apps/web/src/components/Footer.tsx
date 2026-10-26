// Required on every page and state (spec §10): data credits + disclaimer.
// The App shell renders it on every route except Home, which places it at
// the end of its list (every Home state renders it).

import { SUPPORT_URL } from "../support";

export function Footer() {
  return (
    <footer className="site-footer">
      <p className="disclaimer">
        Estimates only. Check land manager closures. Please stay off muddy trails.
      </p>
      {SUPPORT_URL && (
        <p className="support">
          Free, no ads.{" "}
          <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer">
            ☕ Support this site
          </a>
        </p>
      )}
      <p className="credits">
        Weather by <a href="https://open-meteo.com/">Open-Meteo</a> (CC-BY 4.0) and
        the <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a> ·
        Soil by USDA NRCS · ©{" "}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ·
        Maps by <a href="https://carto.com/attributions">CARTO</a> and{" "}
        <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">
          USGS The National Map
        </a>
      </p>
    </footer>
  );
}
