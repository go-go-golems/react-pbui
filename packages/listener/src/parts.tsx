/* Output-record part renderer. `pres` parts mount real presentations, so
 * objects mentioned in the transcript stay mouse-sensitive forever
 * (decision D7; scheduler:103). */

import type { OutputPart } from "@go-go-golems/pbui-core";
import { Presentation } from "@go-go-golems/pbui-react";

export function PartView({ part }: { part: OutputPart }) {
  switch (part.t) {
    case "text":
      return <span>{part.s}</span>;
    case "bold":
      return <b>{part.s}</b>;
    case "err":
      return <span className="pbui-line-errpart">{part.s}</span>;
    case "pres":
      return (
        <Presentation type={part.type} object={part.ref} label={part.label} pane="listener">
          {part.label}
        </Presentation>
      );
  }
}
