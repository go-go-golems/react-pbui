/* GALLERY — an are.na-style image gallery browser as a PBUI.
 *
 * Images, tags and channels are all typed presentations:
 *   - left-click an image card → Show Image (opens the inspector)
 *   - left-click a tag chip (even inside a card) → Filter By Tag
 *   - left-click a channel → Show Channel (filters the grid)
 *   - right-click an image → Rename / Set Attribute / Tag / Connect …
 *   - "Tag Image" accepts a tag by pointing at any tag chip OR by typing
 *     a brand-new tag name at the prompt (created on the fly)
 *   - everything printed to the listener stays live: filter from there too
 *
 * PORTING-GAPS: none — built directly on PBUI.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  B,
  CommandTable,
  PbuiEngine,
  PTypes,
  defineBuiltinPtypes,
  valueRef,
  type ArgValue,
  type ObjectRef,
  type OutputPart,
  type Resolver,
} from "@go-go-golems/pbui-core";
import { PbuiProvider, Presentation, useEngine, usePbuiSurface } from "@go-go-golems/pbui-react";
import { ContextMenuHost, MouseDocBar, Pane, StatusLine } from "@go-go-golems/pbui-chrome";
import { Listener } from "@go-go-golems/pbui-listener";
import { Store, useStore } from "../../lib/store.js";
import { Artwork, PALETTES, mulberry32 } from "./art.js";

/* ---------------------------------- domain --------------------------------- */

interface Image {
  id: string;
  title: string;
  artist: string;
  year: string;
  medium: string;
  source: string;
  seed: number;
  palette: number;
  tags: string[]; // normalized tag names
  channels: string[]; // channel ids
}

interface Channel {
  id: string;
  name: string;
}

type Filter = { kind: "tag"; tag: string } | { kind: "channel"; id: string } | null;

interface GalleryState {
  images: Image[];
  channels: Channel[];
  /** the tag universe; includes tags not currently on any image */
  tags: string[];
  filter: Filter;
  selectedId: string | null;
}

const normTag = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

function seedState(): GalleryState {
  const rnd = mulberry32(0xa54a);
  const mediums = ["screen print", "gouache", "plotter ink", "risograph", "collage", "oil on panel"];
  const artists = ["M. Albers-Nagy", "R. Tufte", "H. Nakamura", "E. Vasarely", "A. Riley", "K. Noland"];
  const titleWords = ["Composition", "Study", "Signal", "Field", "Interval", "Lattice", "Cascade", "Meridian"];
  const baseTags = ["geometric", "monochrome", "grid", "warm", "brutalist", "generative", "archive"];
  const images: Image[] = Array.from({ length: 12 }, (_, i) => {
    const tags = baseTags.filter(() => rnd() < 0.32);
    return {
      id: `img-${i + 1}`,
      title: `${titleWords[Math.floor(rnd() * titleWords.length)]} ${["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][i]}`,
      artist: artists[Math.floor(rnd() * artists.length)]!,
      year: String(1958 + Math.floor(rnd() * 60)),
      medium: mediums[Math.floor(rnd() * mediums.length)]!,
      source: "seed-collection",
      seed: Math.floor(rnd() * 2 ** 31),
      palette: Math.floor(rnd() * PALETTES.length),
      tags: tags.length ? tags : ["archive"],
      channels: [],
    };
  });
  const channels: Channel[] = [
    { id: "ch-1", name: "hard-edges" },
    { id: "ch-2", name: "colour-studies" },
    { id: "ch-3", name: "to-print" },
  ];
  // seed a few connections
  images.forEach((img, i) => {
    if (i % 3 === 0) img.channels.push("ch-1");
    if (img.palette >= 3) img.channels.push("ch-2");
  });
  return { images, channels, tags: [...baseTags], filter: null, selectedId: images[0]!.id };
}

/* ---------------------------------- world ---------------------------------- */

interface World {
  store: Store<GalleryState>;
  image(id: string): Image | undefined;
  channel(id: string): Channel | undefined;
  updateImage(id: string, fn: (img: Image) => Image): void;
}

function makeWorld(): World {
  const store = new Store(seedState());
  return {
    store,
    image: (id) => store.get().images.find((i) => i.id === id),
    channel: (id) => store.get().channels.find((c) => c.id === id),
    updateImage: (id, fn) =>
      store.update((s) => ({ ...s, images: s.images.map((i) => (i.id === id ? fn(i) : i)) })),
  };
}

const imageRef = (i: Image | string): ObjectRef => ({ kind: "image", id: typeof i === "string" ? i : i.id });
const tagRef = (t: string): ObjectRef => ({ kind: "tag", id: normTag(t) });
const channelRef = (c: Channel | string): ObjectRef => ({ kind: "channel", id: typeof c === "string" ? c : c.id });

const imagePart = (i: Image): OutputPart => ({ t: "pres", type: "image", ref: imageRef(i), label: i.title });
const tagPart = (t: string): OutputPart => ({ t: "pres", type: "tag", ref: tagRef(t), label: normTag(t) });
const channelPart = (c: Channel): OutputPart => ({ t: "pres", type: "channel", ref: channelRef(c), label: c.name });

/* --------------------------------- engine ---------------------------------- */

function makeEngine(world: World) {
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);

  ptypes.define<Image>({
    name: "image",
    print: (i) => `#<IMAGE "${i.title}" ${i.artist} ${i.year}>`,
    describe: (i) => {
      const parts: OutputPart[] = [
        { t: "bold", s: i.title },
        { t: "text", s: `  ${i.artist}, ${i.year} — ${i.medium} (${i.source}). tags: ` },
      ];
      i.tags.forEach((t, k) => {
        if (k) parts.push({ t: "text", s: " " });
        parts.push(tagPart(t));
      });
      const chs = i.channels.map((id) => world.channel(id)).filter(Boolean) as Channel[];
      if (chs.length) {
        parts.push({ t: "text", s: "  channels: " });
        chs.forEach((c, k) => {
          if (k) parts.push({ t: "text", s: " " });
          parts.push(channelPart(c));
        });
      }
      return parts;
    },
    parse: (text, w) => {
      const t = text.trim().toLowerCase();
      for (const i of w.store.get().images)
        if (i.title.toLowerCase() === t || i.title.toLowerCase().startsWith(t))
          return { ok: true, value: i, ref: imageRef(i), label: i.title };
      return { ok: false, err: `${text} does not name an IMAGE` };
    },
  });

  ptypes.define<{ name: string; count: number }>({
    name: "tag",
    print: (t) => `#<TAG ${t.name} ×${t.count}>`,
    describe: (t) => [{ t: "bold", s: t.name }, { t: "text", s: ` — a tag on ${t.count} image${t.count === 1 ? "" : "s"}.` }],
    // any word is a valid tag: typing a fresh name creates it on the fly
    parse: (text) => {
      const name = normTag(text);
      if (!name) return { ok: false, err: "empty TAG" };
      return { ok: true, value: { name, count: 0 }, ref: tagRef(name), label: name };
    },
  });

  ptypes.define<Channel>({
    name: "channel",
    print: (c) => `#<CHANNEL ${c.name}>`,
    parse: (text, w) => {
      const t = text.trim().toLowerCase();
      for (const c of w.store.get().channels)
        if (c.name.toLowerCase() === t || c.name.toLowerCase().startsWith(t))
          return { ok: true, value: c, ref: channelRef(c), label: c.name };
      return { ok: false, err: `${text} does not name a CHANNEL` };
    },
  });

  ptypes.define<string>({ name: "attribute", print: (a) => `#<ATTRIBUTE ${a}>` });

  const resolveImage = (v: ArgValue) => ("id" in v.ref ? world.image(v.ref.id) : undefined);

  const commands = new CommandTable<World>();
  commands.defineAll([
    {
      name: "Show Image",
      doc: "Open the image in the inspector.",
      args: [{ name: "image", type: "image" }],
      isDefaultFor: ["image"],
      run: (args, api) => {
        const img = resolveImage(args["image"]!);
        if (!img) return api.printErr("That image is gone — presentation was stale.");
        world.store.update((s) => ({ ...s, selectedId: img.id }));
        api.print("Inspecting ", imagePart(img), ".");
      },
    },
    {
      name: "Rename Image",
      doc: "Give the image a new title.",
      args: [
        { name: "image", type: "image" },
        {
          name: "new-title",
          type: "string",
          input: "typed",
          prompt: "the new title",
          validate: (v) => ("value" in v.ref && String(v.ref.value).trim().length >= 2 ? true : "a title needs at least 2 characters"),
        },
      ],
      run: (args, api) => {
        const img = resolveImage(args["image"]!);
        if (!img) return api.printErr("Stale image presentation.");
        const title = String((args["new-title"]!.ref as { value: unknown }).value).trim();
        const old = img.title;
        world.updateImage(img.id, (i) => ({ ...i, title }));
        api.print(`Renamed "${old}" to `, imagePart({ ...img, title }), ".");
      },
    },
    {
      name: "Set Attribute",
      doc: "Edit artist / year / medium / source.",
      args: [
        { name: "image", type: "image" },
        {
          name: "attribute",
          type: "attribute",
          input: "menu",
          prompt: "Which attribute?",
          options: () =>
            (["artist", "year", "medium", "source"] as const).map((a) => ({ label: a, ref: valueRef(a) })),
        },
        { name: "value", type: "string", input: "typed", prompt: "the new value" },
      ],
      run: (args, api) => {
        const img = resolveImage(args["image"]!);
        if (!img) return api.printErr("Stale image presentation.");
        const attr = String((args["attribute"]!.ref as { value: unknown }).value) as
          | "artist" | "year" | "medium" | "source";
        const value = String((args["value"]!.ref as { value: unknown }).value).trim();
        world.updateImage(img.id, (i) => ({ ...i, [attr]: value }));
        api.print(imagePart(img), ` ${attr} set to `, B(value), ".");
      },
    },
    {
      name: "Tag Image",
      doc: "Attach a tag — click an existing tag chip or type a new name.",
      args: [
        { name: "image", type: "image" },
        { name: "tag", type: "tag", prompt: "a tag (click one, or type a new name)" },
      ],
      run: (args, api) => {
        const img = resolveImage(args["image"]!);
        if (!img) return api.printErr("Stale image presentation.");
        const tag = "id" in args["tag"]!.ref ? args["tag"]!.ref.id : "";
        if (!tag) return;
        if (img.tags.includes(tag)) return api.printErr(`${img.title} already carries `, tagPart(tag));
        world.store.update((s) => ({
          ...s,
          tags: s.tags.includes(tag) ? s.tags : [...s.tags, tag],
          images: s.images.map((i) => (i.id === img.id ? { ...i, tags: [...i.tags, tag] } : i)),
        }));
        api.print(imagePart(img), " tagged ", tagPart(tag), ".");
      },
    },
    {
      name: "Untag Image",
      doc: "Remove a tag the image carries.",
      args: [
        { name: "image", type: "image" },
        {
          name: "tag",
          type: "tag",
          // only tags the image actually carries light up
          where: (pres, soFar, w) => {
            const imgV = soFar["image"];
            if (!imgV || !("id" in imgV.ref) || !("id" in pres.ref)) return false;
            return (w as World).image(imgV.ref.id)?.tags.includes(pres.ref.id) ?? false;
          },
          validate: (v, soFar, w) => {
            const imgV = soFar["image"];
            if (!imgV || !("id" in imgV.ref) || !("id" in v.ref)) return "supply the image first";
            return (w as World).image(imgV.ref.id)?.tags.includes(v.ref.id)
              ? true
              : `that image does not carry the tag ${v.label}`;
          },
        },
      ],
      appliesTo: (pres, w) => ("id" in pres.ref ? ((w.image(pres.ref.id)?.tags.length ?? 0) > 0) : false),
      run: (args, api) => {
        const img = resolveImage(args["image"]!);
        if (!img) return api.printErr("Stale image presentation.");
        const tag = "id" in args["tag"]!.ref ? args["tag"]!.ref.id : "";
        world.updateImage(img.id, (i) => ({ ...i, tags: i.tags.filter((t) => t !== tag) }));
        api.print("Removed ", tagPart(tag), " from ", imagePart(img), ".");
      },
    },
    {
      name: "Shuffle Artwork",
      doc: "Regenerate the piece from a fresh seed.",
      args: [{ name: "image", type: "image" }],
      run: (args, api) => {
        const img = resolveImage(args["image"]!);
        if (!img) return api.printErr("Stale image presentation.");
        world.updateImage(img.id, (i) => ({
          ...i,
          seed: Math.floor(Math.random() * 2 ** 31),
          palette: Math.floor(Math.random() * PALETTES.length),
        }));
        api.print("Re-generated ", imagePart(img), ".");
      },
    },
    {
      name: "Connect To Channel",
      doc: "Add the image to a channel (are.na style).",
      args: [
        { name: "image", type: "image" },
        {
          name: "channel",
          type: "channel",
          where: (pres, soFar, w) => {
            const imgV = soFar["image"];
            if (!imgV || !("id" in imgV.ref) || !("id" in pres.ref)) return true;
            return !((w as World).image(imgV.ref.id)?.channels.includes(pres.ref.id) ?? false);
          },
        },
      ],
      run: (args, api) => {
        const img = resolveImage(args["image"]!);
        const ch = "id" in args["channel"]!.ref ? world.channel(args["channel"]!.ref.id) : undefined;
        if (!img || !ch) return api.printErr("A participant vanished — presentation was stale.");
        world.updateImage(img.id, (i) => ({ ...i, channels: [...i.channels, ch.id] }));
        api.print(imagePart(img), " connected to ", channelPart(ch), ".");
      },
    },
    {
      name: "Disconnect From Channel",
      args: [
        { name: "image", type: "image" },
        {
          name: "channel",
          type: "channel",
          where: (pres, soFar, w) => {
            const imgV = soFar["image"];
            if (!imgV || !("id" in imgV.ref) || !("id" in pres.ref)) return false;
            return (w as World).image(imgV.ref.id)?.channels.includes(pres.ref.id) ?? false;
          },
        },
      ],
      appliesTo: (pres, w) => ("id" in pres.ref ? ((w.image(pres.ref.id)?.channels.length ?? 0) > 0) : false),
      run: (args, api) => {
        const img = resolveImage(args["image"]!);
        const ch = "id" in args["channel"]!.ref ? world.channel(args["channel"]!.ref.id) : undefined;
        if (!img || !ch) return api.printErr("A participant vanished — presentation was stale.");
        world.updateImage(img.id, (i) => ({ ...i, channels: i.channels.filter((c) => c !== ch.id) }));
        api.print(imagePart(img), " disconnected from ", channelPart(ch), ".");
      },
    },
    {
      name: "Filter By Tag",
      doc: "Show only images carrying this tag.",
      args: [{ name: "tag", type: "tag" }],
      isDefaultFor: ["tag"],
      run: (args, api) => {
        const tag = "id" in args["tag"]!.ref ? args["tag"]!.ref.id : "";
        world.store.update((s) => ({ ...s, filter: { kind: "tag", tag } }));
        const n = world.store.get().images.filter((i) => i.tags.includes(tag)).length;
        api.print("Filtering by ", tagPart(tag), ` — ${n} image${n === 1 ? "" : "s"}.`);
      },
    },
    {
      name: "Show Channel",
      doc: "Show only this channel's images.",
      args: [{ name: "channel", type: "channel" }],
      isDefaultFor: ["channel"],
      run: (args, api) => {
        const ch = "id" in args["channel"]!.ref ? world.channel(args["channel"]!.ref.id) : undefined;
        if (!ch) return api.printErr("Stale channel presentation.");
        world.store.update((s) => ({ ...s, filter: { kind: "channel", id: ch.id } }));
        const n = world.store.get().images.filter((i) => i.channels.includes(ch.id)).length;
        api.print("Showing ", channelPart(ch), ` — ${n} image${n === 1 ? "" : "s"}.`);
      },
    },
    {
      name: "Rename Channel",
      args: [
        { name: "channel", type: "channel" },
        { name: "new-name", type: "string", input: "typed", prompt: "the new channel name" },
      ],
      run: (args, api) => {
        const ch = "id" in args["channel"]!.ref ? world.channel(args["channel"]!.ref.id) : undefined;
        if (!ch) return api.printErr("Stale channel presentation.");
        const name = normTag(String((args["new-name"]!.ref as { value: unknown }).value));
        world.store.update((s) => ({
          ...s,
          channels: s.channels.map((c) => (c.id === ch.id ? { ...c, name } : c)),
        }));
        api.print("Channel renamed to ", channelPart({ ...ch, name }), ".");
      },
    },
    {
      name: "New Channel",
      global: true,
      args: [{ name: "name", type: "string", input: "typed", prompt: "the channel name" }],
      run: (args, api) => {
        const name = normTag(String((args["name"]!.ref as { value: unknown }).value));
        const id = `ch-${Date.now() % 100000}`;
        world.store.update((s) => ({ ...s, channels: [...s.channels, { id, name }] }));
        api.print("Created channel ", channelPart({ id, name }), " — connect images via their menu.");
      },
    },
    {
      name: "New Tag",
      global: true,
      args: [{ name: "name", type: "tag", input: "typed", prompt: "the tag name" }],
      run: (args, api) => {
        const tag = "id" in args["name"]!.ref ? args["name"]!.ref.id : "";
        world.store.update((s) => ({
          ...s,
          tags: s.tags.includes(tag) ? s.tags : [...s.tags, tag],
        }));
        api.print("Created tag ", tagPart(tag), ".");
      },
    },
    {
      name: "Clear Filter",
      global: true,
      run: (_a, api) => {
        world.store.update((s) => ({ ...s, filter: null }));
        api.print("Showing everything.");
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
        api.print(B("GALLERY 1.0"), " — an are.na-flavored image browser where every card, tag chip and channel is a live presentation.");
        api.print("Click an image to inspect it; click a tag chip to filter; right-click an image for ", B("Rename / Set Attribute / Tag / Connect …"));
        api.print("Try typing: ", B("tag image composition new-tag-name"), " — brand-new tags are created on the fly.");
      },
    },
  ]);

  const resolver: Resolver = {
    resolve: (ref) => {
      if (!("id" in ref)) return undefined;
      if (ref.kind === "image") return world.image(ref.id);
      if (ref.kind === "channel") return world.channel(ref.id);
      if (ref.kind === "tag") {
        const s = world.store.get();
        const count = s.images.filter((i) => i.tags.includes(ref.id)).length;
        return s.tags.includes(ref.id) || count > 0 ? { name: ref.id, count } : undefined;
      }
      return undefined;
    },
  };

  const engine = new PbuiEngine<World>({
    ptypes,
    commands,
    world,
    resolver,
    idleDoc: "GALLERY — L: inspect/filter; M: Describe; R: menu. Background R: New Channel, Clear Filter …",
  });
  return engine;
}

/* ----------------------------------- views ---------------------------------- */

function TagChip({ tag, count }: { tag: string; count?: number }) {
  return (
    <Presentation type="tag" object={tagRef(tag)} label={tag}
      style={{ border: "1px solid var(--pbui-ink)", padding: "0 5px", marginRight: 4, fontSize: 11, display: "inline-block", lineHeight: "15px" }}>
      {tag}
      {count != null && <span style={{ opacity: 0.6 }}> ×{count}</span>}
    </Presentation>
  );
}

function ImageCard({ img, selected }: { img: Image; selected: boolean }) {
  return (
    <Presentation type="image" object={imageRef(img)} label={img.title} block
      style={{
        border: selected ? "3px solid var(--pbui-ink)" : "1px solid var(--pbui-ink)",
        padding: selected ? 4 : 6,
        width: 148,
        background: "var(--pbui-paper)",
      }}>
      <Artwork seed={img.seed} palette={img.palette} size={134} />
      <div style={{ fontWeight: "bold", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {img.title}
      </div>
      <div style={{ fontSize: 11, opacity: 0.75 }}>{img.artist}, {img.year}</div>
      <div style={{ marginTop: 3, minHeight: 17 }}>
        {img.tags.map((t) => <TagChip key={t} tag={t} />)}
      </div>
    </Presentation>
  );
}

function GalleryGrid({ world }: { world: World }) {
  const s = useStore(world.store);
  const visible = s.images.filter((i) =>
    !s.filter ? true
      : s.filter.kind === "tag" ? i.tags.includes(s.filter.tag)
      : i.channels.includes(s.filter.id));
  const filterLabel = !s.filter ? "all images"
    : s.filter.kind === "tag" ? `tag: ${s.filter.tag}`
    : `channel: ${world.channel(s.filter.id)?.name ?? "?"}`;
  return (
    <Pane title="Gallery" subtitle={`${visible.length} of ${s.images.length} — ${filterLabel}`} style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignContent: "flex-start" }}>
        {visible.map((img) => <ImageCard key={img.id} img={img} selected={img.id === s.selectedId} />)}
        {visible.length === 0 && <div style={{ fontStyle: "italic", opacity: 0.7 }}>nothing here — Clear Filter from the background menu</div>}
      </div>
    </Pane>
  );
}

function SidebarPanes({ world }: { world: World }) {
  const s = useStore(world.store);
  const tagCounts = new Map<string, number>();
  for (const t of s.tags) tagCounts.set(t, 0);
  for (const i of s.images) for (const t of i.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 210 }}>
      <Pane title="Channels" subtitle="are.na style">
        {s.channels.map((c) => {
          const n = s.images.filter((i) => i.channels.includes(c.id)).length;
          return (
            <div key={c.id} style={{ padding: "2px 0" }}>
              <Presentation type="channel" object={channelRef(c)} label={c.name} block
                style={{ border: "1px solid var(--pbui-ink)", padding: "3px 6px", fontWeight: s.filter?.kind === "channel" && s.filter.id === c.id ? "bold" : undefined }}>
                {c.name} <span style={{ opacity: 0.6 }}>({n})</span>
              </Presentation>
            </div>
          );
        })}
      </Pane>
      <Pane title="Tags" style={{ flex: 1 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {[...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
            <TagChip key={t} tag={t} count={n} />
          ))}
        </div>
      </Pane>
    </div>
  );
}

function InspectorPane({ world }: { world: World }) {
  const s = useStore(world.store);
  const img = s.images.find((i) => i.id === s.selectedId) ?? null;
  return (
    <Pane title="Inspector" subtitle={img ? undefined : "click an image"} style={{ width: 250 }}>
      {img && (
        <div>
          <Presentation type="image" object={imageRef(img)} label={img.title} block quiet style={{ marginBottom: 6 }}>
            <Artwork seed={img.seed} palette={img.palette} size={222} />
          </Presentation>
          <Presentation type="image" object={imageRef(img)} label={img.title}>
            <b>{img.title}</b>
          </Presentation>
          <table style={{ marginTop: 6, fontSize: 11, borderCollapse: "collapse" }}>
            <tbody>
              {(["artist", "year", "medium", "source"] as const).map((a) => (
                <tr key={a}>
                  <td style={{ opacity: 0.6, paddingRight: 10, verticalAlign: "top" }}>{a}</td>
                  <td>{img[a]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 6 }}>
            {img.tags.map((t) => <TagChip key={t} tag={t} />)}
          </div>
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
            {img.channels.map((cid) => {
              const c = world.channel(cid);
              return c ? (
                <Presentation key={cid} type="channel" object={channelRef(c)} label={c.name}
                  style={{ border: "1px solid var(--pbui-ink)", padding: "1px 5px", fontSize: 11 }}>
                  ↳ {c.name}
                </Presentation>
              ) : null;
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, fontStyle: "italic", opacity: 0.7 }}>
            right-click the image (here or in the grid) to edit title, attributes, tags and channels
          </div>
        </div>
      )}
    </Pane>
  );
}

/* ----------------------------------- shell ---------------------------------- */

function GalleryApp({ engine, world }: { engine: PbuiEngine<World>; world: World }) {
  const surface = usePbuiSurface();
  useEngine(); // assert provider
  const heraldRan = useRef(false);
  useEffect(() => {
    if (heraldRan.current) return; // StrictMode double-mount guard
    heraldRan.current = true;
    engine.startCommand("Show Herald");
  }, [engine]);
  return (
    <div className="pbui-root" style={{ height: "100vh", display: "flex", flexDirection: "column" }} {...surface}>
      <div className="demo-back"><a href="#">← demos</a></div>
      <div style={{ display: "flex", gap: 8, padding: 8, flex: 3, minHeight: 0 }}>
        <SidebarPanes world={world} />
        <GalleryGrid world={world} />
        <InspectorPane world={world} />
      </div>
      <div style={{ display: "flex", padding: "0 8px 8px", flex: 1, minHeight: 130 }}>
        <Pane title="Listener" style={{ flex: 1 }} bodyStyle={{ padding: 0, display: "flex" }}>
          <Listener style={{ flex: 1 }} prompt="GALLERY> " />
        </Pane>
      </div>
      <ContextMenuHost />
      <MouseDocBar right="GALLERY" />
      <StatusLine user="curator" pkg="GALLERY" host="ARE-NA" />
    </div>
  );
}

export default function GalleryDemo() {
  const { engine, world } = useMemo(() => {
    const world = makeWorld();
    return { engine: makeEngine(world), world };
  }, []);
  return (
    <PbuiProvider engine={engine}>
      <GalleryApp engine={engine} world={world} />
    </PbuiProvider>
  );
}
