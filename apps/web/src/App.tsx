/**
 * App shell: header (wordmark + theme control), page content, footer.
 *
 * Task 1 ships the shell and design tokens only. The landing hero with the floodlight
 * effects (Task 6) and the match room (Tasks 6-10) render inside <main>; the footer and
 * header stay in this shell so every view carries the attribution line.
 */
import { AttributionFooter } from "./components/AttributionFooter.tsx";
import { ThemeControl } from "./theme/ThemeControl.tsx";

export function App() {
  return (
    <div className="shell">
      <header className="shell__header">
        <span className="wordmark">Sideline</span>
        <ThemeControl />
      </header>

      <main className="shell__main">
        <section className="intro" aria-labelledby="intro-title">
          <h1 id="intro-title" className="intro__title">
            The match, on your clock.
          </h1>
          <p className="intro__lede">
            Sideline is a second-screen companion for live cricket. It steps in at the moments a
            match usually loses you: a surprise team sheet before the lock, your captain out for
            nothing, joining halfway through, and a stream that runs 25 seconds behind the chat.
          </p>
        </section>
      </main>

      <AttributionFooter />
    </div>
  );
}
