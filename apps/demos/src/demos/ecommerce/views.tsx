/* Tab views for the e-commerce admin. Every entity mention is a
 * presentation; tables are just rows of them. */

import type { CSSProperties, ReactNode } from "react";
import { Presentation } from "@pbui/react";
import { ActivityPane, Pane } from "@pbui/chrome";
import { useStore } from "../../lib/store.js";
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
  type World,
} from "./data.js";
import { customerRef, orderRef, productRef, statusRef, viewRef } from "./engine.js";

/* -------------------------------- primitives -------------------------------- */

const STATUS_STYLE: Record<OrderStatus, { glyph: string; color: string }> = {
  pending: { glyph: "○", color: "var(--pbui-gold)" },
  paid: { glyph: "●", color: "var(--pbui-teal)" },
  fulfilled: { glyph: "✓", color: "var(--pbui-teal)" },
  refunded: { glyph: "↩", color: "var(--pbui-coral)" },
  cancelled: { glyph: "✕", color: "var(--pbui-coral)" },
};

export function StatusChip({ status }: { status: OrderStatus }) {
  const st = STATUS_STYLE[status];
  return (
    <Presentation type="order-status" object={statusRef(status)} label={status}
      style={{ border: "1px solid var(--pbui-ink)", padding: "0 5px", fontSize: 11, whiteSpace: "nowrap" }}>
      <span style={{ color: st.color }}>{st.glyph}</span> {status}
    </Presentation>
  );
}

export function OrderChip({ o }: { o: Order }) {
  return (
    <Presentation type="order" object={orderRef(o)} label={`#${o.number}`}>
      <b>#{o.number}</b>
    </Presentation>
  );
}

export function ProductChip({ p }: { p: Product }) {
  return (
    <Presentation type="product" object={productRef(p)} label={p.name}>
      {p.name}
    </Presentation>
  );
}

export function CustomerChip({ c }: { c: Customer }) {
  return (
    <Presentation type="customer" object={customerRef(c)} label={c.name}>
      {c.name}
    </Presentation>
  );
}

const th: CSSProperties = { textAlign: "left", borderBottom: "1px solid var(--pbui-ink)", padding: "2px 8px", whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "2px 8px", whiteSpace: "nowrap", verticalAlign: "top" };
const num: CSSProperties = { ...td, textAlign: "right" };

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead><tr>{head.map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function rowStyle(selected: boolean): CSSProperties {
  return selected ? { outline: "2px solid var(--pbui-ink)", outlineOffset: -2 } : {};
}

/* ---------------------------------- tab bar --------------------------------- */

export function TabBar({ world }: { world: World }) {
  const s = useStore(world.store);
  return (
    <div style={{ display: "flex", gap: 4, padding: "6px 8px 0" }}>
      {VIEWS.map((v) => {
        const active = s.activeTab === v.id;
        return (
          <Presentation key={v.id} type="view" object={viewRef(v)} label={v.name} block
            style={{
              border: "2px solid var(--pbui-ink)",
              borderBottom: active ? "2px solid var(--pbui-paper)" : "2px solid var(--pbui-ink)",
              padding: "3px 14px",
              fontWeight: "bold",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontSize: 11,
              background: active ? "var(--pbui-paper)" : "var(--pbui-ink)",
              color: active ? "var(--pbui-ink)" : "var(--pbui-paper)",
              position: "relative",
              top: 2,
            }}>
            {v.name}
          </Presentation>
        );
      })}
    </div>
  );
}

/* --------------------------------- dashboard -------------------------------- */

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ border: "2px solid var(--pbui-ink)", padding: "8px 14px", minWidth: 130 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: "bold" }}>{value}</div>
      {hint && <div style={{ fontSize: 11, opacity: 0.7 }}>{hint}</div>}
    </div>
  );
}

export function DashboardView({ world }: { world: World }) {
  const s = useStore(world.store);
  const active = s.orders.filter((o) => o.status === "paid" || o.status === "fulfilled");
  const revenue = active.reduce((t, o) => t + orderTotal(o), 0);
  const open = s.orders.filter((o) => o.status === "pending" || o.status === "paid").length;
  const low = s.products.filter((p) => !p.archived && p.stock <= LOW_STOCK);
  const sold = new Map<string, number>();
  for (const o of active) for (const l of o.lines) sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.qty);
  const top = [...sold.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const recent = [...s.orders].slice(-6).reverse();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", gap: 8 }}>
        <Tile label="Revenue" value={fmtMoney(revenue)} hint={`${active.length} paid/fulfilled`} />
        <Tile label="Open orders" value={String(open)} hint="pending + paid" />
        <Tile label="Products" value={String(s.products.filter((p) => !p.archived).length)} />
        <Tile label="Low stock" value={String(low.length)} hint={`≤ ${LOW_STOCK} units`} />
      </div>
      <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0 }}>
        <Pane title="Recent Orders" style={{ flex: 3 }}>
          <Table head={["order", "customer", "total", "status"]}>
            {recent.map((o) => {
              const c = world.customer(o.customerId);
              return (
                <tr key={o.id}>
                  <td style={td}><OrderChip o={o} /></td>
                  <td style={td}>{c && <CustomerChip c={c} />}</td>
                  <td style={num}>{fmtMoney(orderTotal(o))}</td>
                  <td style={td}><StatusChip status={o.status} /></td>
                </tr>
              );
            })}
          </Table>
        </Pane>
        <Pane title="Top Products" subtitle="by units sold" style={{ flex: 2 }}>
          <Table head={["product", "sold", "stock"]}>
            {top.map(([pid, n]) => {
              const p = world.product(pid);
              return p ? (
                <tr key={pid}>
                  <td style={td}><ProductChip p={p} /></td>
                  <td style={num}>{n}</td>
                  <td style={{ ...num, fontWeight: p.stock <= LOW_STOCK ? "bold" : undefined }}>{p.stock}</td>
                </tr>
              ) : null;
            })}
          </Table>
        </Pane>
        <div style={{ flex: 2, minWidth: 220, display: "grid", minHeight: 0 }}>
          <ActivityPane limit={12} />
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------- orders --------------------------------- */

export function OrdersView({ world }: { world: World }) {
  const s = useStore(world.store);
  const visible = s.orders.filter((o) => {
    const f = s.orderFilter;
    if (!f) return true;
    if (f.kind === "status") return o.status === f.status;
    if (f.kind === "customer") return o.customerId === f.customerId;
    return o.lines.some((l) => l.productId === f.productId);
  });
  const filterLabel = !s.orderFilter ? null
    : s.orderFilter.kind === "status" ? `status: ${s.orderFilter.status}`
    : s.orderFilter.kind === "customer" ? `customer: ${world.customer(s.orderFilter.customerId)?.name}`
    : `product: ${world.product(s.orderFilter.productId)?.name}`;
  const sel = s.orders.find((o) => o.id === s.selectedOrderId) ?? null;
  const selCustomer = sel ? world.customer(sel.customerId) : null;
  return (
    <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0 }}>
      <Pane title="Orders" subtitle={`${visible.length} of ${s.orders.length}${filterLabel ? ` — ${filterLabel}` : ""}`} style={{ flex: 3, minWidth: 0 }}>
        <Table head={["order", "date", "customer", "items", "total", "status"]}>
          {[...visible].reverse().map((o) => {
            const c = world.customer(o.customerId);
            return (
              <tr key={o.id} style={rowStyle(o.id === s.selectedOrderId)}>
                <td style={td}><OrderChip o={o} /></td>
                <td style={td}>{o.day}</td>
                <td style={td}>{c && <CustomerChip c={c} />}</td>
                <td style={num}>{o.lines.reduce((n, l) => n + l.qty, 0)}</td>
                <td style={num}>{fmtMoney(orderTotal(o))}</td>
                <td style={td}><StatusChip status={o.status} /></td>
              </tr>
            );
          })}
        </Table>
        <div style={{ marginTop: 6, display: "flex", gap: 4, alignItems: "center", fontSize: 11 }}>
          <span style={{ opacity: 0.6 }}>filter:</span>
          {ORDER_STATUSES.map((st) => <StatusChip key={st} status={st} />)}
        </div>
      </Pane>
      <Pane title={sel ? `Order #${sel.number}` : "Order"} subtitle={sel ? sel.day : "click an order"} style={{ flex: 2, minWidth: 0 }}>
        {sel && (
          <div>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 6 }}>
              <StatusChip status={sel.status} />
              {selCustomer && (
                <span>for <CustomerChip c={selCustomer} /> <span style={{ opacity: 0.6 }}>({selCustomer.city})</span></span>
              )}
            </div>
            <Table head={["product", "qty", "unit", "line"]}>
              {sel.lines.map((l) => {
                const p = world.product(l.productId);
                return (
                  <tr key={l.productId}>
                    <td style={td}>{p ? <ProductChip p={p} /> : l.productId}</td>
                    <td style={num}>{l.qty}</td>
                    <td style={num}>{fmtMoney(l.unitCents)}</td>
                    <td style={num}>{fmtMoney(l.qty * l.unitCents)}</td>
                  </tr>
                );
              })}
              <tr>
                <td style={td} colSpan={3}><b>total</b></td>
                <td style={num}><b>{fmtMoney(orderTotal(sel))}</b></td>
              </tr>
            </Table>
            <div style={{ marginTop: 8, fontSize: 11, fontStyle: "italic", opacity: 0.7 }}>
              right-click the order number for lifecycle commands — only the ones valid for “{sel.status}” appear
            </div>
          </div>
        )}
      </Pane>
    </div>
  );
}

/* ---------------------------------- products -------------------------------- */

export function ProductsView({ world }: { world: World }) {
  const s = useStore(world.store);
  const sel = s.products.find((p) => p.id === s.selectedProductId) ?? null;
  const soldOf = (pid: string) =>
    s.orders.filter((o) => o.status === "paid" || o.status === "fulfilled")
      .reduce((n, o) => n + o.lines.filter((l) => l.productId === pid).reduce((m, l) => m + l.qty, 0), 0);
  return (
    <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0 }}>
      <Pane title="Products" subtitle={`${s.products.length} SKUs`} style={{ flex: 3, minWidth: 0 }}>
        <Table head={["sku", "product", "category", "price", "stock", ""]}>
          {s.products.map((p) => (
            <tr key={p.id} style={{ ...rowStyle(p.id === s.selectedProductId), opacity: p.archived ? 0.45 : 1 }}>
              <td style={{ ...td, fontSize: 11 }}>
              <Presentation type="product" object={productRef(p)} label={p.name}>{p.sku}</Presentation>
            </td>
              <td style={td}><ProductChip p={p} /></td>
              <td style={td}>{p.category}</td>
              <td style={num}>{fmtMoney(p.priceCents)}</td>
              <td style={{ ...num, fontWeight: p.stock <= LOW_STOCK ? "bold" : undefined }}>
                {p.stock}{p.stock <= LOW_STOCK ? " !" : ""}
              </td>
              <td style={{ ...td, fontSize: 11, fontStyle: "italic" }}>{p.archived ? "archived" : ""}</td>
            </tr>
          ))}
        </Table>
      </Pane>
      <Pane title={sel ? sel.name : "Product"} subtitle={sel?.sku} style={{ flex: 2, minWidth: 0 }}>
        {sel && (
          <div>
            <Table head={["", ""]}>
              <tr><td style={td}>price</td><td style={num}>{fmtMoney(sel.priceCents)}</td></tr>
              <tr><td style={td}>stock</td><td style={num}>{sel.stock}</td></tr>
              <tr><td style={td}>category</td><td style={num}>{sel.category}</td></tr>
              <tr><td style={td}>units sold</td><td style={num}>{soldOf(sel.id)}</td></tr>
              <tr><td style={td}>status</td><td style={num}>{sel.archived ? "archived" : "active"}</td></tr>
            </Table>
            <div style={{ marginTop: 8, fontSize: 11, fontStyle: "italic", opacity: 0.7 }}>
              right-click the product name for Set Price, Adjust Stock, Set Category, Orders For Product …
            </div>
          </div>
        )}
      </Pane>
    </div>
  );
}

/* --------------------------------- customers -------------------------------- */

export function CustomersView({ world }: { world: World }) {
  const s = useStore(world.store);
  const sel = s.customers.find((c) => c.id === s.selectedCustomerId) ?? null;
  const ordersOf = (cid: string) => s.orders.filter((o) => o.customerId === cid);
  const spentOf = (cid: string) =>
    ordersOf(cid).filter((o) => o.status === "paid" || o.status === "fulfilled").reduce((t, o) => t + orderTotal(o), 0);
  return (
    <div style={{ display: "flex", gap: 8, flex: 1, minHeight: 0 }}>
      <Pane title="Customers" subtitle={`${s.customers.length}`} style={{ flex: 3, minWidth: 0 }}>
        <Table head={["customer", "email", "city", "orders", "lifetime"]}>
          {s.customers.map((c) => (
            <tr key={c.id} style={rowStyle(c.id === s.selectedCustomerId)}>
              <td style={td}><CustomerChip c={c} /></td>
              <td style={{ ...td, fontSize: 11 }}>{c.email}</td>
              <td style={td}>{c.city}</td>
              <td style={num}>{ordersOf(c.id).length}</td>
              <td style={num}>{fmtMoney(spentOf(c.id))}</td>
            </tr>
          ))}
        </Table>
      </Pane>
      <Pane title={sel ? sel.name : "Customer"} subtitle={sel ? `${sel.email} — ${sel.city}` : "click a customer"} style={{ flex: 2, minWidth: 0 }}>
        {sel && (
          <div>
            <Table head={["order", "date", "total", "status"]}>
              {ordersOf(sel.id).map((o) => (
                <tr key={o.id}>
                  <td style={td}><OrderChip o={o} /></td>
                  <td style={td}>{o.day}</td>
                  <td style={num}>{fmtMoney(orderTotal(o))}</td>
                  <td style={td}><StatusChip status={o.status} /></td>
                </tr>
              ))}
            </Table>
            <div style={{ marginTop: 8, fontSize: 11, fontStyle: "italic", opacity: 0.7 }}>
              right-click the customer for Email Customer, Orders For Customer …
            </div>
          </div>
        )}
      </Pane>
    </div>
  );
}

/* --------------------------------- inventory -------------------------------- */

export function InventoryView({ world }: { world: World }) {
  const s = useStore(world.store);
  const rows = [...s.products].filter((p) => !p.archived).sort((a, b) => a.stock - b.stock);
  return (
    <Pane title="Inventory" subtitle={`sorted by stock — bold means ≤ ${LOW_STOCK}`} style={{ flex: 1, minWidth: 0 }}>
      <Table head={["stock", "sku", "product", "category", "price"]}>
        {rows.map((p) => (
          <tr key={p.id}>
            <td style={{ ...num, fontWeight: p.stock <= LOW_STOCK ? "bold" : undefined, background: p.stock <= LOW_STOCK ? "var(--pbui-ink)" : undefined, color: p.stock <= LOW_STOCK ? "var(--pbui-paper)" : undefined }}>
              {p.stock}
            </td>
            <td style={{ ...td, fontSize: 11 }}>
              <Presentation type="product" object={productRef(p)} label={p.name}>{p.sku}</Presentation>
            </td>
            <td style={td}><ProductChip p={p} /></td>
            <td style={td}>{p.category}</td>
            <td style={num}>{fmtMoney(p.priceCents)}</td>
          </tr>
        ))}
      </Table>
      <div style={{ marginTop: 8, fontSize: 11, fontStyle: "italic", opacity: 0.7 }}>
        right-click a product → Adjust Stock (validated against going negative); Low Stock Report on the background menu
      </div>
    </Pane>
  );
}
