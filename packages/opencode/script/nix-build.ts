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
import pkg from "../package.json"

const plugin = createSolidTransformPlugin()

const createEmbeddedWebUIBundle = async () => {
  console.log("Building Web UI to embed")
  const appDir = path.join(dir, "../app")
  const dist = path.join(appDir, "dist")
  await $`OPENCODE_CHANNEL=${Script.channel} bun run --cwd ${appDir} build`
  const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist })))
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => !file.endsWith(".map"))
    .sort()
  const imports = files.map((file, i) => {
    const spec = path.relative(dir, path.join(dist, file)).replaceAll("\\", "/")
    return `import file_${i} from ${JSON.stringify(spec.startsWith(".") ? spec : `./${spec}`)} with { type: "file" };`
  })
  const entries = files.map((file, i) => `  ${JSON.stringify(file)}: file_${i},`)
  return [
    "// Import all files as file_$i with type: \"file\"",
    ...imports,
    "// Export with original mappings",
    "export default {",
    ...entries,
    "}",
  ].join("\n")
}

const embeddedFileMap = await createEmbeddedWebUIBundle()
const name = "opencode-linux-x64"

await $`rm -rf dist`
await $`mkdir -p dist/${name}/bin`

const localPath = path.resolve(dir, "node_modules/@opentui/core/parser.worker.js")
const rootPath = path.resolve(dir, "../../node_modules/@opentui/core/parser.worker.js")
const parserWorker = fs.realpathSync(fs.existsSync(localPath) ? localPath : rootPath)
const workerPath = "./src/cli/tui/worker.ts"
const workerRelativePath = path.relative(dir, parserWorker).replaceAll("\\", "/")

console.log(`building ${name}`)
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
    OPENCODE_VERSION: `'${Script.version}'`,
    OPENCODE_MODELS_DEV: generated.modelsData,
    OTUI_TREE_SITTER_WORKER_PATH: "/$bunfs/root/" + workerRelativePath,
    OPENCODE_WORKER_PATH: workerPath,
    OPENCODE_CHANNEL: `'${Script.channel}'`,
    OPENCODE_LIBC: "'glibc'",
    "process.env.OPENTUI_LIBC": '"glibc"',
  },
})

await $`rm -rf ./dist/${name}/bin/tui`
console.log("build complete")
