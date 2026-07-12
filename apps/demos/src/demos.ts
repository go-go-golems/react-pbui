import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export interface DemoEntry {
  slug: string;
  title: string;
  blurb: string;
  original: string;
  component: LazyExoticComponent<ComponentType> | ComponentType;
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
];
