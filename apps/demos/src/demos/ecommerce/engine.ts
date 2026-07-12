/* ptypes, parts helpers, and the command table for the e-commerce admin.
 *
 * Commands are defined through the typed builder (CLIM-JSX-004): run bodies
 * receive resolved domain objects, stale presentations abort centrally, and
 * mutating commands opt into snapshot undo. Ptypes stay v1-style. */

import {
  arg,
  B,
  CommandTable,
  PbuiEngine,
  PTypes,
  commandBuilder,
  defineBuiltinPtypes,
  installUndoCommands,
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
  type ViewDef,
  type World,
} from "./data.js";

/* ---------------------------------- refs ----------------------------------- */

export const orderRef = (o: Order | string): ObjectRef => ({ kind: "order", id: typeof o === "string" ? o : o.id });
export const productRef = (p: Product | string): ObjectRef => ({ kind: "product", id: typeof p === "string" ? p : p.id });
export const customerRef = (c: Customer | string): ObjectRef => ({ kind: "customer", id: typeof c === "string" ? c : c.id });
export const viewRef = (v: ViewDef | string): ObjectRef => ({ kind: "view", id: typeof v === "string" ? v : v.id });
export const statusRef = (s: OrderStatus): ObjectRef => ({ kind: "status", id: s });

export const orderPart = (o: Order): OutputPart => ({ t: "pres", type: "order", ref: orderRef(o), label: `#${o.number}` });
export const productPart = (p: Product): OutputPart => ({ t: "pres", type: "product", ref: productRef(p), label: p.name });
export const customerPart = (c: Customer): OutputPart => ({ t: "pres", type: "customer", ref: customerRef(c), label: c.name });
export const statusPart = (s: OrderStatus): OutputPart => ({ t: "pres", type: "order-status", ref: statusRef(s), label: s });

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
  const c = commandBuilder(commands);

  /* ------------------------------ navigation ------------------------------ */

  c.define({
    name: "Switch To View",
    doc: "Open a tab.",
    args: { view: arg.presentation<ViewDef>("view") },
    isDefaultFor: ["view"],
    run: ({ view }, api) => {
      world.store.update((s) => ({ ...s, activeTab: view.id }));
      api.print(`Switched to ${view.name}.`);
    },
  });

  c.define({
    name: "Show Order",
    args: { order: arg.presentation<Order>("order") },
    isDefaultFor: ["order"],
    run: ({ order }, api) => {
      world.store.update((s) => ({ ...s, activeTab: "orders", selectedOrderId: order.id }));
      api.print("Opened ", orderPart(order), " in the Orders tab.");
    },
  });

  c.define({
    name: "Show Product",
    args: { product: arg.presentation<Product>("product") },
    isDefaultFor: ["product"],
    run: ({ product }, api) => {
      world.store.update((s) => ({ ...s, activeTab: "products", selectedProductId: product.id }));
      api.print("Opened ", productPart(product), " in the Products tab.");
    },
  });

  c.define({
    name: "Show Customer",
    args: { customer: arg.presentation<Customer>("customer") },
    isDefaultFor: ["customer"],
    run: ({ customer }, api) => {
      world.store.update((s) => ({ ...s, activeTab: "customers", selectedCustomerId: customer.id }));
      api.print("Opened ", customerPart(customer), " in the Customers tab.");
    },
  });

  /* ---------------------------- order lifecycle ---------------------------- */

  c.define({
    name: "Mark Paid",
    doc: "Record payment for a pending order.",
    args: { order: arg.presentation<Order>("order") },
    appliesTo: (o: Order) => o.status === "pending",
    run: ({ order }, api) => {
      api.snapshotUndo(world.store);
      world.updateOrder(order.id, (x) => ({ ...x, status: "paid" }));
      api.print(orderPart(order), " marked ", statusPart("paid"), ` — ${fmtMoney(orderTotal(order))} captured.`);
    },
  });

  c.define({
    name: "Fulfill Order",
    doc: "Ship it; decrements stock per line.",
    args: { order: arg.presentation<Order>("order") },
    appliesTo: (o: Order) => o.status === "paid",
    run: ({ order }, api) => {
      const short = order.lines.filter((l) => (world.product(l.productId)?.stock ?? 0) < l.qty);
      if (short.length) {
        const parts: OutputPart[] = [{ t: "text", s: "Cannot fulfill — insufficient stock for " }];
        short.forEach((l, i) => {
          const p = world.product(l.productId);
          if (i) parts.push({ t: "text", s: ", " });
          if (p) parts.push(productPart(p));
        });
        parts.push({ t: "text", s: ". Adjust Stock first." });
        api.printErr(...parts);
        return;
      }
      api.snapshotUndo(world.store);
      for (const l of order.lines) world.updateProduct(l.productId, (p) => ({ ...p, stock: p.stock - l.qty }));
      world.updateOrder(order.id, (x) => ({ ...x, status: "fulfilled" }));
      api.print(orderPart(order), " ", statusPart("fulfilled"), " — stock decremented.");
    },
  });

  c.define({
    name: "Refund Order",
    doc: "Refund and restock.",
    args: {
      order: arg.presentation<Order>("order"),
      reason: arg.text({ prompt: "the refund reason" }),
    },
    appliesTo: (o) => {
      const s = (o as Order).status;
      return s === "paid" || s === "fulfilled";
    },
    run: ({ order, reason }, api) => {
      api.snapshotUndo(world.store);
      const wasFulfilled = order.status === "fulfilled";
      if (wasFulfilled)
        for (const l of order.lines) world.updateProduct(l.productId, (p) => ({ ...p, stock: p.stock + l.qty }));
      world.updateOrder(order.id, (x) => ({ ...x, status: "refunded" }));
      api.print(orderPart(order), " ", statusPart("refunded"), ` (${reason})${wasFulfilled ? " — stock restored" : ""}.`);
    },
  });

  c.define({
    name: "Cancel Order",
    args: { order: arg.presentation<Order>("order") },
    appliesTo: (o: Order) => o.status === "pending",
    run: ({ order }, api) => {
      api.snapshotUndo(world.store);
      world.updateOrder(order.id, (x) => ({ ...x, status: "cancelled" }));
      api.print(orderPart(order), " ", statusPart("cancelled"), ".");
    },
  });

  c.define({
    name: "New Order",
    doc: "Create a pending single-line order: customer, product, quantity.",
    global: true,
    args: {
      customer: arg.presentation<Customer>("customer"),
      product: arg.presentation<Product>("product", { where: (p: Product) => !p.archived }),
      qty: arg.number({ default: 1, min: 1, max: 99, integer: true }),
    },
    run: ({ customer, product, qty }, api) => {
      api.snapshotUndo(world.store);
      const s = world.store.get();
      const order: Order = {
        id: `o-${s.nextOrderNumber}`,
        number: s.nextOrderNumber,
        customerId: customer.id,
        lines: [{ productId: product.id, qty, unitCents: product.priceCents }],
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
      api.print("Created ", orderPart(order), ": ", `${qty}× `, productPart(product), " for ", customerPart(customer), ` — ${fmtMoney(orderTotal(order))}, `, statusPart("pending"), ".");
    },
  });

  c.define({
    name: "Add Line",
    doc: "Add a product line to a pending order.",
    args: {
      order: arg.presentation<Order>("order"),
      product: arg.presentation<Product>("product", {
        where: (p: Product, soFar: { order?: Order }) =>
          !!soFar.order && !soFar.order.lines.some((l) => l.productId === p.id),
      }),
      qty: arg.number({ default: 1, min: 1, integer: true }),
    },
    appliesTo: (o) => (o as Order).status === "pending",
    run: ({ order, product, qty }, api) => {
      api.snapshotUndo(world.store);
      world.updateOrder(order.id, (x) => ({ ...x, lines: [...x.lines, { productId: product.id, qty, unitCents: product.priceCents }] }));
      const after = world.order(order.id)!;
      api.print("Added ", `${qty}× `, productPart(product), " to ", orderPart(after), ` — now ${fmtMoney(orderTotal(after))}.`);
    },
  });

  /* ------------------------------- products -------------------------------- */

  c.define({
    name: "Set Price",
    args: {
      product: arg.presentation<Product>("product"),
      price: arg.number({
        prompt: "the new price in dollars",
        validate: (n: number) => (n > 0 ? true : "price must be positive"),
      }),
    },
    run: ({ product, price }, api) => {
      api.snapshotUndo(world.store);
      const cents = Math.round(price * 100);
      world.updateProduct(product.id, (x) => ({ ...x, priceCents: cents }));
      api.print(productPart(product), " price ", B(fmtMoney(product.priceCents)), " → ", B(fmtMoney(cents)), ".");
    },
  });

  c.define({
    name: "Adjust Stock",
    doc: "Positive receives stock, negative writes it off.",
    args: {
      product: arg.presentation<Product>("product"),
      delta: arg.number({
        prompt: "the stock adjustment (e.g. 10 or -3)",
        validate: (n: number, soFar: { product?: Product }) => {
          if (!Number.isInteger(n) || n === 0) return "adjustment must be a non-zero integer";
          if (soFar.product && soFar.product.stock + n < 0) return `only ${soFar.product.stock} in stock — cannot go negative`;
          return true;
        },
      }),
    },
    run: ({ product, delta }, api) => {
      api.snapshotUndo(world.store);
      world.updateProduct(product.id, (x) => ({ ...x, stock: x.stock + delta }));
      const after = world.product(product.id)!;
      api.print(productPart(product), ` stock ${product.stock} → ${after.stock}${after.stock <= LOW_STOCK ? " (LOW)" : ""}.`);
    },
  });

  c.define({
    name: "Rename Product",
    args: {
      product: arg.presentation<Product>("product"),
      "new-name": arg.text({ prompt: "the new product name" }),
    },
    run: ({ product, "new-name": newName }, api) => {
      api.snapshotUndo(world.store);
      const name = newName.trim();
      world.updateProduct(product.id, (x) => ({ ...x, name }));
      api.print(`Renamed "${product.name}" to `, productPart({ ...product, name }), ".");
    },
  });

  c.define({
    name: "Set Category",
    args: {
      product: arg.presentation<Product>("product"),
      category: arg.choice({
        prompt: "Which category?",
        options: (_s, w: World) => w.categories().map((cat) => ({ label: cat, value: cat })),
      }),
    },
    run: ({ product, category }, api) => {
      api.snapshotUndo(world.store);
      world.updateProduct(product.id, (x) => ({ ...x, category }));
      api.print(productPart(product), " categorized ", B(category), ".");
    },
  });

  c.define({
    name: "Archive Product",
    args: { product: arg.presentation<Product>("product") },
    appliesTo: (p: Product) => !p.archived,
    run: ({ product }, api) => {
      api.snapshotUndo(world.store);
      world.updateProduct(product.id, (x) => ({ ...x, archived: true }));
      api.print(productPart(product), " archived — hidden from New Order.");
    },
  });

  c.define({
    name: "Restore Product",
    args: { product: arg.presentation<Product>("product") },
    appliesTo: (p: Product) => p.archived,
    run: ({ product }, api) => {
      api.snapshotUndo(world.store);
      world.updateProduct(product.id, (x) => ({ ...x, archived: false }));
      api.print(productPart(product), " restored.");
    },
  });

  /* ------------------------------- customers ------------------------------- */

  c.define({
    name: "Email Customer",
    args: {
      customer: arg.presentation<Customer>("customer"),
      subject: arg.text({ prompt: "the subject line" }),
    },
    run: ({ customer, subject }, api) => {
      api.print("✉ queued to ", customerPart(customer), ` <${customer.email}>: "${subject}" (demo — nothing is sent).`);
    },
  });

  c.define({
    name: "Orders For Customer",
    args: { customer: arg.presentation<Customer>("customer") },
    run: ({ customer }, api) => {
      world.store.update((s) => ({ ...s, activeTab: "orders", orderFilter: { kind: "customer", customerId: customer.id } }));
      const n = world.store.get().orders.filter((o) => o.customerId === customer.id).length;
      api.print(`Orders tab filtered to `, customerPart(customer), ` — ${n} order${n === 1 ? "" : "s"}.`);
    },
  });

  c.define({
    name: "Orders For Product",
    args: { product: arg.presentation<Product>("product") },
    run: ({ product }, api) => {
      world.store.update((s) => ({ ...s, activeTab: "orders", orderFilter: { kind: "product", productId: product.id } }));
      const n = world.store.get().orders.filter((o) => o.lines.some((l) => l.productId === product.id)).length;
      api.print(`Orders tab filtered to `, productPart(product), ` — ${n} order${n === 1 ? "" : "s"}.`);
    },
  });

  c.define({
    name: "Filter By Status",
    args: { status: arg.presentation<OrderStatus>("order-status") },
    isDefaultFor: ["order-status"],
    run: ({ status }, api) => {
      world.store.update((s) => ({ ...s, activeTab: "orders", orderFilter: { kind: "status", status } }));
      const n = world.store.get().orders.filter((o) => o.status === status).length;
      api.print("Orders tab filtered to ", statusPart(status), ` — ${n} order${n === 1 ? "" : "s"}.`);
    },
  });

  c.define({
    name: "Clear Order Filter",
    global: true,
    run: (_a, api) => {
      world.store.update((s) => ({ ...s, orderFilter: null }));
      api.print("Order filter cleared.");
    },
  });

  /* -------------------------------- reports -------------------------------- */

  c.define({
    name: "Low Stock Report",
    global: true,
    run: (_a, api) => {
      const low = world.store.get().products.filter((p) => !p.archived && p.stock <= LOW_STOCK);
      if (!low.length) {
        api.print("No products at or below the low-stock threshold.");
        return;
      }
      const parts: OutputPart[] = [B(`${low.length} low-stock product${low.length === 1 ? "" : "s"}: `)];
      low.forEach((p, i) => {
        if (i) parts.push({ t: "text", s: ", " });
        parts.push(productPart(p));
        parts.push({ t: "text", s: ` (${p.stock})` });
      });
      parts.push({ t: "text", s: " — right-click one → Adjust Stock." });
      api.print(...parts);
    },
  });

  c.define({
    name: "Sales Summary",
    global: true,
    run: (_a, api) => {
      const s = world.store.get();
      const by = (st: OrderStatus) => s.orders.filter((o) => o.status === st);
      const rev = [...by("paid"), ...by("fulfilled")].reduce((t, o) => t + orderTotal(o), 0);
      api.print(B("Sales summary: "), `revenue ${fmtMoney(rev)} across ${by("paid").length + by("fulfilled").length} paid/fulfilled orders; `, `${by("pending").length} pending, ${by("refunded").length} refunded, ${by("cancelled").length} cancelled.`);
    },
  });

  /* --------------------------------- misc ---------------------------------- */

  c.define({
    name: "Clear Listener",
    global: true,
    run: () => {
      engine.transcript.clear();
    },
  });

  c.define({
    name: "Show Herald",
    global: true,
    run: (_a, api) => {
      api.print(B("STOREFRONT BACK OFFICE 1.0"), " — orders, products, customers, statuses and tabs are all live presentations.");
      api.print("Try: right-click a ", B("pending"), " order → Mark Paid → Fulfill; click a status chip to filter; ", B("New Order"), " from the background menu accepts a customer, a product and a quantity — click any mention of them on screen.");
      api.print("Command line works too: ", B("orders for customer ada"), ", ", B("set price tee-blk 35"), ", ", B("low stock report"), ".");
    },
  });

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
  installUndoCommands(engine);
  return engine;
}
