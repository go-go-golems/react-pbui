/* Deterministic generative "artworks" so the gallery is self-contained —
 * no network images. Each image record carries a seed; the same seed always
 * renders the same piece. Chrome stays monochrome; artworks are content,
 * so they may use color. */

export function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PALETTES: readonly (readonly string[])[] = [
  ["#f4f1ea", "#1b1b1b", "#c0392b", "#2e5e4e"], // constructivist
  ["#101418", "#e8e3d5", "#e0a458", "#3d5a80"], // night
  ["#fdfaf3", "#2d3142", "#ef8354", "#4f5d75"], // riso
  ["#eef0eb", "#0d1321", "#748cab", "#d9b310"], // nautical
  ["#f7f3ee", "#22333b", "#a4243b", "#d8973c"], // bauhaus
  ["#0b0c10", "#c5c6c7", "#66fcf1", "#45a29e"], // terminal
];

export interface ArtSpec {
  seed: number;
  palette: number;
}

/** Render a deterministic abstract piece into a square SVG. */
export function Artwork({ seed, palette, size }: ArtSpec & { size: number }) {
  const rnd = mulberry32(seed);
  const pal = PALETTES[palette % PALETTES.length]!;
  const bg = pal[0]!;
  const shapes: React.ReactNode[] = [];
  const n = 5 + Math.floor(rnd() * 6);
  for (let i = 0; i < n; i++) {
    const c = pal[1 + Math.floor(rnd() * (pal.length - 1))]!;
    const kind = rnd();
    const x = rnd() * 100;
    const y = rnd() * 100;
    const s = 8 + rnd() * 38;
    const op = 0.65 + rnd() * 0.35;
    if (kind < 0.34) {
      shapes.push(<circle key={i} cx={x} cy={y} r={s / 2} fill={c} opacity={op} />);
    } else if (kind < 0.62) {
      shapes.push(
        <rect key={i} x={x - s / 2} y={y - s / 2} width={s} height={s * (0.4 + rnd() * 0.9)}
          fill={c} opacity={op} transform={`rotate(${Math.floor(rnd() * 4) * 45} ${x} ${y})`} />,
      );
    } else if (kind < 0.82) {
      const x2 = rnd() * 100;
      const y2 = rnd() * 100;
      shapes.push(
        <line key={i} x1={x} y1={y} x2={x2} y2={y2} stroke={c} strokeWidth={1.5 + rnd() * 4} opacity={op} />,
      );
    } else {
      shapes.push(
        <path key={i} d={`M ${x} ${y} A ${s} ${s} 0 0 1 ${x + s} ${y + s * (rnd() > 0.5 ? 1 : -1)}`}
          fill="none" stroke={c} strokeWidth={2 + rnd() * 3} opacity={op} />,
      );
    }
  }
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block", background: bg }}>
      {shapes}
    </svg>
  );
}
