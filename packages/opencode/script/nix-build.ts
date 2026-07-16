#!/usr/bin/env bun
// Nix-only build: produces unbundled JS instead of compiled binary.
// Bun standalone binaries (--single or upstream releases) segfault on NixOS TUI
// due to embedded Bun runtime libc incompatibility with NixOS glibc.
// Zero changes to core build.ts — no upstream conflicts.

import { $ } from "bun"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { createSolidTransformPlugin } from "@opentui/solid/bun-plugin"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")
process.chdir(dir)

const generated = await import("./generate.ts")

import { Script } from "@opencode-ai/script"

const plugin = createSolidTransformPlugin()

const version = process.env.OPENCODE_VERSION ?? Script.version
const channel = process.env.OPENCODE_CHANNEL ?? Script.channel

const name = "opencode-linux-x64"

await $`rm -rf dist`
await $`mkdir -p dist/${name}/bin`

const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
const workerPath = "./src/cli/tui/worker.ts"
const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

console.log(`building ${name} (version=${version}, channel=${channel})`)
await Bun.build({
  conditions: ["node"],
  target: "bun",
  tsconfig: "./tsconfig.json",
  plugins: [plugin],
  external: ["node-gyp", "@opentui/core-*"],
  format: "esm",
  minify: true,
  sourcemap: "none",
  entrypoints: ["./src/index.ts"],
  outdir: `dist/${name}/bin`,
  define: {
    OPENCODE_VERSION: `'${version}'`,
    OPENCODE_MODELS_DEV: generated.modelsData,
    OTUI_TREE_SITTER_WORKER_PATH: "/$bunfs/root/" + workerRelativePath,
    OPENCODE_WORKER_PATH: workerPath,
    OPENCODE_CHANNEL: `'${channel}'`,
    OPENCODE_LIBC: "'glibc'",
    "process.env.OPENTUI_LIBC": '"glibc"',
  },
})

await $`rm -rf ./dist/${name}/bin/tui`
console.log("build complete")
