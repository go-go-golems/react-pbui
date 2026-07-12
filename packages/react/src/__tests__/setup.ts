/* Vitest browser-environment setup: jest-dom matchers + per-test cleanup.
 * globals is false, so React Testing Library's automatic cleanup (which
 * hooks a global afterEach) does not fire — register it explicitly. */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
