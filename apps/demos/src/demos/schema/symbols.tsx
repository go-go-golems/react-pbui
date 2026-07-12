/* Schematic symbol drawing — port of the original Symbol component.
 * Pure SVG, no engine dependency; also used for placement ghosts. */

import type { Instance, Kind, InstParams } from "./sim.js";

/** the subset of Instance the symbol needs; ghosts have no id yet */
export interface SymbolInst {
  id?: string;
  kind: Kind;
  x: number;
  y: number;
  rot: number;
  params: InstParams;
}

export const asSymbolInst = (i: Instance): SymbolInst => i;

const SW = { stroke: "var(--pbui-ink)", strokeWidth: 1.6, fill: "none" } as const;
const INK = "var(--pbui-ink)";

export function SchemaSymbol({ inst, ghost }: { inst: SymbolInst; ghost?: boolean }) {
  const k = inst.kind;
  const p = inst.params;
  const body = () => {
    switch (k) {
      case "nmos":
      case "pmos":
        return (
          <>
            <line x1={-40} y1={0} x2={k === "pmos" ? -23 : -15} y2={0} {...SW} />
            {k === "pmos" && <circle cx={-19} cy={0} r={4} {...SW} />}
            <line x1={-15} y1={-13} x2={-15} y2={13} {...SW} strokeWidth={2.4} />
            <line x1={-8} y1={-16} x2={-8} y2={16} {...SW} strokeWidth={2.4} />
            <polyline points="-8,-12 0,-12 0,-40" {...SW} />
            <polyline points="-8,12 0,12 0,40" {...SW} />
            <text x={6} y={4} fontSize={10} fill={INK}>
              {p.wl}
            </text>
            {inst.id && (
              <text x={6} y={-8} fontSize={8} fill={INK} opacity={0.65}>
                {inst.id}
              </text>
            )}
          </>
        );
      case "cap":
        return (
          <>
            <line x1={0} y1={-20} x2={0} y2={-4} {...SW} />
            <line x1={0} y1={20} x2={0} y2={4} {...SW} />
            <line x1={-10} y1={-4} x2={10} y2={-4} {...SW} strokeWidth={2.2} />
            <line x1={-10} y1={4} x2={10} y2={4} {...SW} strokeWidth={2.2} />
            <text x={13} y={4} fontSize={9} fill={INK}>
              {p.val}pF
            </text>
          </>
        );
      case "res":
        return (
          <>
            <line x1={0} y1={-20} x2={0} y2={-13} {...SW} />
            <line x1={0} y1={20} x2={0} y2={13} {...SW} />
            <rect x={-6} y={-13} width={12} height={26} {...SW} />
            <text x={10} y={4} fontSize={9} fill={INK}>
              {p.val}k
            </text>
          </>
        );
      case "pad":
        return (
          <>
            <rect x={-8} y={-8} width={16} height={16} {...SW} />
            <rect x={-4} y={-4} width={8} height={8} fill={INK} />
            <line x1={8} y1={0} x2={20} y2={0} {...SW} />
            <text
              x={-13}
              y={4}
              fontSize={10}
              fill={INK}
              textAnchor="end"
              transform={inst.rot ? `rotate(${-inst.rot} -13 0)` : undefined}
            >
              {p.name}
            </text>
          </>
        );
      case "vdd":
        return (
          <>
            <line x1={0} y1={20} x2={0} y2={2} {...SW} />
            <line x1={-9} y1={2} x2={9} y2={2} {...SW} strokeWidth={2.2} />
            <text x={0} y={-4} fontSize={8} fill={INK} textAnchor="middle">
              VDD
            </text>
          </>
        );
      case "gnd":
        return (
          <>
            <line x1={0} y1={-20} x2={0} y2={-6} {...SW} />
            <polygon points="-9,-6 9,-6 0,6" {...SW} />
          </>
        );
    }
  };
  return (
    <g transform={`translate(${inst.x},${inst.y}) rotate(${inst.rot})`} opacity={ghost ? 0.4 : 1}>
      {body()}
    </g>
  );
}
