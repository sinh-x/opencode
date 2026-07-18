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
    // No OPENCODE_WORKER_PATH / OTUI_TREE_SITTER_WORKER_PATH defines: relative
    // Worker specifiers resolve against cwd in Bun and $bunfs only exists in
    // compiled binaries. Both call sites fall back to import.meta.url-relative
    // resolution, which points next to the installed index.js.
    OPENCODE_CHANNEL: `'${channel}'`,
    OPENCODE_LIBC: "'glibc'",
    "process.env.OPENTUI_LIBC": '"glibc"',
  },
})

// Bundle the opentui tree-sitter parser worker next to index.js so the
// import.meta.url fallback in @opentui/core resolveWorkerPath finds it.
await Bun.build({
  conditions: ["node"],
  target: "bun",
  format: "esm",
  minify: true,
  sourcemap: "none",
  entrypoints: [parserWorker],
  outdir: `dist/${name}/bin`,
})

// `@opentui/core-*` platform packages stay external (they dlopen a bundled
// libopentui.so relative to their own files). Ship the target platform's
// package in a real node_modules dir next to index.js so Bun's upward
// resolution finds it at runtime.
const nativeName = name.replace("opencode-", "core-")
const nativePkg = fs.realpathSync(path.resolve(path.dirname(parserWorker), "..", nativeName))
const nativeDest = `dist/${name}/bin/node_modules/@opentui/${nativeName}`
await $`mkdir -p ${path.dirname(nativeDest)}`
fs.cpSync(nativePkg, nativeDest, { recursive: true, dereference: true })

await $`rm -rf ./dist/${name}/bin/tui`
console.log("build complete")
