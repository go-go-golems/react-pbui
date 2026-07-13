/* Pure derivations for the mouse-doc line and the status-line mode label
 * (decision D8: pull, never push). */

import type { PbuiEngine } from "./engine.js";

/** the classic Genera idle line, available as a default */
export const GENERA_IDLE_DOC =
  "To see other commands, press Shift, Control, Meta-Shift, or Super.";

export function pointerDoc(engine: PbuiEngine<any>): string {
  const { accept, menu } = engine.getState();
  // the keyboard focus cursor documents itself exactly like hover
  const hover = engine.getState().hover ?? engine.focusRecord();
  if (menu) return "Choose an item — Mouse-L selects; [Escape] dismisses.";
  if (accept) {
    const wanted = accept.spec.type.toUpperCase();
    if (hover) {
      if (engine.eligible(hover))
        return `⟨${accept.spec.name}⟩${accept.cmd ? " of " + accept.cmd.name : ""} — L: use ${hover.label}   Esc: abort`;
      if (hover.mode === "active") {
        const dflt = engine.defaultCommandFor(hover);
        if (dflt?.duringAccept)
          return `${hover.label} — L: ${dflt.name} (the pending ${accept.cmd?.name ?? "accept"} keeps waiting).`;
      }
      return `Accepting a ${wanted} — ${hover.label} is not applicable here. [Escape] aborts.`;
    }
    const pt = engine.ptypes.get(accept.spec.type);
    const kbd = pt?.parse ? " or type it at the prompt" : "";
    return `Accepting a ${wanted} — Mouse-L on a highlighted presentation supplies it${kbd}. [Escape] aborts.`;
  }
  if (hover) {
    const dflt = engine.defaultCommandFor(hover);
    const n = engine.applicableCommands(hover).length;
    const left = dflt ? dflt.name : "Describe";
    const obj =
      "value" in hover.ref ? hover.ref.value : engine.resolver.resolve(hover.ref);
    return `${engine.ptypes.print(hover.type, obj, hover.label)} — L: ${left}; M: Describe; R: menu of ${n} command${n === 1 ? "" : "s"}.`;
  }
  return engine.idleDoc;
}

export function modeLabel(engine: PbuiEngine<any>): string {
  const { accept, menu } = engine.getState();
  if (menu) return "Menu Choose";
  if (accept) return `Accept ${accept.spec.type.toUpperCase()}`;
  return "User Input";
}
