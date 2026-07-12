/* Canonical text rendering of transcript records.
 *
 * This is the format the golden-transcript tests pin: the echo grammar is
 * a specification, and refactors must not move a character of it.
 *
 *   [echo] Command: Compare Sites (site-a) {site SITE-ALPHA}
 *   [out]  Compared **SITE-ALPHA** with ...
 *   [err]  ...
 *
 * pres parts render as {type label}, bold as **text**.
 */

import type { OutputRecord } from "./types.js";

export function renderRecord(rec: OutputRecord): string {
  const body = rec.parts
    .map((p) => {
      switch (p.t) {
        case "text":
          return p.s;
        case "bold":
          return `**${p.s}**`;
        case "err":
          return p.s;
        case "pres":
          return `{${p.type} ${p.label}}`;
      }
    })
    .join("");
  return `[${rec.kind.padEnd(4)}] ${body}`;
}

export function renderTranscript(records: OutputRecord[]): string {
  return records.map(renderRecord).join("\n") + "\n";
}
