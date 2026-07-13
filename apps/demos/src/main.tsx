import { StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@go-go-golems/pbui-theme-genera/genera.css";
import "./launcher.css";
import { DEMOS } from "./demos.js";

function Launcher() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    const onHash = () => setHash(window.location.hash.slice(1));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const demo = DEMOS.find((d) => d.slug === hash);
  if (demo) {
    const C = demo.component;
    return (
      <Suspense fallback={<div className="pbui-root" style={{ padding: 24 }}>loading…</div>}>
        <C key={demo.slug} />
      </Suspense>
    );
  }
  return (
    <div className="pbui-root launcher">
      <h1>PBUI demos</h1>
      <p>
        Presentation-based UIs in React — ports of the CLIM-JSX prototypes
        onto the <code>PBUI</code> packages. Every object on screen is a
        typed presentation: hover it (watch the doc bar), right-click it
        (commands for its type), and click highlighted objects to supply
        command arguments.
      </p>
      <ul>
        {DEMOS.filter((d) => !d.hidden).map((d) => (
          <li key={d.slug}>
            <a href={`#${d.slug}`}>{d.title}</a> — {d.blurb}
            <span className="launcher-src"> (original: sources/{d.original})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Launcher />
  </StrictMode>,
);
