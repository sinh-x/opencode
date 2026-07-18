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

// Derive the output directory name from the target platform. The Nix
// derivation passes OPENCODE_TARGET (a Nix system string like "x86_64-linux"
// or "aarch64-darwin") so cross-compilation produces the right path. When not
// set (e.g. local dev), fall back to the current host platform.
function targetName(target: string | undefined): string {
  if (target) {
    const [arch, os] = target.split("-")
    const osPart = os === "darwin" ? "darwin" : os === "linux" ? "linux" : os
    const archPart = arch === "aarch64" ? "arm64" : arch === "x86_64" ? "x64" : arch
    return `opencode-${osPart}-${archPart}`
  }
  const os = process.platform === "win32" ? "windows" : process.platform
  return `opencode-${os}-${process.arch}`
}

const name = targetName(process.env.OPENCODE_TARGET)

await $`rm -rf dist`
await $`mkdir -p dist/${name}/bin`

const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
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
  entrypoints: ["./src/index.ts", "./src/cli/tui/worker.ts"],
  outdir: `dist/${name}/bin`,
  define: {
    OPENCODE_VERSION: `'${version}'`,
    OPENCODE_MODELS_DEV: generated.modelsData,
    OTUI_TREE_SITTER_WORKER_PATH: "/$bunfs/root/" + workerRelativePath,
    OPENCODE_WORKER_PATH: '"./cli/tui/worker.js"',
    OPENCODE_CHANNEL: `'${channel}'`,
    OPENCODE_LIBC: "'glibc'",
    "process.env.OPENTUI_LIBC": '"glibc"',
  },
})

await $`rm -rf ./dist/${name}/bin/tui`
console.log("build complete")
