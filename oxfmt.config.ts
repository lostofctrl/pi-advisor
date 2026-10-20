import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  // SAFETY: bench traps.toml fixtures embed JSON after `choices =` by design (bench/src/harvest.ts).
  ignorePatterns: [...ultracite.ignorePatterns, "bench/tasks/**/traps.toml"],
});
