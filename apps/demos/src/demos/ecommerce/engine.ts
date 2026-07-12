/* ptypes, parts helpers, and the command table for the e-commerce admin. */

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
} from "@pbui/core";
import {
  fmtMoney,
  orderTotal,
  LOW_STOCK,
  ORDER_STATUSES,
  VIEWS,
  type Customer,
  type Order,
  type OrderStatus,
  type Product,
  type TabId,
  type ViewDef,
  type World,
} from "./data.js";

/* ---------------------------------- refs ----------------------------------- */

export const orderRef = (o: Order | string): ObjectRef => ({ kind: "order", id: typeof o === "string" ? o : o.id });
export const productRef = (p: Product | string): ObjectRef => ({ kind: "product", id: typeof p === "string" ? p : p.id });
export const customerRef = (c: Customer | string): ObjectRef => ({ kind: "customer", id: typeof c === "string" ? c : c.id });
export const viewRef = (v: ViewDef | TabId): ObjectRef => ({ kind: "view", id: typeof v === "string" ? v : v.id });
export const statusRef = (s: OrderStatus): ObjectRef => ({ kind: "status", id: s });

export const orderPart = (o: Order): OutputPart => ({ t: "pres", type: "order", ref: orderRef(o), label: `#${o.number}` });
export const productPart = (p: Product): OutputPart => ({ t: "pres", type: "product", ref: productRef(p), label: p.name });
export const customerPart = (c: Customer): OutputPart => ({ t: "pres", type: "customer", ref: customerRef(c), label: c.name });
export const statusPart = (s: OrderStatus): OutputPart => ({ t: "pres", type: "order-status", ref: statusRef(s), label: s });

const val = (v: ArgValue): unknown => ("value" in v.ref ? v.ref.value : undefined);
const refId = (v: ArgValue): string => ("id" in v.ref ? v.ref.id : "");

/* --------------------------------- engine ---------------------------------- */

export function makeEngine(world: World) {
  const ptypes = new PTypes<World>();
  defineBuiltinPtypes(ptypes);

  ptypes.define<Order>({
    name: "order",
    print: (o) => `#<ORDER #${o.number} ${o.status} ${fmtMoney(orderTotal(o))}>`,
    describe: (o, w) => {
      const c = (w as World).customer(o.customerId);
      const parts: OutputPart[] = [
        { t: "bold", s: `Order #${o.number}` },
        { t: "text", s: ` — ` },
        statusPart(o.status),
        { t: "text", s: `, ${o.day}, ${fmtMoney(orderTotal(o))} for ` },
      ];
      if (c) parts.push(customerPart(c));
      parts.push({ t: "text", s: ". Items: " });
      o.lines.forEach((l, i) => {
        const p = (w as World).product(l.productId);
        if (i) parts.push({ t: "text", s: ", " });
        parts.push({ t: "text", s: `${l.qty}× ` });
        if (p) parts.push(productPart(p));
      });
      return parts;
    },
    parse: (text, w) => {
      const t = text.trim().replace(/^#/, "");
      const o = (w as World).store.get().orders.find((x) => String(x.number) === t);
      if (o) return { ok: true, value: o, ref: orderRef(o), label: `#${o.number}` };
      return { ok: false, err: `${text} does not name an ORDER (try #1004)` };
    },
  });

  ptypes.define<Product>({
    name: "product",
    print: (p) => `#<PRODUCT ${p.sku} "${p.name}" ${fmtMoney(p.priceCents)} stock=${p.stock}>`,
    describe: (p) => [
      { t: "bold", s: p.name },
      { t: "text", s: `  [${p.sku}] ${p.category} — ${fmtMoney(p.priceCents)}, ${p.stock} in stock${p.stock <= LOW_STOCK ? " (LOW)" : ""}${p.archived ? ", archived" : ""}.` },
    ],
    parse: (text, w) => {
      const t = text.trim().toLowerCase();
      for (const p of (w as World).store.get().products)
        if (p.sku.toLowerCase() === t || p.sku.toLowerCase().startsWith(t) || p.name.toLowerCase().startsWith(t))
          return { ok: true, value: p, ref: productRef(p), label: p.name };
      return { ok: false, err: `${text} does not name a PRODUCT (sku or name prefix)` };
    },
  });

  ptypes.define<Customer>({
    name: "customer",
    print: (c) => `#<CUSTOMER ${c.name} <${c.email}>>`,
    describe: (c, w) => {
      const orders = (w as World).store.get().orders.filter((o) => o.customerId === c.id);
      const spent = orders.filter((o) => o.status === "paid" || o.status === "fulfilled").reduce((s, o) => s + orderTotal(o), 0);
      const parts: OutputPart[] = [
        { t: "bold", s: c.name },
        { t: "text", s: `  <${c.email}> ${c.city} — ${orders.length} orders, ${fmtMoney(spent)} lifetime: ` },
      ];
      orders.forEach((o, i) => {
        if (i) parts.push({ t: "text", s: " " });
        parts.push(orderPart(o));
      });
      return parts;
    },
    parse: (text, w) => {
      const t = text.trim().toLowerCase();
      for (const c of (w as World).store.get().customers)
        if (c.name.toLowerCase().startsWith(t) || c.email.toLowerCase().startsWith(t))
          return { ok: true, value: c, ref: customerRef(c), label: c.name };
      return { ok: false, err: `${text} does not name a CUSTOMER` };
    },
  });

  ptypes.define<ViewDef>({
    name: "view",
    print: (v) => `#<VIEW ${v.name}>`,
    parse: (text) => {
      const t = text.trim().toLowerCase();
      const v = VIEWS.find((x) => x.id.startsWith(t) || x.name.toLowerCase().startsWith(t));
      return v
        ? { ok: true, value: v, ref: viewRef(v), label: v.name }
        : { ok: false, err: `${text} does not name a VIEW` };
    },
  });

  ptypes.define<OrderStatus>({
    name: "order-status",
    print: (s) => `#<ORDER-STATUS ${s}>`,
    parse: (text) => {
      const t = text.trim().toLowerCase() as OrderStatus;
      return ORDER_STATUSES.includes(t)
        ? { ok: true, value: t, ref: statusRef(t), label: t }
        : { ok: false, err: `${text} is not one of ${ORDER_STATUSES.join("/")}` };
    },
  });

  const commands = new CommandTable<World>();

  const resolveOrder = (v: ArgValue) => world.order(refId(v));
  const resolveProduct = (v: ArgValue) => world.product(refId(v));
  const resolveCustomer = (v: ArgValue) => world.customer(refId(v));
  const orderIs = (statuses: OrderStatus[]) => (pres: { ref: ObjectRef }, w: World) =>
    "id" in pres.ref ? statuses.includes(w.order(pres.ref.id)?.status as OrderStatus) : false;

  commands.defineAll([
    /* ------------------------------ navigation ------------------------------ */
    {
      name: "Switch To View",
      doc: "Open a tab.",
      args: [{ name: "view", type: "view" }],
      isDefaultFor: ["view"],
      run: (args, api) => {
        const id = refId(args["view"]!) as TabId;
        world.store.update((s) => ({ ...s, activeTab: id }));
        api.print(`Switched to ${args["view"]!.label}.`);
      },
    },
    {
      name: "Show Order",
      args: [{ name: "order", type: "order" }],
      isDefaultFor: ["order"],
      run: (args, api) => {
        const o = resolveOrder(args["order"]!);
        if (!o) return api.printErr("That order is gone — presentation was stale.");
        world.store.update((s) => ({ ...s, activeTab: "orders", selectedOrderId: o.id }));
        api.print("Opened ", orderPart(o), " in the Orders tab.");
      },
    },
    {
      name: "Show Product",
      args: [{ name: "product", type: "product" }],
      isDefaultFor: ["product"],
      run: (args, api) => {
        const p = resolveProduct(args["product"]!);
        if (!p) return api.printErr("Stale product presentation.");
        world.store.update((s) => ({ ...s, activeTab: "products", selectedProductId: p.id }));
        api.print("Opened ", productPart(p), " in the Products tab.");
      },
    },
    {
      name: "Show Customer",
      args: [{ name: "customer", type: "customer" }],
      isDefaultFor: ["customer"],
      run: (args, api) => {
        const c = resolveCustomer(args["customer"]!);
        if (!c) return api.printErr("Stale customer presentation.");
        world.store.update((s) => ({ ...s, activeTab: "customers", selectedCustomerId: c.id }));
        api.print("Opened ", customerPart(c), " in the Customers tab.");
      },
    },

    /* ---------------------------- order lifecycle ---------------------------- */
    {
      name: "Mark Paid",
      doc: "Record payment for a pending order.",
      args: [{ name: "order", type: "order" }],
      appliesTo: orderIs(["pending"]),
      run: (args, api) => {
        const o = resolveOrder(args["order"]!);
        if (!o) return api.printErr("Stale order presentation.");
        world.updateOrder(o.id, (x) => ({ ...x, status: "paid" }));
        api.print(orderPart(o), " marked ", statusPart("paid"), ` — ${fmtMoney(orderTotal(o))} captured.`);
      },
    },
    {
      name: "Fulfill Order",
      doc: "Ship it; decrements stock per line.",
      args: [{ name: "order", type: "order" }],
      appliesTo: orderIs(["paid"]),
      run: (args, api) => {
        const o = resolveOrder(args["order"]!);
        if (!o) return api.printErr("Stale order presentation.");
        const short = o.lines.filter((l) => (world.product(l.productId)?.stock ?? 0) < l.qty);
        if (short.length) {
          const parts: OutputPart[] = [{ t: "text", s: "Cannot fulfill — insufficient stock for " }];
          short.forEach((l, i) => {
            const p = world.product(l.productId);
            if (i) parts.push({ t: "text", s: ", " });
            if (p) parts.push(productPart(p));
          });
          parts.push({ t: "text", s: ". Adjust Stock first." });
          return api.printErr(...parts);
        }
        for (const l of o.lines) world.updateProduct(l.productId, (p) => ({ ...p, stock: p.stock - l.qty }));
        world.updateOrder(o.id, (x) => ({ ...x, status: "fulfilled" }));
        api.print(orderPart(o), " ", statusPart("fulfilled"), " — stock decremented.");
      },
    },
    {
      name: "Refund Order",
      doc: "Refund and restock.",
      args: [
        { name: "order", type: "order" },
        { name: "reason", type: "string", input: "typed", prompt: "the refund reason" },
      ],
      appliesTo: orderIs(["paid", "fulfilled"]),
      run: (args, api) => {
        const o = resolveOrder(args["order"]!);
        if (!o) return api.printErr("Stale order presentation.");
        const wasFulfilled = o.status === "fulfilled";
        if (wasFulfilled)
          for (const l of o.lines) world.updateProduct(l.productId, (p) => ({ ...p, stock: p.stock + l.qty }));
        world.updateOrder(o.id, (x) => ({ ...x, status: "refunded" }));
        api.print(orderPart(o), " ", statusPart("refunded"), ` (${String(val(args["reason"]!))})${wasFulfilled ? " — stock restored" : ""}.`);
      },
    },
    {
      name: "Cancel Order",
      args: [{ name: "order", type: "order" }],
      appliesTo: orderIs(["pending"]),
      run: (args, api) => {
        const o = resolveOrder(args["order"]!);
        if (!o) return api.printErr("Stale order presentation.");
        world.updateOrder(o.id, (x) => ({ ...x, status: "cancelled" }));
        api.print(orderPart(o), " ", statusPart("cancelled"), ".");
      },
    },
    {
      name: "New Order",
      doc: "Create a pending single-line order: customer, product, quantity.",
      global: true,
      args: [
        { name: "customer", type: "customer" },
        { name: "product", type: "product", where: (pres, _s, w) => ("id" in pres.ref ? !(w as World).product(pres.ref.id)?.archived : false) },
        {
          name: "qty",
          type: "number",
          input: "typed",
          default: () => ({ type: "number", ref: valueRef(1), label: "1" }),
          validate: (v) => {
            const n = Number(val(v));
            return Number.isInteger(n) && n >= 1 && n <= 99 ? true : "quantity must be an integer 1–99";
          },
        },
      ],
      run: (args, api) => {
        const c = resolveCustomer(args["customer"]!);
        const p = resolveProduct(args["product"]!);
        if (!c || !p) return api.printErr("A participant vanished — presentation was stale.");
        const qty = Number(val(args["qty"]!));
        const s = world.store.get();
        const order: Order = {
          id: `o-${s.nextOrderNumber}`,
          number: s.nextOrderNumber,
          customerId: c.id,
          lines: [{ productId: p.id, qty, unitCents: p.priceCents }],
          status: "pending",
          day: "Jul 12",
        };
        world.store.update((x) => ({
          ...x,
          orders: [...x.orders, order],
          nextOrderNumber: x.nextOrderNumber + 1,
          activeTab: "orders",
          selectedOrderId: order.id,
        }));
        api.print("Created ", orderPart(order), ": ", `${qty}× `, productPart(p), " for ", customerPart(c), ` — ${fmtMoney(orderTotal(order))}, `, statusPart("pending"), ".");
      },
    },
    {
      name: "Add Line",
      doc: "Add a product line to a pending order.",
      args: [
        { name: "order", type: "order" },
        {
          name: "product",
          type: "product",
          where: (pres, soFar, w) => {
            if (!("id" in pres.ref)) return false;
            const o = soFar["order"] && "id" in soFar["order"].ref ? (w as World).order(soFar["order"].ref.id) : undefined;
            return !!o && !o.lines.some((l) => l.productId === (pres.ref as { id: string }).id);
          },
        },
        {
          name: "qty",
          type: "number",
          input: "typed",
          default: () => ({ type: "number", ref: valueRef(1), label: "1" }),
          validate: (v) => (Number.isInteger(Number(val(v))) && Number(val(v)) >= 1 ? true : "quantity must be a positive integer"),
        },
      ],
      appliesTo: orderIs(["pending"]),
      run: (args, api) => {
        const o = resolveOrder(args["order"]!);
        const p = resolveProduct(args["product"]!);
        if (!o || !p) return api.printErr("A participant vanished — presentation was stale.");
        const qty = Number(val(args["qty"]!));
        world.updateOrder(o.id, (x) => ({ ...x, lines: [...x.lines, { productId: p.id, qty, unitCents: p.priceCents }] }));
        const after = world.order(o.id)!;
        api.print("Added ", `${qty}× `, productPart(p), " to ", orderPart(after), ` — now ${fmtMoney(orderTotal(after))}.`);
      },
    },

    /* ------------------------------- products -------------------------------- */
    {
      name: "Set Price",
      args: [
        { name: "product", type: "product" },
        {
          name: "price",
          type: "number",
          input: "typed",
          prompt: "the new price in dollars",
          validate: (v) => (Number(val(v)) > 0 ? true : "price must be positive"),
        },
      ],
      run: (args, api) => {
        const p = resolveProduct(args["product"]!);
        if (!p) return api.printErr("Stale product presentation.");
        const cents = Math.round(Number(val(args["price"]!)) * 100);
        world.updateProduct(p.id, (x) => ({ ...x, priceCents: cents }));
        api.print(productPart(p), " price ", B(fmtMoney(p.priceCents)), " → ", B(fmtMoney(cents)), ".");
      },
    },
    {
      name: "Adjust Stock",
      doc: "Positive receives stock, negative writes it off.",
      args: [
        { name: "product", type: "product" },
        {
          name: "delta",
          type: "number",
          input: "typed",
          prompt: "the stock adjustment (e.g. 10 or -3)",
          validate: (v, soFar, w) => {
            const p = soFar["product"] && "id" in soFar["product"].ref ? (w as World).product(soFar["product"].ref.id) : undefined;
            const n = Number(val(v));
            if (!Number.isInteger(n) || n === 0) return "adjustment must be a non-zero integer";
            if (p && p.stock + n < 0) return `only ${p.stock} in stock — cannot go negative`;
            return true;
          },
        },
      ],
      run: (args, api) => {
        const p = resolveProduct(args["product"]!);
        if (!p) return api.printErr("Stale product presentation.");
        const n = Number(val(args["delta"]!));
        world.updateProduct(p.id, (x) => ({ ...x, stock: x.stock + n }));
        const after = world.product(p.id)!;
        api.print(productPart(p), ` stock ${p.stock} → ${after.stock}${after.stock <= LOW_STOCK ? " (LOW)" : ""}.`);
      },
    },
    {
      name: "Rename Product",
      args: [
        { name: "product", type: "product" },
        { name: "new-name", type: "string", input: "typed", prompt: "the new product name" },
      ],
      run: (args, api) => {
        const p = resolveProduct(args["product"]!);
        if (!p) return api.printErr("Stale product presentation.");
        const name = String(val(args["new-name"]!)).trim();
        world.updateProduct(p.id, (x) => ({ ...x, name }));
        api.print(`Renamed "${p.name}" to `, productPart({ ...p, name }), ".");
      },
    },
    {
      name: "Set Category",
      args: [
        { name: "product", type: "product" },
        {
          name: "category",
          type: "string",
          input: "menu",
          prompt: "Which category?",
          options: (_s, w) => (w as World).categories().map((c) => ({ label: c, ref: valueRef(c) })),
        },
      ],
      run: (args, api) => {
        const p = resolveProduct(args["product"]!);
        if (!p) return api.printErr("Stale product presentation.");
        const cat = String(val(args["category"]!));
        world.updateProduct(p.id, (x) => ({ ...x, category: cat }));
        api.print(productPart(p), " categorized ", B(cat), ".");
      },
    },
    {
      name: "Archive Product",
      args: [{ name: "product", type: "product" }],
      appliesTo: (pres, w) => ("id" in pres.ref ? !w.product(pres.ref.id)?.archived : false),
      run: (args, api) => {
        const p = resolveProduct(args["product"]!);
        if (!p) return api.printErr("Stale product presentation.");
        world.updateProduct(p.id, (x) => ({ ...x, archived: true }));
        api.print(productPart(p), " archived — hidden from New Order.");
      },
    },
    {
      name: "Restore Product",
      args: [{ name: "product", type: "product" }],
      appliesTo: (pres, w) => ("id" in pres.ref ? w.product(pres.ref.id)?.archived === true : false),
      run: (args, api) => {
        const p = resolveProduct(args["product"]!);
        if (!p) return api.printErr("Stale product presentation.");
        world.updateProduct(p.id, (x) => ({ ...x, archived: false }));
        api.print(productPart(p), " restored.");
      },
    },

    /* ------------------------------- customers ------------------------------- */
    {
      name: "Email Customer",
      args: [
        { name: "customer", type: "customer" },
        { name: "subject", type: "string", input: "typed", prompt: "the subject line" },
      ],
      run: (args, api) => {
        const c = resolveCustomer(args["customer"]!);
        if (!c) return api.printErr("Stale customer presentation.");
        api.print("✉ queued to ", customerPart(c), ` <${c.email}>: "${String(val(args["subject"]!))}" (demo — nothing is sent).`);
      },
    },
    {
      name: "Orders For Customer",
      args: [{ name: "customer", type: "customer" }],
      run: (args, api) => {
        const c = resolveCustomer(args["customer"]!);
        if (!c) return api.printErr("Stale customer presentation.");
        world.store.update((s) => ({ ...s, activeTab: "orders", orderFilter: { kind: "customer", customerId: c.id } }));
        const n = world.store.get().orders.filter((o) => o.customerId === c.id).length;
        api.print(`Orders tab filtered to `, customerPart(c), ` — ${n} order${n === 1 ? "" : "s"}.`);
      },
    },
    {
      name: "Orders For Product",
      args: [{ name: "product", type: "product" }],
      run: (args, api) => {
        const p = resolveProduct(args["product"]!);
        if (!p) return api.printErr("Stale product presentation.");
        world.store.update((s) => ({ ...s, activeTab: "orders", orderFilter: { kind: "product", productId: p.id } }));
        const n = world.store.get().orders.filter((o) => o.lines.some((l) => l.productId === p.id)).length;
        api.print(`Orders tab filtered to `, productPart(p), ` — ${n} order${n === 1 ? "" : "s"}.`);
      },
    },
    {
      name: "Filter By Status",
      args: [{ name: "status", type: "order-status" }],
      isDefaultFor: ["order-status"],
      run: (args, api) => {
        const st = refId(args["status"]!) as OrderStatus;
        world.store.update((s) => ({ ...s, activeTab: "orders", orderFilter: { kind: "status", status: st } }));
        const n = world.store.get().orders.filter((o) => o.status === st).length;
        api.print("Orders tab filtered to ", statusPart(st), ` — ${n} order${n === 1 ? "" : "s"}.`);
      },
    },
    {
      name: "Clear Order Filter",
      global: true,
      run: (_a, api) => {
        world.store.update((s) => ({ ...s, orderFilter: null }));
        api.print("Order filter cleared.");
      },
    },

    /* -------------------------------- reports -------------------------------- */
    {
      name: "Low Stock Report",
      global: true,
      run: (_a, api) => {
        const low = world.store.get().products.filter((p) => !p.archived && p.stock <= LOW_STOCK);
        if (!low.length) return api.print("No products at or below the low-stock threshold.");
        const parts: OutputPart[] = [B(`${low.length} low-stock product${low.length === 1 ? "" : "s"}: `)];
        low.forEach((p, i) => {
          if (i) parts.push({ t: "text", s: ", " });
          parts.push(productPart(p));
          parts.push({ t: "text", s: ` (${p.stock})` });
        });
        parts.push({ t: "text", s: " — right-click one → Adjust Stock." });
        api.print(...parts);
      },
    },
    {
      name: "Sales Summary",
      global: true,
      run: (_a, api) => {
        const s = world.store.get();
        const by = (st: OrderStatus) => s.orders.filter((o) => o.status === st);
        const rev = [...by("paid"), ...by("fulfilled")].reduce((t, o) => t + orderTotal(o), 0);
        api.print(B("Sales summary: "), `revenue ${fmtMoney(rev)} across ${by("paid").length + by("fulfilled").length} paid/fulfilled orders; `, `${by("pending").length} pending, ${by("refunded").length} refunded, ${by("cancelled").length} cancelled.`);
      },
    },

    /* --------------------------------- misc ---------------------------------- */
    { name: "Clear Listener", global: true, run: () => engine.transcript.clear() },
    {
      name: "Show Herald",
      global: true,
      run: (_a, api) => {
        api.print(B("STOREFRONT BACK OFFICE 1.0"), " — orders, products, customers, statuses and tabs are all live presentations.");
        api.print("Try: right-click a ", B("pending"), " order → Mark Paid → Fulfill; click a status chip to filter; ", B("New Order"), " from the background menu accepts a customer, a product and a quantity — click any mention of them on screen.");
        api.print("Command line works too: ", B("orders for customer ada"), ", ", B("set price tee-blk 35"), ", ", B("low stock report"), ".");
      },
    },
  ]);

  const resolver: Resolver = {
    resolve: (ref) => {
      if (!("id" in ref)) return undefined;
      switch (ref.kind) {
        case "order": return world.order(ref.id);
        case "product": return world.product(ref.id);
        case "customer": return world.customer(ref.id);
        case "view": return VIEWS.find((v) => v.id === ref.id);
        case "status": return ORDER_STATUSES.includes(ref.id as OrderStatus) ? (ref.id as OrderStatus) : undefined;
        default: return undefined;
      }
    },
  };

  const engine = new PbuiEngine<World>({
    ptypes,
    commands,
    world,
    resolver,
    idleDoc: "BACK OFFICE — L: open/filter; M: Describe; R: menu. Background R: New Order, reports …",
  });
  return engine;
}
