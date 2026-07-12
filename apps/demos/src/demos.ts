import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export interface DemoEntry {
  slug: string;
  title: string;
  blurb: string;
  original: string;
  component: LazyExoticComponent<ComponentType> | ComponentType;
  /** not listed in the launcher (bench harness) */
  hidden?: boolean;
}

import HelloDemo from "./demos/hello/HelloDemo.js";

export const DEMOS: DemoEntry[] = [
  {
    slug: "hello",
    title: "Hello PBUI",
    blurb: "the smallest complete presentation-based app — start here",
    original: "(tutorial, no original)",
    component: HelloDemo,
  },
  {
    slug: "care-examiner",
    title: "CARE Examiner",
    blurb: "live multiprocessor console: dithered load strips, torus map, threshold via legend presentations",
    original: "care-examiner.jsx",
    component: lazy(() => import("./demos/care-examiner/CareExaminerDemo.js")),
  },
  {
    slug: "scheduler",
    title: "Dynamic Windows Scheduler",
    blurb: "SVG Gantt with a MILESTONE ⊂ TASK lattice, partial commands, and forever-live task refs in the interactor",
    original: "dynamic-windows-scheduler.jsx",
    component: lazy(() => import("./demos/scheduler/SchedulerDemo.js")),
  },
  {
    slug: "metrics",
    title: "Presenta Metrics",
    blurb: "telemetry gauges, strip-chart viewport, readout ports assigned by two-click commands",
    original: "presentation-metrics.jsx",
    component: lazy(() => import("./demos/metrics/MetricsDemo.js")),
  },
  {
    slug: "ecommerce",
    title: "Storefront Back Office",
    blurb: "e-commerce admin with five tabs — orders, products, customers, statuses and tabs are all presentations; lifecycle menus are state-sensitive",
    original: "(new app, no original)",
    component: lazy(() => import("./demos/ecommerce/EcommerceDemo.js")),
  },
  {
    slug: "gallery",
    title: "Gallery (are.na style)",
    blurb: "image browser with tags, channels, and attribute editing — cards, chips and channels are all presentations",
    original: "(new app, no original)",
    component: lazy(() => import("./demos/gallery/GalleryDemo.js")),
  },
  {
    slug: "bench",
    title: "Bench",
    blurb: "render-budget harness",
    original: "(perf harness)",
    hidden: true,
    component: lazy(() => import("./demos/bench/BenchDemo.js")),
  },
  {
    slug: "schema",
    title: "Schema Schematic Editor",
    blurb: "schematic capture: place components at accepted LOCATIONs, draw rubber-band wires, probe nodes into wave panes",
    original: "schema-schematic-editor.jsx",
    component: lazy(() => import("./demos/schema/SchemaDemo.js")),
  },
];
