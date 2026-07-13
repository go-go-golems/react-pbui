/* STOREFRONT BACK OFFICE — a full e-commerce admin as a PBUI.
 *
 * Five tabs (Dashboard / Orders / Products / Customers / Inventory) — the
 * tabs themselves are VIEW presentations. Orders, products, customers and
 * status chips are presentations everywhere they appear (tables, detail
 * panes, dashboards, and the listener transcript), so cross-navigation is
 * uniform: click a customer inside an order to jump to their record; click
 * a status chip to filter the Orders tab; run "New Order" and supply the
 * customer and product by clicking any mention of them on screen.
 *
 * Navigation stays live during input contexts: the VIEW tabs are
 * duringAccept="active" presentations and Switch To View / Show * are
 * duringAccept commands, so mid-New-Order you can flip to Customers,
 * click the customer there, and continue — the pending context survives
 * (CLIM-JSX-005 §5; this closed the former PORTING-GAPS entry).
 *
 * Order lifecycle is state-sensitive: the context menu on a pending order
 * offers Mark Paid / Cancel; a paid one offers Fulfill / Refund — driven by
 * appliesTo predicates, not menu wiring.
 */

import { useEffect, useMemo, useRef } from "react";
import type { PbuiEngine } from "@pbui/core";
import { PbuiProvider, usePbuiSurface } from "@pbui/react";
import { ContextMenuHost, MouseDocBar, Pane, StatusLine } from "@pbui/chrome";
import { Listener } from "@pbui/listener";
import { useStore } from "../../lib/store.js";
import { makeWorld, type World } from "./data.js";
import { makeEngine } from "./engine.js";
import { CustomersView, DashboardView, InventoryView, OrdersView, ProductsView, TabBar } from "./views.js";

function ActiveView({ world }: { world: World }) {
  const s = useStore(world.store);
  switch (s.activeTab) {
    case "dashboard": return <DashboardView world={world} />;
    case "orders": return <OrdersView world={world} />;
    case "products": return <ProductsView world={world} />;
    case "customers": return <CustomersView world={world} />;
    case "inventory": return <InventoryView world={world} />;
  }
}

function BackOfficeApp({ engine, world }: { engine: PbuiEngine<World>; world: World }) {
  const surface = usePbuiSurface();
  const heraldRan = useRef(false);
  useEffect(() => {
    if (heraldRan.current) return; // StrictMode double-mount guard
    heraldRan.current = true;
    engine.startCommand("Show Herald");
  }, [engine]);
  return (
    <div className="pbui-root" style={{ height: "100vh", display: "flex", flexDirection: "column" }} {...surface}>
      <div className="demo-back"><a href="#">← demos</a></div>
      <TabBar world={world} />
      <div style={{ display: "flex", gap: 8, padding: 8, flex: 3, minHeight: 0, borderTop: "2px solid var(--pbui-ink)" }}>
        <ActiveView world={world} />
      </div>
      <div style={{ display: "flex", padding: "0 8px 8px", flex: 1, minHeight: 130 }}>
        <Pane title="Listener" style={{ flex: 1 }} bodyStyle={{ padding: 0, display: "flex" }}>
          <Listener style={{ flex: 1 }} prompt="SHOP> " />
        </Pane>
      </div>
      <ContextMenuHost />
      <MouseDocBar right="BACK OFFICE" />
      <StatusLine user="clerk" pkg="SHOP" host="STOREFRONT" />
    </div>
  );
}

export default function EcommerceDemo() {
  const { engine, world } = useMemo(() => {
    const world = makeWorld();
    return { engine: makeEngine(world), world };
  }, []);
  return (
    <PbuiProvider engine={engine}>
      <BackOfficeApp engine={engine} world={world} />
    </PbuiProvider>
  );
}
