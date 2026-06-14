import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // jsdom + fake-indexeddb is opted into per-file via
    //   // @vitest-environment jsdom
    // for vault / UI tests that need DOM or IndexedDB.
  },
});
