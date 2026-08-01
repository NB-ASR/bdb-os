import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/inventory/inventory-workspace.tsx"],
    rules: {
      // Inventory deliberately synchronizes an external offline queue after connectivity changes.
      "react-hooks/set-state-in-effect": "off",
      // The controller's Product map is derived from mutable cloud/offline snapshots.
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  {
    files: ["src/app/customers/[[]customerId[]]/page.tsx"],
    rules: {
      // Customer 360 deliberately starts external note-queue replay after connectivity or queue changes.
      "react-hooks/set-state-in-effect": "off",
      // Queue replay depends on the current cached profile bundle and refresh callback as one controller boundary.
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
