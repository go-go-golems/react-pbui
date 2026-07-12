/* SCHEMA domain model, netlist extraction and the toy switch-level SPICE.
 * Ported from sources/schema-schematic-editor.jsx (SCHEMA-1).
 *
 * Simplifications vs. the original (allowed by the port brief):
 *  - runSpice sweeps ONE corner (Typical-HP-Model) instead of five;
 *  - DT doubled (0.01ns) so a run records ~200 timesteps.
 * The math (explicit Euler over conductances scaled by W/L, grounded-cap
 * approximation) is otherwise the original's.
 */

/* --------------------------------- grid ---------------------------------- */

export const G = 20; // virtual grid pitch
export const snap = (v: number): number => Math.round(v / G) * G;

/* ----------------------------- component kinds --------------------------- */

export const KINDS = ["nmos", "pmos", "cap", "res", "pad", "vdd", "gnd"] as const;
export type Kind = (typeof KINDS)[number];

export interface InstParams {
  wl?: string; // "W/L" for mos
  val?: string; // pF for cap, kΩ for res
  name?: string; // pad name
}

export interface Instance {
  id: string;
  kind: Kind;
  x: number;
  y: number;
  rot: number; // 0 | 90 | 180 | 270
  params: InstParams;
}

export interface Wire {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WavePaneState {
  id: number;
  probes: string[]; // node names, max 5
}

export interface SchemaState {
  instances: Instance[];
  wires: Wire[];
  panes: WavePaneState[];
  sim: SimResult | null;
  /** per-kind id counters (nmos+pmos share the "mos" bucket → M#) */
  counters: Record<string, number>;
  wireCount: number;
}

interface PinDef {
  n: string;
  x: number;
  y: number;
}

const PIN_DEFS: Record<Kind, PinDef[]> = {
  nmos: [{ n: "G", x: -40, y: 0 }, { n: "D", x: 0, y: -40 }, { n: "S", x: 0, y: 40 }],
  pmos: [{ n: "G", x: -40, y: 0 }, { n: "S", x: 0, y: -40 }, { n: "D", x: 0, y: 40 }],
  cap: [{ n: "A", x: 0, y: -20 }, { n: "B", x: 0, y: 20 }],
  res: [{ n: "A", x: 0, y: -20 }, { n: "B", x: 0, y: 20 }],
  pad: [{ n: "P", x: 20, y: 0 }],
  vdd: [{ n: "P", x: 0, y: 20 }],
  gnd: [{ n: "P", x: 0, y: -20 }],
};

export const DEFAULT_PARAMS: Record<Kind, InstParams> = {
  nmos: { wl: "8/1" },
  pmos: { wl: "12/1" },
  cap: { val: "0.2" },
  res: { val: "10" },
  pad: { name: "IN" },
  vdd: {},
  gnd: {},
};

export const ID_BUCKET = (kind: Kind): string =>
  kind === "nmos" || kind === "pmos" ? "mos" : kind;

export const ID_PREFIX: Record<string, string> = {
  mos: "M",
  cap: "C",
  res: "R",
  pad: "P",
  vdd: "V",
  gnd: "GN",
};

export const rotXY = (x: number, y: number, r: number): [number, number] => {
  if (r === 90) return [-y, x];
  if (r === 180) return [-x, -y];
  if (r === 270) return [y, -x];
  return [x, y];
};

export interface Pin {
  name: string;
  x: number;
  y: number;
}

export const pinsOf = (inst: Instance): Pin[] =>
  PIN_DEFS[inst.kind].map((p) => {
    const [dx, dy] = rotXY(p.x, p.y, inst.rot);
    return { name: p.n, x: inst.x + dx, y: inst.y + dy };
  });

export const instLabel = (inst: Instance): string =>
  inst.kind === "pad"
    ? `PAD ${inst.params.name ?? "?"}`
    : inst.kind === "vdd"
      ? "VDD"
      : inst.kind === "gnd"
        ? "GND"
        : `${inst.id} (${inst.kind.toUpperCase()} ${inst.params.wl ?? inst.params.val ?? ""})`;

/* rotation-aware bounding boxes for hitRects (original BOUNDS + boundsOf) */

const BOUNDS: Record<Kind, { x: number; y: number; w: number; h: number }> = {
  nmos: { x: -44, y: -42, w: 74, h: 84 },
  pmos: { x: -44, y: -42, w: 74, h: 84 },
  cap: { x: -14, y: -22, w: 52, h: 44 },
  res: { x: -12, y: -22, w: 44, h: 44 },
  pad: { x: -44, y: -12, w: 66, h: 24 },
  vdd: { x: -12, y: -14, w: 24, h: 36 },
  gnd: { x: -12, y: -22, w: 24, h: 30 },
};

export const boundsOf = (inst: Instance): { x: number; y: number; w: number; h: number } => {
  const b = BOUNDS[inst.kind];
  const corners: [number, number][] = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ].map(([x, y]) => rotXY(x!, y!, inst.rot));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    x: inst.x + Math.min(...xs),
    y: inst.y + Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
};

/* driven waveforms for known pad names (t in ns) */
export const SOURCES: Record<string, (t: number) => number> = {
  PHI1: (t) => (t % 4 < 2 ? 5 : 0),
  PHI2: (t) => (t % 4 < 2 ? 0 : 5),
  "-PHI1": (t) => (t % 4 < 2 ? 0 : 5),
  CLK: (t) => (t % 4 < 2 ? 5 : 0),
  IN: (t) => {
    const p = t % 8;
    return p >= 1 && p < 5 ? 5 : 0;
  },
  SIN: (t) => {
    const p = t % 8;
    return p >= 1 && p < 5 ? 5 : 0;
  },
  PIN: (t) => {
    const p = t % 8;
    return p >= 3 && p < 7 ? 5 : 0;
  },
};

/* ---------------------------- netlist extraction -------------------------- */

const key = (x: number, y: number): string => `${x},${y}`;

function onSegment(px: number, py: number, w: Wire): boolean {
  const minx = Math.min(w.x1, w.x2);
  const maxx = Math.max(w.x1, w.x2);
  const miny = Math.min(w.y1, w.y2);
  const maxy = Math.max(w.y1, w.y2);
  if (px < minx - 1 || px > maxx + 1 || py < miny - 1 || py > maxy + 1) return false;
  const cross = (w.x2 - w.x1) * (py - w.y1) - (w.y2 - w.y1) * (px - w.x1);
  return Math.abs(cross) < 1;
}

export type NodeKind = "vdd" | "gnd" | "driven" | "internal";

export interface NetNode {
  name: string;
  kind: NodeKind;
  pins: { inst: Instance; pin: string }[];
}

export interface Device {
  inst: Instance;
  kind: "nmos" | "pmos" | "cap" | "res";
  a: number;
  b: number;
  g: number; // -1 for cap/res
}

export interface Netlist {
  nodes: NetNode[];
  devices: Device[];
  /** node index at a grid point, or -1 */
  nodeAt: (x: number, y: number) => number;
  /** wire id → node index */
  wireNode: Map<string, number>;
}

/** Union-find over pin/wire endpoints with T-junction collinearity, then
 * node naming VDD / GND / pad-name / N#. Faithful port of buildNetlist. */
export function buildNetlist(instances: Instance[], wires: Wire[]): Netlist {
  const idx = new Map<string, number>();
  const parent: number[] = [];
  const find = (i: number): number => {
    let r = i;
    while (parent[r]! !== r) r = parent[r]!;
    let c = i;
    while (parent[c]! !== c) {
      const next = parent[c]!;
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };
  const pt = (x: number, y: number): number => {
    const k = key(x, y);
    const got = idx.get(k);
    if (got !== undefined) return got;
    const i = parent.length;
    idx.set(k, i);
    parent.push(i);
    return i;
  };

  for (const inst of instances) for (const p of pinsOf(inst)) pt(p.x, p.y);
  for (const w of wires) union(pt(w.x1, w.y1), pt(w.x2, w.y2));
  // T-junctions: any registered point lying on a wire joins it
  for (const [k, i] of Array.from(idx)) {
    const [px, py] = k.split(",").map(Number);
    for (const w of wires) if (onSegment(px!, py!, w)) union(i, pt(w.x1, w.y1));
  }

  // group roots → nodes
  const rootToNode = new Map<number, number>();
  const nodes: NetNode[] = [];
  const nodeAt = (x: number, y: number): number => {
    const k = key(x, y);
    const i = idx.get(k);
    if (i === undefined) return -1;
    const r = find(i);
    let n = rootToNode.get(r);
    if (n === undefined) {
      n = nodes.length;
      rootToNode.set(r, n);
      nodes.push({ name: "", kind: "internal", pins: [] });
    }
    return n;
  };

  for (const inst of instances)
    for (const p of pinsOf(inst)) {
      const n = nodeAt(p.x, p.y);
      if (n >= 0) nodes[n]!.pins.push({ inst, pin: p.name });
    }
  const wireNode = new Map<string, number>();
  for (const w of wires) wireNode.set(w.id, nodeAt(w.x1, w.y1));

  // naming: VDD / GND / pad name / N#
  for (const nd of nodes) {
    if (nd.pins.some((p) => p.inst.kind === "vdd")) {
      nd.name = "VDD";
      nd.kind = "vdd";
    } else if (nd.pins.some((p) => p.inst.kind === "gnd")) {
      nd.name = "GND";
      nd.kind = "gnd";
    }
  }
  for (const nd of nodes) {
    if (nd.name) continue;
    const pad = nd.pins.find((p) => p.inst.kind === "pad");
    if (pad) {
      nd.name = pad.inst.params.name ?? "PAD";
      nd.kind = SOURCES[nd.name] ? "driven" : "internal";
    }
  }
  let n = 1;
  for (const nd of nodes) if (!nd.name) nd.name = "N" + n++;

  const nodeOfPin = (inst: Instance, pinName: string): number => {
    const p = pinsOf(inst).find((q) => q.name === pinName);
    return p ? nodeAt(p.x, p.y) : -1;
  };

  const devices: Device[] = instances
    .filter(
      (i): i is Instance & { kind: Device["kind"] } =>
        i.kind === "nmos" || i.kind === "pmos" || i.kind === "cap" || i.kind === "res",
    )
    .map((i) => {
      const defs = PIN_DEFS[i.kind];
      const twoPin = i.kind === "cap" || i.kind === "res";
      return {
        inst: i,
        kind: i.kind,
        a: nodeOfPin(i, defs[twoPin ? 0 : 1]!.n),
        b: nodeOfPin(i, defs[twoPin ? 1 : 2]!.n),
        g: i.kind === "nmos" || i.kind === "pmos" ? nodeOfPin(i, "G") : -1,
      };
    });

  return { nodes, devices, nodeAt, wireNode };
}

/* ------------------------- toy switch-level SPICE ------------------------- */

const VDD_V = 5;
const VTH = 1;
export const TEND = 10; // ns
const DT = 0.01;
const RECORD = 5; // → 201 recorded points

export const CORNER = "Typical-HP-Model";

export interface SimResult {
  t: number[];
  /** node name → recorded voltage trace */
  byName: Record<string, number[]>;
  nodeCount: number;
  devCount: number;
  corner: string;
}

export function runSpice(net: Netlist): SimResult {
  const N = net.nodes.length;
  const wl = (inst: Instance): number => {
    const m = /([\d.]+)\s*\/\s*([\d.]+)/.exec(inst.params.wl ?? "1/1");
    return m ? parseFloat(m[1]!) / parseFloat(m[2]!) : 1;
  };

  // node capacitance: base + gate loads + explicit caps (grounded-cap approx)
  const C = new Array<number>(N).fill(1);
  for (const d of net.devices) {
    if ((d.kind === "nmos" || d.kind === "pmos") && d.g >= 0)
      C[d.g] = C[d.g]! + 0.6 + wl(d.inst) * 0.02;
    if (d.kind === "cap") {
      const v = parseFloat(d.inst.params.val ?? "") || 0.1;
      if (d.a >= 0) C[d.a] = C[d.a]! + v * 20;
      if (d.b >= 0) C[d.b] = C[d.b]! + v * 20;
    }
  }

  const driven: Array<((t: number) => number) | null> = net.nodes.map((nd) =>
    nd.kind === "vdd" ? () => VDD_V : nd.kind === "gnd" ? () => 0 : SOURCES[nd.name] ?? null,
  );

  const steps = Math.round(TEND / DT);
  const t: number[] = [];
  const data: number[][] = net.nodes.map(() => []);
  const K = 0.55; // Typical corner (k = 1.0)

  const V = net.nodes.map((_, i) => {
    const d = driven[i];
    return d ? d(0) : 0;
  });
  for (let s = 0; s <= steps; s++) {
    const time = s * DT;
    for (let i = 0; i < N; i++) {
      const d = driven[i];
      if (d) V[i] = d(time);
    }
    const dv = new Array<number>(N).fill(0);
    for (const d of net.devices) {
      if (d.a < 0 || d.b < 0) continue;
      const va = V[d.a]!;
      const vb = V[d.b]!;
      let g = 0;
      if (d.kind === "res") g = 2 / (parseFloat(d.inst.params.val ?? "") || 10);
      else if (d.kind === "nmos") {
        const ov = V[d.g]! - Math.min(va, vb) - VTH;
        g = K * wl(d.inst) * Math.max(0, Math.min(1, ov / (VDD_V - VTH)));
      } else if (d.kind === "pmos") {
        const ov = Math.max(va, vb) - V[d.g]! - VTH;
        g = K * wl(d.inst) * Math.max(0, Math.min(1, ov / (VDD_V - VTH)));
      } else continue; // cap handled via C
      const f = g * (vb - va);
      dv[d.a] = dv[d.a]! + f;
      dv[d.b] = dv[d.b]! - f;
    }
    for (let i = 0; i < N; i++)
      if (!driven[i]) V[i] = Math.max(-0.5, Math.min(5.5, V[i]! + (DT / C[i]!) * dv[i]!));
    if (s % RECORD === 0) {
      t.push(time);
      for (let i = 0; i < N; i++) data[i]!.push(V[i]!);
    }
  }

  const byName: Record<string, number[]> = {};
  net.nodes.forEach((nd, i) => {
    byName[nd.name] = data[i]!;
  });
  return { t, byName, nodeCount: N, devCount: net.devices.length, corner: CORNER };
}

/* ---------------------------- preloaded circuit ---------------------------- */
/* dynamic pass-gate stage + two CMOS inverters (the original's preload),
 * with pads renamed IN / CLK / OUT per the port brief */

export function seedState(): SchemaState {
  const counters: Record<string, number> = {};
  const instances: Instance[] = [];
  const mk = (kind: Kind, x: number, y: number, extra?: { rot?: number; params?: InstParams }): Instance => {
    const bucket = ID_BUCKET(kind);
    const n = (counters[bucket] ?? 0) + 1;
    counters[bucket] = n;
    const inst: Instance = {
      id: `${ID_PREFIX[bucket] ?? "X"}${n}`,
      kind,
      x,
      y,
      rot: extra?.rot ?? 0,
      params: { ...DEFAULT_PARAMS[kind], ...extra?.params },
    };
    instances.push(inst);
    return inst;
  };

  mk("pad", 60, 240, { params: { name: "IN" } });
  mk("pad", 140, 120, { params: { name: "CLK" } });
  mk("nmos", 160, 240, { rot: 90, params: { wl: "24/1" } }); // pass gate
  mk("cap", 200, 300, { params: { val: "0.2" } });
  mk("gnd", 200, 340);
  mk("pmos", 280, 160, { params: { wl: "12/1" } }); // inverter 1
  mk("nmos", 280, 280, { params: { wl: "14/1" } });
  mk("vdd", 280, 100);
  mk("gnd", 280, 340);
  mk("pmos", 380, 160, { params: { wl: "12/1" } }); // inverter 2
  mk("nmos", 380, 280, { params: { wl: "14/1" } });
  mk("vdd", 380, 100);
  mk("gnd", 380, 340);
  mk("pad", 460, 220, { rot: 180, params: { name: "OUT" } });

  const coords: [number, number, number, number][] = [
    [80, 240, 120, 240],
    [160, 120, 160, 200],
    [200, 240, 240, 240],
    [200, 240, 200, 280],
    [240, 160, 240, 280],
    [280, 200, 280, 240],
    [280, 220, 340, 220],
    [340, 160, 340, 280],
    [380, 200, 380, 240],
    [380, 220, 440, 220],
  ];
  const wires: Wire[] = coords.map(([x1, y1, x2, y2], i) => ({ id: `W${i + 1}`, x1, y1, x2, y2 }));

  return {
    instances,
    wires,
    panes: [
      { id: 1, probes: ["IN", "OUT"] },
      { id: 2, probes: ["CLK", "N1"] },
    ],
    sim: null,
    counters,
    wireCount: wires.length,
  };
}
