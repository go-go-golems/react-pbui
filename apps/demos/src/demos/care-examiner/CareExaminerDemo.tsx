/* CARE Examiner — port of sources/care-examiner.jsx onto PBUI.
 *
 * A live multiprocessor-simulator console in the Genera style: 16 sites
 * with dithered queue-load strips, a service table, an 8x8 operator torus,
 * and a load-level legend. Everything is a typed presentation; commands
 * like "Compare Sites" and "Set Load Threshold" collect arguments by
 * pointing. The simulation keeps ticking while you point — accepting
 * highlights persist because they are derived state.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  B,
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  valueRef,
  type ObjectRef,
  type Resolver,
} from "@go-go-golems/pbui-core";
import { PbuiProvider, Presentation, usePbuiSurface } from "@go-go-golems/pbui-react";
import { ContextMenuHost, MouseDocBar, Pane, StatusLine } from "@go-go-golems/pbui-chrome";
import { Listener } from "@go-go-golems/pbui-listener";
import { Store, useStore } from "../../lib/store.js";

/* --------------------------------- domain ---------------------------------- */

const HIST = 48;
const N_SITES = 16;
const TORUS = 8;

interface Site {
  id: string;
  name: string;
  hist: number[]; // 0..100
  highlighted: boolean;
}

interface Service {
  id: string;
  name: string;
  queue: number;
  avg: number;
  runs: number;
}

interface CareState {
  sites: Site[];
  services: Service[];
  torus: number[]; // TORUS*TORUS loads 0..100
  net: number[]; // network load history
  threshold: number | null; // load-level 0..9 or null
  paused: boolean;
  tickMs: number;
  simTime: number; // seconds
}

function seedState(): CareState {
  const rnd = mulberry32(0xca7e);
  const sites: Site[] = Array.from({ length: N_SITES }, (_, i) => {
    const base = 15 + Math.floor(rnd() * 55);
    return {
      id: `site-${i}`,
      name: `SITE-${String(i).padStart(2, "0")}`,
      hist: Array.from({ length: HIST }, () => base),
      highlighted: false,
    };
  });
  const services: Service[] = [
    "EVAL", "ROUTE", "PAGER", "DISK", "NET-IN", "NET-OUT", "GC", "CLOCK",
  ].map((name, i) => ({
    id: `svc-${i}`,
    name: `${name}-SERVICE`,
    queue: Math.floor(rnd() * 8),
    avg: 1 + rnd() * 9,
    runs: Math.floor(rnd() * 400),
  }));
  return {
    sites,
    services,
    torus: Array.from({ length: TORUS * TORUS }, () => rnd() * 100),
    net: Array.from({ length: HIST }, () => 30 + rnd() * 20),
    threshold: null,
    paused: false,
    tickMs: 650,
    simTime: 0,
  };
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function tick(s: CareState): CareState {
  if (s.paused) return { ...s, simTime: s.simTime };
  const step = (v: number) =>
    Math.max(0, Math.min(100, v + (Math.random() - 0.5) * 12 + (Math.random() < 0.02 ? Math.random() * 30 : 0)));
  return {
    ...s,
    simTime: s.simTime + s.tickMs / 1000,
    sites: s.sites.map((site) => ({
      ...site,
      hist: [...site.hist.slice(1), step(site.hist[site.hist.length - 1]!)],
    })),
    services: s.services.map((svc) =>
      Math.random() < 0.3
        ? { ...svc, queue: Math.max(0, svc.queue + (Math.random() < 0.5 ? 1 : -1)), runs: svc.runs + 1 }
        : svc,
    ),
    torus: s.torus.map((v) => step(v)),
    net: [...s.net.slice(1), step(s.net[s.net.length - 1]!)],
  };
}

/* ------------------------------ dither texture ----------------------------- */

/* 10-step white→black dot dithering, as in care-examiner.jsx:21-36 */
function ditherCSS(level: number): React.CSSProperties {
  const l = Math.max(0, Math.min(9, level));
  if (l === 0) return { background: "var(--pbui-paper)" };
  if (l === 9) return { background: "var(--pbui-ink)" };
  const size = 6 - l * 0.4;
  const dot = 0.8 + l * 0.42;
  return {
    backgroundColor: "var(--pbui-paper)",
    backgroundImage: `radial-gradient(circle, var(--pbui-ink) ${dot}px, transparent ${dot}px)`,
    backgroundSize: `${size}px ${size}px`,
  };
}

const levelOf = (pct: number) => Math.min(9, Math.floor(pct / 10));

/* --------------------------------- engine ---------------------------------- */

interface World {
  store: Store<CareState>;
  site(id: string): Site | undefined;
  service(id: string): Service | undefined;
}

function makeWorld(): World {
  const store = new Store(seedState());
  return {
    store,
    site: (id) => store.get().sites.find((s) => s.id === id),
    service: (id) => store.get().services.find((s) => s.id === id),
  };
}

const siteRef = (s: Site): ObjectRef => ({ kind: "site", id: s.id });
const sitePart = (s: Site) => ({ t: "pres", type: "site", ref: siteRef(s), label: s.name }) as const;

function makeEngine(world: World) {
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);
  ptypes.define<Site>({
    name: "site",
    print: (s) => `#<SITE ${s.name}>`,
    describe: (s) => {
      const cur = s.hist[s.hist.length - 1]!;
      const peak = Math.max(...s.hist);
      return [
        B(`#<SITE ${s.name}>`),
        `  queue load ${cur.toFixed(0)}%, peak ${peak.toFixed(0)}%, ${s.highlighted ? "highlighted" : "not highlighted"}. Displayed in the Queue Loads pane.`,
      ];
    },
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      for (const s of w.store.get().sites)
        if (s.name === t || s.name.startsWith(t))
          return { ok: true, value: s, ref: siteRef(s), label: s.name };
      return { ok: false, err: `${text} does not name a SITE` };
    },
  });
  ptypes.define<Service>({
    name: "service",
    print: (s) => `#<SERVICE ${s.name}>`,
    describe: (s) => [
      B(`#<SERVICE ${s.name}>`),
      `  queue ${s.queue}, average service time ${s.avg.toFixed(1)}ms, ${s.runs} runs.`,
    ],
  });
  ptypes.define<number>({
    name: "operator",
    print: () => `#<OPERATOR>`,
  });
  ptypes.define<number>({
    name: "load-level",
    print: (l) => `#<LOAD-LEVEL ${l}0%>`,
  });

  const commands = new CommandTable<World>();
  commands.defineAll([
    {
      name: "Compare Sites",
      doc: "Print both sites' current and peak loads side by side.",
      args: [
        { name: "site-a", type: "site" },
        { name: "site-b", type: "site", distinct: true },
      ],
      run: (args, api) => {
        const a = api.resolve(args["site-a"]!) as Site | undefined;
        const b = api.resolve(args["site-b"]!) as Site | undefined;
        if (!a || !b) return api.printErr("A site vanished — presentation was stale.");
        const cur = (s: Site) => s.hist[s.hist.length - 1]!.toFixed(0);
        const peak = (s: Site) => Math.max(...s.hist).toFixed(0);
        api.print(sitePart(a), ` load ${cur(a)}% peak ${peak(a)}%   vs   `, sitePart(b), ` load ${cur(b)}% peak ${peak(b)}%`);
      },
    },
    {
      name: "Toggle Highlight",
      doc: "Mark/unmark the site's row.",
      args: [{ name: "site", type: "site" }],
      run: (args, api) => {
        const site = api.resolve(args["site"]!) as Site | undefined;
        if (!site) return api.printErr("Stale presentation.");
        world.store.update((s) => ({
          ...s,
          sites: s.sites.map((x) => (x.id === site.id ? { ...x, highlighted: !x.highlighted } : x)),
        }));
        api.print(sitePart(site), site.highlighted ? " unhighlighted." : " highlighted.");
      },
    },
    {
      name: "Reset Site Statistics",
      args: [{ name: "site", type: "site" }],
      run: (args, api) => {
        const site = api.resolve(args["site"]!) as Site | undefined;
        if (!site) return api.printErr("Stale presentation.");
        world.store.update((s) => ({
          ...s,
          sites: s.sites.map((x) =>
            x.id === site.id ? { ...x, hist: x.hist.map(() => x.hist[x.hist.length - 1]!) } : x,
          ),
        }));
        api.print("Statistics reset for ", sitePart(site), ".");
      },
    },
    {
      name: "Reset Service",
      args: [{ name: "service", type: "service" }],
      run: (args, api) => {
        const svc = api.resolve(args["service"]!) as Service | undefined;
        if (!svc) return api.printErr("Stale presentation.");
        world.store.update((s) => ({
          ...s,
          services: s.services.map((x) => (x.id === svc.id ? { ...x, queue: 0, runs: 0 } : x)),
        }));
        api.print(`Reset #<SERVICE ${svc.name}>.`);
      },
    },
    {
      name: "Set Load Threshold",
      doc: "Point at a legend swatch; site labels above it go inverse.",
      args: [{ name: "level", type: "load-level" }],
      run: (args, api) => {
        const v = args["level"]!.ref;
        const level = "value" in v ? (v.value as number) : null;
        world.store.update((s) => ({ ...s, threshold: level }));
        api.print(`Load threshold set to ${level}0% — exceeding sites show inverse labels.`);
      },
    },
    {
      name: "Clear Threshold",
      global: true,
      run: (_a, api) => {
        world.store.update((s) => ({ ...s, threshold: null }));
        api.print("Threshold cleared.");
      },
    },
    {
      name: "Set Update Interval",
      global: true,
      args: [
        {
          name: "milliseconds",
          type: "number",
          input: "typed",
          default: () => ({ type: "number", ref: valueRef(650), label: "650" }),
          validate: (v) => {
            const n = "value" in v.ref ? (v.ref.value as number) : NaN;
            return n >= 100 && n <= 5000 ? true : "interval must be between 100 and 5000 ms";
          },
        },
      ],
      run: (args, api) => {
        const n = (args["milliseconds"]!.ref as { value: number }).value;
        world.store.update((s) => ({ ...s, tickMs: n }));
        api.print(`Update interval set to ${n} ms.`);
      },
    },
    {
      name: "Pause",
      global: true,
      run: (_a, api) => {
        world.store.update((s) => ({ ...s, paused: true }));
        api.print("Simulation paused.");
      },
    },
    {
      name: "Resume",
      global: true,
      run: (_a, api) => {
        world.store.update((s) => ({ ...s, paused: false }));
        api.print("Simulation resumed.");
      },
    },
    {
      name: "Clear Listener",
      global: true,
      run: () => engine.transcript.clear(),
    },
    {
      name: "Show Herald",
      global: true,
      run: (_a, api) => {
        api.print(B("CARE Examiner 4.2"), " — a PBUI port. Every site, service, operator cell and legend swatch is a presentation.");
        api.print("Try: right-click a site → ", B("Compare Sites …"), " then click a second, blinking site.");
      },
    },
  ]);

  const resolver: Resolver = {
    resolve: (ref) => {
      if (!("id" in ref)) return undefined;
      if (ref.kind === "site") return world.site(ref.id);
      if (ref.kind === "service") return world.service(ref.id);
      if (ref.kind === "operator") return Number(ref.id);
      return undefined;
    },
  };
  const engine = new PbuiEngine<World>({
    ptypes,
    commands,
    world,
    resolver,
    idleDoc: "CARE Examiner — hover any presentation; R: menu; background R: global commands.",
  });
  return engine;
}

/* ----------------------------------- view ----------------------------------- */

function SiteRow({ site, threshold }: { site: Site; threshold: number | null }) {
  const cur = site.hist[site.hist.length - 1]!;
  const exceeds = threshold != null && cur >= threshold * 10;
  const cells = site.hist.slice(-32);
  return (
    <Presentation type="site" object={{ kind: "site", id: site.id }} label={site.name} block
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 2px" }}>
      <span
        style={{
          width: 70,
          fontWeight: site.highlighted ? "bold" : undefined,
          background: exceeds ? "var(--pbui-ink)" : undefined,
          color: exceeds ? "var(--pbui-paper)" : undefined,
          textDecoration: site.highlighted ? "underline" : undefined,
        }}
      >
        {site.name}
      </span>
      <span style={{ display: "flex", height: 12, flex: 1, border: "1px solid var(--pbui-ink)" }}>
        {cells.map((v, i) => (
          <span key={i} style={{ flex: 1, ...ditherCSS(levelOf(v)) }} />
        ))}
      </span>
      <span style={{ width: 34, textAlign: "right" }}>{cur.toFixed(0)}%</span>
    </Presentation>
  );
}

function QueueLoadsPane() {
  const engine = useEngineWorld();
  const state = useStore(engine.world.store);
  return (
    <Pane title="Queue Loads" subtitle={`${N_SITES} sites`} style={{ flex: 3, minWidth: 0 }}>
      {state.sites.map((s) => (
        <SiteRow key={s.id} site={s} threshold={state.threshold} />
      ))}
    </Pane>
  );
}

function ServicesPane() {
  const engine = useEngineWorld();
  const state = useStore(engine.world.store);
  return (
    <Pane title="Services" style={{ flex: 2, minWidth: 0 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {["service", "queue", "avg ms", "runs"].map((h) => (
              <th key={h} style={{ textAlign: "left", borderBottom: "1px solid var(--pbui-ink)", padding: "1px 6px" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {state.services.map((svc) => (
            <tr key={svc.id}>
              <td style={{ padding: "1px 6px" }}>
                <Presentation type="service" object={{ kind: "service", id: svc.id }} label={svc.name}>
                  {svc.name}
                </Presentation>
              </td>
              <td style={{ padding: "1px 6px" }}>{svc.queue}</td>
              <td style={{ padding: "1px 6px" }}>{svc.avg.toFixed(1)}</td>
              <td style={{ padding: "1px 6px" }}>{svc.runs}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Pane>
  );
}

function TorusPane() {
  const engine = useEngineWorld();
  const state = useStore(engine.world.store);
  return (
    <Pane title="Operator Torus" subtitle="8×8">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${TORUS}, 16px)`, gap: 1 }}>
        {state.torus.map((v, i) => (
          <Presentation
            key={i}
            type="operator"
            object={{ kind: "operator", id: String(i) }}
            label={`OP-${Math.floor(i / TORUS)}.${i % TORUS}`}
            block
            style={{ width: 16, height: 16, border: "1px solid var(--pbui-ink)", ...ditherCSS(levelOf(v)) }}
          />
        ))}
      </div>
    </Pane>
  );
}

function LegendPane() {
  return (
    <Pane title="Legend" subtitle="load levels are presentations too">
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        {Array.from({ length: 10 }, (_, l) => (
          <Presentation
            key={l}
            type="load-level"
            object={valueRef(l)}
            label={`${l}0%`}
            block
            style={{ width: 22, height: 16, border: "1px solid var(--pbui-ink)", ...ditherCSS(l) }}
            title={`${l}0%`}
          />
        ))}
      </div>
      <div style={{ marginTop: 4, fontStyle: "italic", opacity: 0.75 }}>
        right-click a swatch → Set Load Threshold
      </div>
    </Pane>
  );
}

function NetworkPane() {
  const engine = useEngineWorld();
  const state = useStore(engine.world.store);
  return (
    <Pane title="Network Load">
      <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 48 }}>
        {state.net.slice(-40).map((v, i) => (
          <span key={i} style={{ flex: 1, height: `${Math.max(2, v)}%`, background: "var(--pbui-ink)" }} />
        ))}
      </div>
    </Pane>
  );
}

/* small hack: expose the typed engine through context without re-plumbing */
import { useEngine } from "@go-go-golems/pbui-react";
function useEngineWorld(): PbuiEngine<World> {
  return useEngine<World>();
}

function CareApp({ engine }: { engine: PbuiEngine<World> }) {
  const surface = usePbuiSurface();
  const state = useStore(engine.world.store);

  const heraldRan = useRef(false);
  useEffect(() => {
    if (heraldRan.current) return; // StrictMode double-mount guard
    heraldRan.current = true;
    engine.startCommand("Show Herald");
  }, [engine]);

  // the world ticks while you point; accepting highlights persist
  useEffect(() => {
    const t = setInterval(() => engine.world.store.update(tick), state.tickMs);
    return () => clearInterval(t);
  }, [engine, state.tickMs]);

  return (
    <div className="pbui-root" style={{ height: "100vh", display: "flex", flexDirection: "column" }} {...surface}>
      <div className="demo-back"><a href="#">← demos</a></div>
      <div style={{ display: "flex", gap: 8, padding: 8, flex: 2, minHeight: 0 }}>
        <QueueLoadsPane />
        <ServicesPane />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <TorusPane />
          <LegendPane />
          <NetworkPane />
        </div>
      </div>
      <div style={{ display: "flex", padding: "0 8px 8px", flex: 1, minHeight: 140 }}>
        <Pane title="Listener" style={{ flex: 1 }} bodyStyle={{ padding: 0, display: "flex" }}>
          <Listener style={{ flex: 1 }} prompt="CARE> " />
        </Pane>
      </div>
      <ContextMenuHost />
      <MouseDocBar right={state.paused ? "PAUSED" : `t=${state.simTime.toFixed(0)}s`} />
      <StatusLine user="david" pkg="CARE" host="SATURN" />
    </div>
  );
}

export default function CareExaminerDemo() {
  const engine = useMemo(() => makeEngine(makeWorld()), []);
  return (
    <PbuiProvider engine={engine}>
      <CareApp engine={engine} />
    </PbuiProvider>
  );
}
