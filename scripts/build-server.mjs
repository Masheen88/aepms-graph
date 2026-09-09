import { build } from "esbuild";
import { mkdir, cp } from "node:fs/promises";

// Package a Cloudflare-compatible Worker alongside Vite's static client assets.
await build({
  entryPoints: ["server/worker.js"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
});
await mkdir("dist/.openai", { recursive: true });
await cp(".openai/hosting.json", "dist/.openai/hosting.json");
await cp("drizzle", "dist/.openai/drizzle", { recursive: true });
