/* Hello, PBUI — the smallest complete presentation-based app.
 *
 * A fleet of ships. Every ship name on screen (and in the listener
 * transcript) is a typed presentation. Try:
 *   - hover a ship, watch the doc bar
 *   - right-click a ship → command menu; "Compare Ships …" enters an
 *     input context: other ships grow marching ants, everything else dims
 *   - middle-click describes; plain click runs the type's default command
 *   - type at the listener: `compare aurora borealis`, `set speed 12`
 */

import { useEffect, useMemo, useRef } from "react";
import {
  B,
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  valueRef,
  type Resolver,
} from "@go-go-golems/pbui-core";
import { PbuiProvider, Presentation, usePbuiSurface } from "@go-go-golems/pbui-react";
import { ContextMenuHost, MouseDocBar, Pane, StatusLine } from "@go-go-golems/pbui-chrome";
import { Listener } from "@go-go-golems/pbui-listener";
import { Store, useStore } from "../../lib/store.js";

/* --------------------------------- world ---------------------------------- */

interface Ship {
  id: string;
  name: string;
  fuel: number; // 0..100
  speed: number; // knots
}

interface HelloWorld {
  ships: Store<Map<string, Ship>>;
}

function makeWorld(): HelloWorld {
  const ships = new Map<string, Ship>();
  for (const name of ["AURORA", "BOREALIS", "CASSIOPEIA", "DAEDALUS", "ELECTRA", "FOMALHAUT"]) {
    const id = name.toLowerCase();
    ships.set(id, { id, name, fuel: 20 + Math.floor(Math.random() * 70), speed: 8 });
  }
  return { ships: new Store(ships) };
}

/* ------------------------------ ptypes/commands ---------------------------- */

function makeEngine(world: HelloWorld) {
  const ptypes = new PTypes<HelloWorld>();
  defineBuiltinPtypes(ptypes);
  ptypes.define<Ship>({
    name: "ship",
    print: (s) => `#<SHIP ${s.name} fuel=${s.fuel}% speed=${s.speed}kn>`,
    describe: (s) => [
      B(s.name),
      ` — a survey vessel. Fuel ${s.fuel}%, cruising at ${s.speed} knots.`,
    ],
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      for (const s of w.ships.get().values())
        if (s.name === t || s.name.startsWith(t))
          return { ok: true, value: s, ref: { kind: "ship", id: s.id }, label: s.name };
      return { ok: false, err: `${text} does not name a SHIP` };
    },
  });

  const shipRef = (s: Ship) => ({ kind: "ship", id: s.id }) as const;
  const shipPart = (s: Ship) => ({ t: "pres", type: "ship", ref: shipRef(s), label: s.name }) as const;

  const commands = new CommandTable<HelloWorld>();
  commands.defineAll([
    {
      name: "Refuel Ship",
      doc: "Fill the ship's tanks.",
      args: [{ name: "ship", type: "ship" }],
      isDefaultFor: ["ship"],
      run: (args, api) => {
        const s = api.resolve(args["ship"]!) as Ship | undefined;
        if (!s) return api.printErr("That ship is gone.");
        world.ships.update((m) => new Map(m).set(s.id, { ...s, fuel: 100 }));
        api.print(shipPart(s), " refuelled to ", B("100%"), ".");
      },
    },
    {
      name: "Compare Ships",
      doc: "Compare fuel and speed of two ships.",
      args: [
        { name: "ship-a", type: "ship" },
        { name: "ship-b", type: "ship", distinct: true },
      ],
      run: (args, api) => {
        const a = api.resolve(args["ship-a"]!) as Ship | undefined;
        const b = api.resolve(args["ship-b"]!) as Ship | undefined;
        if (!a || !b) return api.printErr("A ship vanished — presentation was stale.");
        api.print(shipPart(a), ` fuel ${a.fuel}% / ${a.speed}kn   vs   `, shipPart(b), ` fuel ${b.fuel}% / ${b.speed}kn`);
      },
    },
    {
      name: "Set Speed",
      doc: "Set a ship's cruising speed.",
      args: [
        { name: "ship", type: "ship" },
        {
          name: "knots",
          type: "number",
          input: "typed",
          default: () => ({ type: "number", ref: valueRef(10), label: "10" }),
        },
      ],
      run: (args, api) => {
        const s = api.resolve(args["ship"]!) as Ship | undefined;
        if (!s) return api.printErr("That ship is gone.");
        const kn = (args["knots"]!.ref as { value: number }).value;
        world.ships.update((m) => new Map(m).set(s.id, { ...s, speed: kn }));
        api.print(shipPart(s), ` now cruising at ${kn} knots.`);
      },
    },
    {
      name: "Show Herald",
      global: true,
      run: (_args, api) => {
        api.print(B("Hello PBUI 1.0"), " — every ship name is a live presentation, even this one: ");
        const first = [...world.ships.get().values()][0]!;
        api.print("  try right-clicking ", shipPart(first), " right here in the transcript.");
      },
    },
    {
      name: "Clear Listener",
      global: true,
      run: () => engine.transcript.clear(),
    },
  ]);

  const resolver: Resolver = {
    resolve: (ref) => ("id" in ref ? world.ships.get().get(ref.id) : undefined),
  };
  const engine = new PbuiEngine<HelloWorld>({
    ptypes,
    commands,
    world,
    resolver,
    idleDoc: "Hover a ship. L: Refuel; M: Describe; R: menu. Type `show herald` below.",
  });
  return engine;
}

/* ---------------------------------- view ----------------------------------- */

function FuelBar({ fuel }: { fuel: number }) {
  return (
    <span style={{ display: "inline-block", width: 120, height: 10, border: "1px solid var(--pbui-ink)", verticalAlign: "middle" }}>
      <span style={{ display: "block", height: "100%", width: `${fuel}%`, background: "var(--pbui-ink)" }} />
    </span>
  );
}

function FleetPane({ world }: { world: HelloWorld }) {
  const ships = useStore(world.ships);
  return (
    <Pane title="Fleet" subtitle="each row is a SHIP presentation" style={{ flex: 1 }}>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {[...ships.values()].map((s) => (
            <tr key={s.id}>
              <td style={{ padding: "3px 8px" }}>
                <Presentation type="ship" object={{ kind: "ship", id: s.id }} label={s.name}>
                  {s.name}
                </Presentation>
              </td>
              <td style={{ padding: "3px 8px" }}>
                <FuelBar fuel={s.fuel} />
              </td>
              <td style={{ padding: "3px 8px" }}>{s.fuel}%</td>
              <td style={{ padding: "3px 8px" }}>{s.speed} kn</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Pane>
  );
}

function HelloApp({ engine, world }: { engine: PbuiEngine<HelloWorld>; world: HelloWorld }) {
  const surface = usePbuiSurface();
  const heraldRan = useRef(false);
  useEffect(() => {
    if (heraldRan.current) return; // StrictMode double-mount guard
    heraldRan.current = true;
    engine.startCommand("Show Herald");
  }, [engine]);
  return (
    <div className="pbui-root" style={{ height: "100vh", display: "flex", flexDirection: "column" }} {...surface}>
      <div className="demo-back"><a href="#">← demos</a></div>
      <div style={{ display: "flex", flex: 1, gap: 8, padding: 8, minHeight: 0 }}>
        <FleetPane world={world} />
        <Pane title="Listener" style={{ flex: 1 }} bodyStyle={{ padding: 0, display: "flex" }}>
          <Listener style={{ flex: 1 }} prompt="HELLO> " />
        </Pane>
      </div>
      <ContextMenuHost />
      <MouseDocBar right="Hello PBUI" />
      <StatusLine user="intern" pkg="HELLO" host="PBUI-DEMOS" />
    </div>
  );
}

export default function HelloDemo() {
  const { engine, world } = useMemo(() => {
    const world = makeWorld();
    return { engine: makeEngine(world), world };
  }, []);
  return (
    <PbuiProvider engine={engine}>
      <HelloApp engine={engine} world={world} />
    </PbuiProvider>
  );
}
