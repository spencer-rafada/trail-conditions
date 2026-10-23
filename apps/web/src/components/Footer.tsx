// Required on every page and state (spec §10): data credits + disclaimer.
// Rendered from the App shell so no route or state can drop it.

export function Footer() {
  return (
    <footer className="site-footer">
      <p className="disclaimer">
        Estimates only. Check land manager closures. Please stay off muddy trails.
      </p>
      <p className="credits">
        Weather by <a href="https://open-meteo.com/">Open-Meteo</a> (CC-BY 4.0) and
        the <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a> ·
        Soil by USDA NRCS · ©{" "}
        <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
      </p>
    </footer>
  );
}
