/**
 * Site-wide footer. Rendered once by the App shell, so it appears on every page and view.
 * The first line is required verbatim by the assignment brief; do not reword it.
 */
export const ATTRIBUTION_LINE =
  "Made with 💖 by Nabhanyu for Dream11 - Forward Deployed Engineer Intern - Assignment";

export function AttributionFooter() {
  return (
    <footer className="site-footer">
      <p className="site-footer__attribution">{ATTRIBUTION_LINE}</p>
      <p className="site-footer__credits">
        Ball-by-ball data from{" "}
        <a href="https://cricsheet.org" target="_blank" rel="noreferrer">
          Cricsheet
        </a>{" "}
        (Open Data Commons Attribution License 1.0). A concept prototype, not an official Dream11
        product.
      </p>
    </footer>
  );
}
