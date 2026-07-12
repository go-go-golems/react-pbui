/* Domain model + seed data + world facade for the e-commerce admin demo. */

import { Store } from "../../lib/store.js";

export type OrderStatus = "pending" | "paid" | "fulfilled" | "refunded" | "cancelled";
export const ORDER_STATUSES: OrderStatus[] = ["pending", "paid", "fulfilled", "refunded", "cancelled"];

export interface Product {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  stock: number;
  category: string;
  archived: boolean;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  city: string;
}

export interface OrderLine {
  productId: string;
  qty: number;
  unitCents: number;
}

export interface Order {
  id: string;
  number: number; // #1001…
  customerId: string;
  lines: OrderLine[];
  status: OrderStatus;
  day: string; // "Jul 03"
}

export type TabId = "dashboard" | "orders" | "products" | "customers" | "inventory";

export interface ViewDef {
  id: TabId;
  name: string;
}

export const VIEWS: ViewDef[] = [
  { id: "dashboard", name: "Dashboard" },
  { id: "orders", name: "Orders" },
  { id: "products", name: "Products" },
  { id: "customers", name: "Customers" },
  { id: "inventory", name: "Inventory" },
];

export type OrderFilter =
  | { kind: "status"; status: OrderStatus }
  | { kind: "customer"; customerId: string }
  | { kind: "product"; productId: string }
  | null;

export interface EcomState {
  products: Product[];
  customers: Customer[];
  orders: Order[];
  activeTab: TabId;
  selectedOrderId: string | null;
  selectedProductId: string | null;
  selectedCustomerId: string | null;
  orderFilter: OrderFilter;
  nextOrderNumber: number;
}

export const LOW_STOCK = 5;

export const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const orderTotal = (o: Order) => o.lines.reduce((s, l) => s + l.qty * l.unitCents, 0);

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedState(): EcomState {
  const rnd = mulberry32(0xec0);
  const products: Product[] = [
    ["TEE-BLK", "Heavyweight Tee (black)", 3200, "apparel"],
    ["TEE-ECR", "Heavyweight Tee (ecru)", 3200, "apparel"],
    ["CAP-DAD", "Twill Dad Cap", 2800, "apparel"],
    ["MUG-01", "Diner Mug 12oz", 1800, "home"],
    ["PST-A2", "Riso Poster A2", 2400, "print"],
    ["ZIN-04", "Zine No. 4", 1200, "print"],
    ["TOT-CNV", "Canvas Tote", 2200, "home"],
    ["STK-PK", "Sticker Pack", 800, "print"],
  ].map(([sku, name, price, category], i) => ({
    id: `p-${i + 1}`,
    sku: sku as string,
    name: name as string,
    priceCents: price as number,
    stock: [24, 3, 11, 40, 7, 2, 16, 55][i]!,
    category: category as string,
    archived: false,
  }));

  const customers: Customer[] = [
    ["Ada Winter", "ada@postbox.net", "Berlin"],
    ["Bo Lindqvist", "bo@fjord.se", "Malmö"],
    ["Cleo Marchetti", "cleo@vaporetto.it", "Venice"],
    ["Dev Okafor", "dev@lagoscloud.ng", "Lagos"],
    ["Emi Tanaka", "emi@paperworks.jp", "Osaka"],
    ["Fritz Halloran", "fritz@corkboard.ie", "Cork"],
  ].map(([name, email, city], i) => ({
    id: `c-${i + 1}`,
    name: name as string,
    email: email as string,
    city: city as string,
  }));

  const days = ["Jun 28", "Jun 30", "Jul 01", "Jul 02", "Jul 03", "Jul 05", "Jul 07", "Jul 08", "Jul 09", "Jul 10", "Jul 11", "Jul 12"];
  const statuses: OrderStatus[] = [
    "fulfilled", "fulfilled", "refunded", "paid", "fulfilled", "paid",
    "cancelled", "paid", "pending", "paid", "pending", "pending",
  ];
  const orders: Order[] = days.map((day, i) => {
    const nLines = 1 + Math.floor(rnd() * 3);
    const lines: OrderLine[] = [];
    for (let k = 0; k < nLines; k++) {
      const p = products[Math.floor(rnd() * products.length)]!;
      if (lines.some((l) => l.productId === p.id)) continue;
      lines.push({ productId: p.id, qty: 1 + Math.floor(rnd() * 3), unitCents: p.priceCents });
    }
    return {
      id: `o-${i + 1}`,
      number: 1001 + i,
      customerId: customers[Math.floor(rnd() * customers.length)]!.id,
      lines,
      status: statuses[i]!,
      day,
    };
  });

  return {
    products,
    customers,
    orders,
    activeTab: "dashboard",
    selectedOrderId: orders[orders.length - 1]!.id,
    selectedProductId: products[0]!.id,
    selectedCustomerId: customers[0]!.id,
    orderFilter: null,
    nextOrderNumber: 1001 + orders.length,
  };
}

/* --------------------------------- world ---------------------------------- */

export interface World {
  store: Store<EcomState>;
  product(id: string): Product | undefined;
  customer(id: string): Customer | undefined;
  order(id: string): Order | undefined;
  updateOrder(id: string, fn: (o: Order) => Order): void;
  updateProduct(id: string, fn: (p: Product) => Product): void;
  categories(): string[];
}

export function makeWorld(): World {
  const store = new Store(seedState());
  return {
    store,
    product: (id) => store.get().products.find((p) => p.id === id),
    customer: (id) => store.get().customers.find((c) => c.id === id),
    order: (id) => store.get().orders.find((o) => o.id === id),
    updateOrder: (id, fn) =>
      store.update((s) => ({ ...s, orders: s.orders.map((o) => (o.id === id ? fn(o) : o)) })),
    updateProduct: (id, fn) =>
      store.update((s) => ({ ...s, products: s.products.map((p) => (p.id === id ? fn(p) : p)) })),
    categories: () => [...new Set(store.get().products.map((p) => p.category))],
  };
}
