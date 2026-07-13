/* SCHEMA — port of sources/schema-schematic-editor.jsx onto @pbui.
 *
 * A Genera / NS-CAD style schematic-capture editor with a toy switch-level
 * SPICE. Every transistor, wire and pin is a typed presentation; Draw
 * Instance and Draw Wire collect LOCATION arguments by clicking the snapped
 * canvas crosshair (the "location accepts" technique from PORTING-NOTES);
 * probed nodes plot in two stacked wave panes after Run Spice.
 *
 * Schematic presentations use duringAccept="fallthrough": while a LOCATION
 * (or any foreign type) is being accepted they go gesture-transparent, so
 * clicks on an instance body reach the canvas and place at that point —
 * the original SPres behavior, restored by CLIM-JSX-005 §5.4 (this closed
 * the former click-swallowing PORTING-GAPS entry). Eligible presentations
 * (pins during node/location accepts, via the pin→location coercion kept
 * for UX) still supply by click as usual.
 *
 * PORTING-GAPS:
 *  - The 5-corner sweep is reduced to one corner (allowed by the brief), so
 *    each probe draws one trace instead of a five-trace bundle.
 *  - The original's canvas context menu ("Draw NMOS here …") is replaced by
 *    the engine's global background menu; placement location is collected
 *    through the accept loop instead of the menu position.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  B,
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  valueRef,
  type ArgValue,
  type ObjectRef,
  type PartLike,
  type Resolver,
} from "@pbui/core";
import {
  PbuiProvider,
  Presentation,
  SvgPresentation,
  useEngine,
  useEngineState,
  usePbuiSurface,
} from "@pbui/react";
import { ContextMenuHost, MouseDocBar, Pane, StatusLine } from "@pbui/chrome";
import { Listener } from "@pbui/listener";
import { Store, useStore } from "../../lib/store.js";
import {
  DEFAULT_PARAMS,
  G,
  ID_BUCKET,
  ID_PREFIX,
  KINDS,
  SOURCES,
  TEND,
  boundsOf,
  buildNetlist,
  instLabel,
  pinsOf,
  runSpice,
  seedState,
  snap,
  type Instance,
  type Kind,
  type NetNode,
  type Netlist,
  type SchemaState,
  type WavePaneState,
  type Wire,
} from "./sim.js";
import { SchemaSymbol, type SymbolInst } from "./symbols.js";

/* --------------------------------- world ---------------------------------- */

interface World {
  store: Store<SchemaState>;
  inst(id: string): Instance | undefined;
  wire(id: string): Wire | undefined;
  /** netlist derived from the current instances+wires, memoized by reference */
  net(): Netlist;
}

function makeWorld(): World {
  const store = new Store(seedState());
  let cache: { instances: Instance[]; wires: Wire[]; net: Netlist } | null = null;
  const net = (): Netlist => {
    const s = store.get();
    if (!cache || cache.instances !== s.instances || cache.wires !== s.wires)
      cache = { instances: s.instances, wires: s.wires, net: buildNetlist(s.instances, s.wires) };
    return cache.net;
  };
  return {
    store,
    inst: (id) => store.get().instances.find((i) => i.id === id),
    wire: (id) => store.get().wires.find((w) => w.id === id),
    net,
  };
}

/* ----------------------------- refs and parts ------------------------------ */

const instRef = (i: Instance): ObjectRef => ({ kind: "instance", id: i.id });
const nodeRef = (name: string): ObjectRef => ({ kind: "node", id: name });
const wireRef = (id: string): ObjectRef => ({ kind: "wire", id });

const instPart = (i: Instance) =>
  ({ t: "pres", type: "instance", ref: instRef(i), label: instLabel(i) }) as const;
const nodePart = (name: string) =>
  ({ t: "pres", type: "node", ref: nodeRef(name), label: name }) as const;
const wirePart = (id: string) =>
  ({ t: "pres", type: "wire", ref: wireRef(id), label: id }) as const;

const locValue = (x: number, y: number): ArgValue => ({
  type: "location",
  ref: valueRef(`${x},${y}`),
  label: `(${x},${y})`,
});

const locOf = (v: ArgValue): { x: number; y: number } => {
  const raw = "value" in v.ref ? String(v.ref.value) : "0,0";
  const m = /(-?\d+)\s*,\s*(-?\d+)/.exec(raw);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: 0, y: 0 };
};

const numOf = (v: ArgValue): number => ("value" in v.ref ? Number(v.ref.value) : NaN);

/* --------------------------------- engine ---------------------------------- */

function describeNode(n: NetNode): PartLike[] {
  const pins = n.pins.map((p) => `${p.inst.id}.${p.pin}`).join(", ");
  return [
    B(`#<NODE ${n.name}>`),
    `  a ${n.kind} node with ${n.pins.length} pin${n.pins.length === 1 ? "" : "s"}` +
      (pins ? ` (${pins})` : "") +
      ". Probe it into a wave pane, then Run Spice.",
  ];
}

function makeEngine(world: World) {
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);

  ptypes.define<Instance>({
    name: "instance",
    print: (i) => `#<${i.kind.toUpperCase()} ${i.id}>`,
    describe: (i, w) => {
      const net = w.net();
      const parts: PartLike[] = [
        B(`#<${i.kind.toUpperCase()} ${i.id}>`),
        `  ${instLabel(i)} at (${i.x},${i.y}) rot ${i.rot}°.  Pins:  `,
      ];
      pinsOf(i).forEach((p, k) => {
        const ni = net.nodeAt(p.x, p.y);
        if (k) parts.push("   ");
        parts.push(`${p.name} → `, ni >= 0 ? nodePart(net.nodes[ni]!.name) : "?");
      });
      if (i.kind === "pad")
        parts.push(
          SOURCES[i.params.name ?? ""]
            ? `   — driven source (waveform ${i.params.name}).`
            : "   — observer pad (high-Z).",
        );
      return parts;
    },
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      const i = w.store
        .get()
        .instances.find(
          (q) => q.id.toUpperCase() === t || (q.kind === "pad" && (q.params.name ?? "").toUpperCase() === t),
        );
      if (i) return { ok: true, value: i, ref: instRef(i), label: i.id };
      return { ok: false, err: `${text} does not name an INSTANCE` };
    },
  });

  ptypes.define<NetNode>({
    name: "node",
    print: (n) => `#<NODE ${n.name}>`,
    describe: (n) => describeNode(n),
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      const n = w.net().nodes.find((nd) => nd.name.toUpperCase() === t);
      if (n) return { ok: true, value: n, ref: nodeRef(n.name), label: n.name };
      return { ok: false, err: `${text} does not name a NODE of the drawn network` };
    },
    defaultCommand: "Probe Node",
  });

  /* a pin is a node presentation anchored at an instance terminal; its ref
   * remembers the terminal so it can also coerce to a LOCATION */
  ptypes.define<NetNode>({
    name: "pin",
    supertypes: ["node"],
    print: (n) => `#<NODE ${n.name}>`,
    describe: (n) => describeNode(n),
    defaultCommand: "Probe Node",
  });

  ptypes.define<Wire>({
    name: "wire",
    print: (wr) => `#<WIRE ${wr.id}>`,
    describe: (wr, w) => {
      const net = w.net();
      const ni = net.wireNode.get(wr.id) ?? -1;
      const parts: PartLike[] = [
        B(`#<WIRE ${wr.id}>`),
        `  from (${wr.x1},${wr.y1}) to (${wr.x2},${wr.y2}) on node `,
      ];
      parts.push(ni >= 0 ? nodePart(net.nodes[ni]!.name) : "?", ".");
      return parts;
    },
    parse: (text, w) => {
      const t = text.trim().toUpperCase();
      const wr = w.store.get().wires.find((q) => q.id.toUpperCase() === t);
      if (wr) return { ok: true, value: wr, ref: wireRef(wr.id), label: wr.id };
      return { ok: false, err: `${text} does not name a WIRE` };
    },
  });

  ptypes.define<string>({
    name: "component-type",
    print: (k) => `#<COMPONENT-TYPE ${String(k).toUpperCase()}>`,
    parse: (text) => {
      const t = text.trim().toLowerCase();
      if ((KINDS as readonly string[]).includes(t))
        return { ok: true, value: t, ref: valueRef(t), label: t.toUpperCase() };
      return { ok: false, err: `${text} is not a component type (${KINDS.join(", ")})` };
    },
  });

  ptypes.define<string>({
    name: "location",
    print: (s) => `(${String(s)})`,
    parse: (text) => {
      const m = /(-?\d+)[ ,]+(-?\d+)/.exec(text.trim());
      if (!m) return { ok: false, err: `${text} is not a LOCATION — type "x,y" or click the canvas` };
      const x = snap(Number(m[1]));
      const y = snap(Number(m[2]));
      return { ok: true, value: `${x},${y}`, ref: valueRef(`${x},${y}`), label: `(${x},${y})` };
    },
  });

  /* ------------------------------- commands -------------------------------- */

  const invalidate = (fn: (s: SchemaState) => SchemaState): void =>
    world.store.update((s) => ({ ...fn(s), sim: null }));

  const paneSpec = (name: string) => ({
    name,
    type: "number",
    input: "typed" as const,
    default: () => ({ type: "number", ref: valueRef(1), label: "1" }),
    validate: (v: ArgValue) => {
      const n = numOf(v);
      return n === 1 || n === 2 ? true : "pane must be 1 or 2";
    },
  });

  const commands = new CommandTable<World>();
  commands.defineAll([
    {
      name: "Draw Instance",
      global: true,
      doc: "Place a component: pick a type from the menu, then click a grid LOCATION on the canvas.",
      args: [
        {
          name: "type",
          type: "component-type",
          input: "menu",
          prompt: "Choose a component type",
          options: () => KINDS.map((k) => ({ label: k.toUpperCase(), ref: valueRef(k) })),
        },
        { name: "location", type: "location", input: "typed" },
      ],
      run: (args, api) => {
        const kv = args["type"]!.ref;
        const kind = ("value" in kv ? String(kv.value) : "nmos") as Kind;
        const { x, y } = locOf(args["location"]!);
        const s = world.store.get();
        const bucket = ID_BUCKET(kind);
        const n = (s.counters[bucket] ?? 0) + 1;
        const inst: Instance = {
          id: `${ID_PREFIX[bucket] ?? "X"}${n}`,
          kind,
          x,
          y,
          rot: 0,
          params: { ...DEFAULT_PARAMS[kind] },
        };
        invalidate((st) => ({
          ...st,
          counters: { ...st.counters, [bucket]: n },
          instances: [...st.instances, inst],
        }));
        api.print("Placed ", instPart(inst), ` at (${x},${y}).`);
        if (kind === "pad")
          api.print(
            "   Pads named PHI1, PHI2, -PHI1, IN, CLK, SIN, PIN are driven sources; others are observers.",
          );
      },
    },
    {
      name: "Draw Wire",
      global: true,
      doc: "Draw a wire segment between two grid points. Wires chain until [Escape].",
      args: [
        { name: "from", type: "location", input: "typed" },
        { name: "to", type: "location", input: "typed", distinct: true },
      ],
      run: (args, api) => {
        const a = locOf(args["from"]!);
        const b = locOf(args["to"]!);
        if (a.x === b.x && a.y === b.y) {
          api.print("Zero-length wire ignored.");
          return;
        }
        const id = `W${world.store.get().wireCount + 1}`;
        invalidate((st) => ({
          ...st,
          wireCount: st.wireCount + 1,
          wires: [...st.wires, { id, x1: a.x, y1: a.y, x2: b.x, y2: b.y }],
        }));
        api.print("Drew ", wirePart(id), ` from (${a.x},${a.y}) to (${b.x},${b.y}).`);
        // chain: the next wire starts where this one ended, until Escape
        api.invoke("Draw Wire", { from: args["to"]! });
      },
    },
    {
      name: "Move Instance",
      doc: "Pick up an instance and put it down at a new LOCATION.",
      args: [
        { name: "instance", type: "instance" },
        { name: "location", type: "location", input: "typed" },
      ],
      run: (args, api) => {
        const inst = api.resolve(args["instance"]!) as Instance | undefined;
        if (!inst) return api.printErr("That instance vanished — presentation was stale.");
        const { x, y } = locOf(args["location"]!);
        invalidate((st) => ({
          ...st,
          instances: st.instances.map((i) => (i.id === inst.id ? { ...i, x, y } : i)),
        }));
        api.print("Moved ", instPart(inst), ` to (${x},${y}).`);
      },
    },
    {
      name: "Rotate Instance",
      doc: "Rotate an instance 90 degrees.",
      args: [{ name: "instance", type: "instance" }],
      run: (args, api) => {
        const inst = api.resolve(args["instance"]!) as Instance | undefined;
        if (!inst) return api.printErr("That instance vanished — presentation was stale.");
        const rot = (inst.rot + 90) % 360;
        invalidate((st) => ({
          ...st,
          instances: st.instances.map((i) => (i.id === inst.id ? { ...i, rot } : i)),
        }));
        api.print("Rotated ", instPart(inst), ` to ${rot}°.`);
      },
    },
    {
      name: "Delete Instance",
      doc: "Remove an instance from the schematic.",
      args: [{ name: "instance", type: "instance" }],
      run: (args, api) => {
        const inst = api.resolve(args["instance"]!) as Instance | undefined;
        if (!inst) return api.printErr("That instance vanished — presentation was stale.");
        invalidate((st) => ({ ...st, instances: st.instances.filter((i) => i.id !== inst.id) }));
        api.print(`Deleted ${instLabel(inst)}.`);
      },
    },
    {
      name: "Delete Wire",
      doc: "Remove a wire segment.",
      args: [{ name: "wire", type: "wire" }],
      run: (args, api) => {
        const wr = api.resolve(args["wire"]!) as Wire | undefined;
        if (!wr) return api.printErr("That wire vanished — presentation was stale.");
        invalidate((st) => ({ ...st, wires: st.wires.filter((w) => w.id !== wr.id) }));
        api.print(`Deleted #<WIRE ${wr.id}>.`);
      },
    },
    {
      name: "Edit Parameter",
      doc: "Set a transistor's W (as W/1) or a cap/resistor value.",
      args: [
        { name: "instance", type: "instance" },
        {
          name: "value",
          type: "number",
          input: "typed",
          validate: (v) => {
            const n = numOf(v);
            return Number.isFinite(n) && n > 0 ? true : "value must be a positive number";
          },
        },
      ],
      run: (args, api) => {
        const inst = api.resolve(args["instance"]!) as Instance | undefined;
        if (!inst) return api.printErr("That instance vanished — presentation was stale.");
        const n = numOf(args["value"]!);
        if (inst.kind === "nmos" || inst.kind === "pmos") {
          invalidate((st) => ({
            ...st,
            instances: st.instances.map((i) =>
              i.id === inst.id ? { ...i, params: { ...i.params, wl: `${n}/1` } } : i,
            ),
          }));
          api.print(instPart(inst), ` W/L set to `, B(`${n}/1`), ".");
        } else if (inst.kind === "cap" || inst.kind === "res") {
          invalidate((st) => ({
            ...st,
            instances: st.instances.map((i) =>
              i.id === inst.id ? { ...i, params: { ...i.params, val: String(n) } } : i,
            ),
          }));
          api.print(instPart(inst), ` value set to `, B(`${n}${inst.kind === "cap" ? "pF" : "k"}`), ".");
        } else {
          api.printErr(`${instLabel(inst)} has no numeric parameter.`);
        }
      },
    },
    {
      name: "Probe Node",
      doc: "Attach a probe: the node's waveform plots in a wave pane after the next Run Spice.",
      args: [{ name: "node", type: "node" }, paneSpec("pane")],
      run: (args, api) => {
        const nd = api.resolve(args["node"]!) as NetNode | undefined;
        if (!nd) return api.printErr("That node no longer exists — presentation was stale.");
        const pid = numOf(args["pane"]!);
        world.store.update((s) => ({
          ...s,
          panes: s.panes.map((p) =>
            p.id === pid
              ? {
                  ...p,
                  probes: p.probes.includes(nd.name) ? p.probes : [...p.probes, nd.name].slice(-5),
                }
              : p,
          ),
        }));
        api.print("Probe attached to ", nodePart(nd.name), ` in pane ${pid}. Run `, B("Run Spice"), " to see it.");
      },
    },
    {
      name: "Clear Pane",
      global: true,
      doc: "Remove all probes and traces from a wave pane (1 or 2).",
      args: [paneSpec("pane")],
      run: (args, api) => {
        const pid = numOf(args["pane"]!);
        world.store.update((s) => ({
          ...s,
          panes: s.panes.map((p) => (p.id === pid ? { ...p, probes: [] } : p)),
        }));
        api.print(`Cleared wave pane ${pid}.`);
      },
    },
    {
      name: "Run Spice",
      global: true,
      doc: "Extract the netlist and run the switch-level simulator; probed nodes plot in the wave panes.",
      run: (_a, api) => {
        api.print("Add nosfet diffusion strays?: Yes  No");
        api.print("SPICE Server: Local  pegasus  cupid  cream-of-wheat  rice-chex");
        api.print("Corner: Typical-HP-Model   (single-corner port of the 5-corner sweep)");
        const t0 = Date.now();
        const net = world.net();
        const result = runSpice(net);
        world.store.update((s) => ({ ...s, sim: result }));
        const ts = new Date().toTimeString().slice(0, 8);
        api.print(
          `[${ts} Your SPICE run is done.  (${result.devCount} devices, ${result.nodeCount} nodes, ${Date.now() - t0} ms)`,
        );
        api.print("          Results are plotted in the chart panes]");
        api.print("Nodes: ", ...net.nodes.flatMap((n): PartLike[] => [nodePart(n.name), "  "]));
      },
    },
    {
      name: "Show Herald",
      global: true,
      run: (_a, api) => {
        api.print(
          B("SCHEMA 1.4"),
          " — presentation-based schematic capture with a toy switch-level SPICE, on @pbui.",
        );
        api.print(
          "right-click the canvas background for global commands; ",
          B("Draw Instance"),
          " places at an accepted LOCATION.",
        );
        api.print(
          "Preloaded: IN → pass NMOS (CLK) → dynamic node → two inverters → OUT.  Try ",
          B("Run Spice"),
          ".",
        );
      },
    },
    {
      name: "Clear Listener",
      global: true,
      run: () => engine.transcript.clear(),
    },
  ]);

  const resolver: Resolver = {
    resolve: (ref) => {
      if (!("id" in ref)) return undefined;
      if (ref.kind === "instance") return world.inst(ref.id);
      if (ref.kind === "wire") return world.wire(ref.id);
      if (ref.kind === "node") return world.net().nodes.find((n) => n.name === ref.id);
      if (ref.kind === "pin") {
        const [iid, pn] = ref.id.split(".");
        const inst = world.inst(iid ?? "");
        if (!inst) return undefined;
        const p = pinsOf(inst).find((q) => q.name === pn);
        if (!p) return undefined;
        const net = world.net();
        const ni = net.nodeAt(p.x, p.y);
        return ni >= 0 ? net.nodes[ni] : undefined;
      }
      return undefined;
    },
  };

  const engine = new PbuiEngine<World>({
    ptypes,
    commands,
    world,
    resolver,
    idleDoc: "SCHEMA — hover any presentation; R: menu; background R: global (drawing) commands.",
  });

  /* a pin can stand in for a LOCATION: wires snap to instance terminals */
  engine.defineCoercion({
    from: "pin",
    to: "location",
    coerce: (pres) => {
      if ("id" in pres.ref) {
        const [iid, pn] = pres.ref.id.split(".");
        const inst = world.inst(iid ?? "");
        const p = inst ? pinsOf(inst).find((q) => q.name === pn) : undefined;
        if (p) return locValue(p.x, p.y);
      }
      return locValue(0, 0);
    },
  });
  /* a wire can stand in for its NODE: click a wire to probe its net */
  engine.defineCoercion({
    from: "wire",
    to: "node",
    coerce: (pres) => {
      const id = "id" in pres.ref ? pres.ref.id : "";
      const net = world.net();
      const ni = net.wireNode.get(id) ?? -1;
      const name = ni >= 0 ? net.nodes[ni]!.name : "?";
      return { type: "node", ref: nodeRef(name), label: name };
    },
  });

  return engine;
}

/* ------------------------------ schematic pane ----------------------------- */

const VIEW_W = 660;
const VIEW_H = 470;

type Ghost =
  | { kind: "inst"; inst: SymbolInst }
  | { kind: "wire"; from: { x: number; y: number } }
  | null;

function SchematicCanvas() {
  const engine = useEngine<World>();
  const state = useStore(engine.world.store);
  const es = useEngineState();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hp, setHp] = useState<{ x: number; y: number } | null>(null);

  const net = engine.world.net();
  const acc = es.accept;
  const acceptingLoc = acc?.spec.type === "location";

  const toSvg = (e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: snap(p.x), y: snap(p.y) };
  };

  /* what to draw at the crosshair (read pending values from the accept) */
  let ghost: Ghost = null;
  if (acceptingLoc && acc) {
    const cname = acc.cmd?.name;
    if (cname === "Draw Instance") {
      const tv = acc.values["type"];
      if (tv && "value" in tv.ref) {
        const k = String(tv.ref.value) as Kind;
        ghost = { kind: "inst", inst: { kind: k, x: 0, y: 0, rot: 0, params: { ...DEFAULT_PARAMS[k] } } };
      }
    } else if (cname === "Draw Wire") {
      const fv = acc.values["from"];
      if (fv) ghost = { kind: "wire", from: locOf(fv) };
    } else if (cname === "Move Instance") {
      const iv = acc.values["instance"];
      if (iv && "id" in iv.ref) {
        const inst = engine.world.inst(iv.ref.id);
        if (inst) ghost = { kind: "inst", inst: { ...inst } };
      }
    }
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        cursor: acceptingLoc ? "crosshair" : undefined,
      }}
      onMouseMove={(e) => {
        if (acceptingLoc) setHp(toSvg(e));
      }}
      onMouseLeave={() => setHp(null)}
      onClick={(e) => {
        if (!acceptingLoc) return; // background clicks bubble to the surface
        e.stopPropagation();
        const { x, y } = toSvg(e);
        engine.supplyValue(locValue(x, y));
      }}
    >
      <defs>
        <pattern id="schema-grid" width={G} height={G} patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="1.2" height="1.2" fill="var(--pbui-ink)" opacity="0.35" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="url(#schema-grid)" />

      {/* wires */}
      {state.wires.map((w) => {
        const ni = net.wireNode.get(w.id) ?? -1;
        const nn = ni >= 0 ? net.nodes[ni]!.name : "?";
        return (
          <SvgPresentation
            key={w.id}
            type="wire"
            object={wireRef(w.id)}
            label={`${w.id} (node ${nn})`}
            duringAccept="fallthrough"
            hitRect={{
              x: Math.min(w.x1, w.x2) - 3,
              y: Math.min(w.y1, w.y2) - 3,
              width: Math.abs(w.x2 - w.x1) + 6,
              height: Math.abs(w.y2 - w.y1) + 6,
            }}
          >
            <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="var(--pbui-ink)" strokeWidth={1.7} />
          </SvgPresentation>
        );
      })}

      {/* instances */}
      {state.instances.map((inst) => {
        const b = boundsOf(inst);
        return (
          <SvgPresentation
            key={inst.id}
            type="instance"
            object={instRef(inst)}
            label={instLabel(inst)}
            duringAccept="fallthrough"
            hitRect={{ x: b.x, y: b.y, width: b.w, height: b.h }}
          >
            <SchemaSymbol inst={inst} />
          </SvgPresentation>
        );
      })}

      {/* pins as node presentations layered on top (nested sensitivity) */}
      {state.instances.map((inst) =>
        pinsOf(inst).map((p) => {
          const ni = net.nodeAt(p.x, p.y);
          const nn = ni >= 0 ? net.nodes[ni]!.name : "?";
          return (
            <SvgPresentation
              key={`${inst.id}.${p.name}`}
              type="pin"
              object={{ kind: "pin", id: `${inst.id}.${p.name}` }}
              label={`${nn} (pin ${inst.id}.${p.name})`}
              duringAccept="fallthrough"
              hitRect={{ x: p.x - 4, y: p.y - 4, width: 8, height: 8 }}
            >
              <rect x={p.x - 2.5} y={p.y - 2.5} width={5} height={5} fill="var(--pbui-ink)" />
            </SvgPresentation>
          );
        }),
      )}

      {/* snapped crosshair + placement ghost / rubber wire */}
      {acceptingLoc && hp && (
        <g pointerEvents="none">
          <line x1={hp.x - 12} y1={hp.y} x2={hp.x + 12} y2={hp.y} stroke="var(--pbui-ink)" strokeWidth={1} />
          <line x1={hp.x} y1={hp.y - 12} x2={hp.x} y2={hp.y + 12} stroke="var(--pbui-ink)" strokeWidth={1} />
          {ghost?.kind === "inst" && <SchemaSymbol inst={{ ...ghost.inst, x: hp.x, y: hp.y }} ghost />}
          {ghost?.kind === "wire" && (
            <line
              x1={ghost.from.x}
              y1={ghost.from.y}
              x2={hp.x}
              y2={hp.y}
              stroke="var(--pbui-ink)"
              strokeWidth={1.2}
              strokeDasharray="5 4"
            />
          )}
        </g>
      )}
    </svg>
  );
}

/* -------------------------------- wave panes ------------------------------- */

const DASHES = ["", "7 4", "2 4", "10 3 2 3", "1 3"];

function WavePane({ pane }: { pane: WavePaneState }) {
  const engine = useEngine<World>();
  const state = useStore(engine.world.store);
  const sim = state.sim;
  const W = 560;
  const H = 250;
  const PL = 40;
  const PR = 12;
  const PT = 8;
  const PB = 22;
  const x = (tn: number) => PL + (tn / TEND) * (W - PL - PR);
  const y = (v: number) => PT + (1 - (v + 1) / 7) * (H - PT - PB); // -1 .. 6 V

  return (
    <Pane
      title={`Wave Pane ${pane.id}`}
      subtitle={sim ? sim.corner : "unsimulated"}
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
      bodyStyle={{ flex: 1, minHeight: 0, padding: 0, display: "flex", flexDirection: "column" }}
    >
      <div style={{ padding: "2px 8px", fontSize: 11, borderBottom: "1px solid var(--pbui-ink)", minHeight: 20 }}>
        {pane.probes.length === 0 && (
          <span style={{ opacity: 0.55 }}>No probes — Probe Node, or click a pin.</span>
        )}
        {pane.probes.map((n, i) => (
          <span key={n} style={{ marginRight: 12, whiteSpace: "nowrap" }}>
            <svg width="24" height="8" style={{ verticalAlign: "middle", marginRight: 3 }}>
              <line
                x1="0"
                y1="4"
                x2="24"
                y2="4"
                stroke="var(--pbui-ink)"
                strokeWidth="2"
                strokeDasharray={DASHES[i % DASHES.length]}
              />
            </svg>
            <Presentation type="node" object={nodeRef(n)} label={n}>
              {n}
            </Presentation>
          </span>
        ))}
        {!sim && pane.probes.length > 0 && <span style={{ opacity: 0.55 }}> — run Run Spice</span>}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", flex: 1, display: "block", minHeight: 0 }}
      >
        {[-1, 0, 1, 2, 3, 4, 5, 6].map((v) => (
          <g key={v}>
            <line
              x1={PL}
              x2={W - PR}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--pbui-ink)"
              strokeOpacity="0.28"
              strokeDasharray="2 5"
            />
            <text x={PL - 4} y={y(v) + 3} fontSize="8.5" textAnchor="end" fill="var(--pbui-ink)">
              {v.toFixed(1)}
            </text>
          </g>
        ))}
        {[0, 2, 4, 6, 8, 10].map((tn) => (
          <g key={tn}>
            <line
              x1={x(tn)}
              x2={x(tn)}
              y1={PT}
              y2={H - PB}
              stroke="var(--pbui-ink)"
              strokeOpacity="0.28"
              strokeDasharray="2 5"
            />
            <text x={x(tn)} y={H - 10} fontSize="8.5" textAnchor="middle" fill="var(--pbui-ink)">
              {tn.toFixed(1)}
            </text>
          </g>
        ))}
        <rect x={PL} y={PT} width={W - PL - PR} height={H - PT - PB} fill="none" stroke="var(--pbui-ink)" />
        <text x={W - PR} y={H - 1} fontSize="8.5" textAnchor="end" fill="var(--pbui-ink)">
          X 1.0e-9
        </text>
        {sim &&
          pane.probes.map((name, pi) => {
            const trace = sim.byName[name];
            if (!trace) return null;
            const points = trace
              .map((v, i) => `${x(sim.t[i] ?? 0).toFixed(1)},${y(v).toFixed(1)}`)
              .join(" ");
            return (
              <polyline
                key={name}
                points={points}
                fill="none"
                stroke="var(--pbui-ink)"
                strokeWidth={1.2}
                strokeDasharray={DASHES[pi % DASHES.length]}
              />
            );
          })}
      </svg>
    </Pane>
  );
}

/* ----------------------------------- shell --------------------------------- */

function SchemaApp({ engine }: { engine: PbuiEngine<World> }) {
  const surface = usePbuiSurface();
  const state = useStore(engine.world.store);
  const net = engine.world.net();

  const heraldRan = useRef(false);
  useEffect(() => {
    if (heraldRan.current) return; // StrictMode double-mount guard
    heraldRan.current = true;
    engine.startCommand("Show Herald");
  }, [engine]);

  return (
    <div
      className="pbui-root"
      style={{ height: "100vh", display: "flex", flexDirection: "column" }}
      {...surface}
    >
      <div className="demo-back">
        <a href="#">← demos</a>
      </div>
      <div style={{ display: "flex", gap: 8, padding: 8, flex: 5, minHeight: 0 }}>
        <Pane
          title="Schematic"
          subtitle={`grid ${G} · ${state.instances.length} instances · ${state.wires.length} wires · ${net.nodes.length} nodes${state.sim ? "" : " · unsimulated"}`}
          style={{ flex: 11, minWidth: 0, display: "flex", flexDirection: "column" }}
          bodyStyle={{ flex: 1, minHeight: 0, padding: 0, display: "flex" }}
        >
          <SchematicCanvas />
        </Pane>
        <div style={{ flex: 9, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          {state.panes.map((p) => (
            <WavePane key={p.id} pane={p} />
          ))}
        </div>
      </div>
      <div style={{ display: "flex", padding: "0 8px 8px", flex: 2, minHeight: 140 }}>
        <Pane title="Listener" style={{ flex: 1 }} bodyStyle={{ padding: 0, display: "flex" }}>
          <Listener style={{ flex: 1 }} prompt="SCHEMA> " />
        </Pane>
      </div>
      <ContextMenuHost />
      <MouseDocBar right={state.sim ? "SPICE results loaded" : "Unsimulated"} />
      <StatusLine user="pigpen" pkg="SCHEMA" host="NS-CAD" />
    </div>
  );
}

export default function SchemaDemo() {
  const engine = useMemo(() => makeEngine(makeWorld()), []);
  return (
    <PbuiProvider engine={engine}>
      <SchemaApp engine={engine} />
    </PbuiProvider>
  );
}
