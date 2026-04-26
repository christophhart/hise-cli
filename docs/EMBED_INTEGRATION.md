# HISE Docs Site — Embed Integration Guide

Step-by-step recipe for wiring `hise-embed` into the Nuxt3 documentation site so `.hsc` code blocks gain a "Run locally" button that talks to the visitor's HISE on `http://localhost:1900`.

---

## 1. Prerequisites

- HISE built with the CORS-enabled REST server (verified `Access-Control-Allow-Origin: *` on `/api/status` and OPTIONS preflight).
- hise-cli repo cloned and `npm install` run.
- Nuxt3 docs site repo (target).

## 2. Build the embed bundle

In the hise-cli repo:

```bash
npm run build:embed
```

Produces:

```
dist/embed/
├── hise-embed.js          # 314 KB minified, ~92 KB gzipped
├── hise-embed.js.map
├── data/
│   ├── moduleList.json            # 236 KB
│   ├── scriptnodeList.json        # 192 KB
│   └── ui_component_properties.json  # 16 KB
```

Or full pipeline (also rebuilds Node CLI + web SPA):

```bash
npm run build
```

## 3. Copy into the Nuxt site

Same-origin is the simplest path — no extra CORS config on the docs server.

```bash
# from the docs repo root
mkdir -p public/embed
cp -R /path/to/hise-cli/dist/embed/* public/embed/
```

After copy, files are reachable at:

```
http://localhost:3000/embed/hise-embed.js
http://localhost:3000/embed/data/moduleList.json
```

(Replace `3000` with whatever port Nuxt dev runs on.)

For production: same layout — `public/embed/` is served as static assets from the deployed site origin.

## 4. Refresh workflow

Whenever hise-cli changes, rebuild and recopy:

```bash
cd /path/to/hise-cli && npm run build:embed
cp -R /path/to/hise-cli/dist/embed/* /path/to/docs/public/embed/
```

(Optional: add a postinstall or convenience script in the docs repo.)

## 5. API reference

The bundle is an ESM module with these named exports.

### `createEmbedSession(options)`

Creates a session bound to a HISE instance.

```ts
function createEmbedSession(options?: {
  hiseUrl?: string;       // default "http://localhost:1900"
  datasets?: SessionDatasets;  // optional
}): {
  session: Session;
  completionEngine: CompletionEngine;
  close(): void;
};
```

Always call `.close()` when done — it aborts in-flight requests.

### `fetchEmbedDatasets(baseUrl)`

Convenience to load all three dataset JSONs in parallel.

```ts
function fetchEmbedDatasets(baseUrl: string): Promise<SessionDatasets>;
// e.g. await fetchEmbedDatasets("/embed/data/")
```

Returns `{ moduleList?, scriptnodeList?, componentProperties? }`. Missing files are silently skipped.

### `parseScript(source)`

Tokenizes a `.hsc` source string. Pure function, no I/O.

```ts
function parseScript(source: string): ParsedScript;
// ParsedScript = { lines: ScriptLine[] }
```

Always succeeds — invalid syntax surfaces in `validateScript`.

### `validateScript(ast, session)`

Static validation against shipped datasets and mode rules. No HISE round-trip.

```ts
function validateScript(ast: ParsedScript, session: Session): {
  ok: boolean;
  errors: { line: number; message: string }[];
};
```

### `executeScript(ast, session, onProgress?)`

Runs the script line-by-line against HISE. Fail-fast on runtime errors.

```ts
function executeScript(
  ast: ParsedScript,
  session: Session,
  onProgress?: (event: ScriptProgressEvent) => void,
): Promise<RunResult>;
```

`RunResult` shape:

```ts
interface RunResult {
  ok: boolean;
  linesExecuted: number;
  expects: ExpectResult[];   // /expect assertions
  results: CommandOutput[];  // per-line output
  error?: { line: number; message: string };
}

interface CommandOutput {
  line: number;
  content: string;            // the original .hsc line
  result: CommandResult;      // discriminated union — see below
}

type CommandResult =
  | { type: "text"; content: string }
  | { type: "error"; message: string; detail?: string }
  | { type: "code"; content: string; language?: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "tree"; root: TreeNode }
  | { type: "markdown"; content: string }
  | { type: "preformatted"; content: string }
  | { type: "empty" }
  | …others (wizard, resume-wizard, run-report — unlikely in embed scope);
```

### `formatRunReport(report, options?)` / `formatValidationReport(report)`

Returns a plain-text summary of a `RunResult` / `ValidationResult`. Useful for a quick preformatted display before building richer renderers.

### `dryRunScript(ast, session)`

Validates *and* dry-runs against HISE inside a disposable undo group. Useful for "check this snippet" buttons that don't mutate state. Returns the same `RunResult` shape but never persists.

### `HttpHiseConnection`

Low-level transport. `createEmbedSession` instantiates one for you — exported in case you want to make raw `/api/...` calls from a custom component.

## 6. Vue component (`HiseRunButton.vue`)

Drop-in component for any code block that contains a `.hsc` snippet.

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useHiseEmbed } from "~/composables/useHiseEmbed";

const props = defineProps<{ snippet: string }>();
const { run, status, output } = useHiseEmbed();

async function onClick() {
  await run(props.snippet);
}
</script>

<template>
  <div class="hise-run">
    <button @click="onClick" :disabled="status === 'loading' || status === 'running'">
      {{ status === "idle" ? "▶ Run locally"
        : status === "loading" ? "Loading…"
        : status === "running" ? "Running…"
        : "▶ Run again" }}
    </button>
    <span v-if="status === 'error'" class="hise-status err">{{ output?.errorMessage }}</span>
    <span v-else-if="status === 'done'" class="hise-status ok">
      {{ output?.linesExecuted }} line(s) executed
    </span>
    <pre v-if="output?.text" class="hise-output">{{ output.text }}</pre>
  </div>
</template>

<style scoped>
.hise-run { margin: 0.5rem 0; }
.hise-output { background: #1e1e1e; color: #ddd; padding: 1rem; overflow: auto; max-height: 30rem; font-family: ui-monospace, monospace; font-size: 13px; }
.hise-status { margin-left: 0.5rem; font-size: 0.9em; }
.hise-status.ok { color: #2ea043; }
.hise-status.err { color: #cf222e; }
</style>
```

## 7. Composable (`useHiseEmbed.ts`)

Lazy-loads the bundle once per page session. Datasets cached on the module so multiple buttons on the same page share one fetch.

```ts
// composables/useHiseEmbed.ts
import { ref } from "vue";

type EmbedModule = typeof import("/embed/hise-embed.js");

let cachedModule: EmbedModule | null = null;
let cachedDatasets: Awaited<ReturnType<EmbedModule["fetchEmbedDatasets"]>> | null = null;
let loadPromise: Promise<void> | null = null;

async function ensureLoaded(): Promise<EmbedModule> {
  if (cachedModule && cachedDatasets) return cachedModule;
  if (!loadPromise) {
    loadPromise = (async () => {
      // @ts-ignore — runtime path, not resolved at build time
      const mod = (await import(/* @vite-ignore */ "/embed/hise-embed.js")) as EmbedModule;
      cachedDatasets = await mod.fetchEmbedDatasets("/embed/data/");
      cachedModule = mod;
    })();
  }
  await loadPromise;
  return cachedModule!;
}

export type RunStatus = "idle" | "loading" | "running" | "done" | "error";

export function useHiseEmbed() {
  const status = ref<RunStatus>("idle");
  const output = ref<{
    text?: string;
    linesExecuted?: number;
    errorMessage?: string;
    raw?: unknown;
  } | null>(null);

  async function run(snippet: string) {
    output.value = null;
    status.value = "loading";

    let mod: EmbedModule;
    try {
      mod = await ensureLoaded();
    } catch (err) {
      status.value = "error";
      output.value = { errorMessage: `Failed to load embed bundle: ${String(err)}` };
      return;
    }

    status.value = "running";
    const handle = mod.createEmbedSession({
      datasets: cachedDatasets!,
      hiseUrl: "http://localhost:1900",
    });

    try {
      const ast = mod.parseScript(snippet);
      const validation = mod.validateScript(ast, handle.session);
      if (!validation.ok) {
        output.value = {
          text: mod.formatValidationReport(validation),
          errorMessage: `Validation failed (${validation.errors.length} error(s))`,
          raw: validation,
        };
        status.value = "error";
        return;
      }
      const report = await mod.executeScript(ast, handle.session);
      output.value = {
        text: mod.formatRunReport(report),
        linesExecuted: report.linesExecuted,
        errorMessage: report.error?.message,
        raw: report,
      };
      status.value = report.ok ? "done" : "error";
    } catch (err) {
      // Network failure (HISE not running, CORS) lands here
      output.value = {
        errorMessage: `Could not reach HISE on localhost:1900 — is it running?`,
      };
      status.value = "error";
    } finally {
      handle.close();
    }
  }

  return { status, output, run };
}
```

## 8. Wiring into MDX/Markdown code blocks

If your docs use a markdown renderer that wraps `<pre><code class="language-hsc">` blocks, wrap with the run button. Example shape (depends on your renderer):

```vue
<template>
  <div class="hsc-block">
    <pre><code class="language-hsc">{{ source }}</code></pre>
    <HiseRunButton :snippet="source" />
  </div>
</template>
```

Or auto-detect at the markdown component level — wrap any `<code class="language-hsc">` content automatically.

## 9. Caveats

**HISE not running** — `executeScript` rejects with a fetch failure. The composable above catches it and shows a friendly message.

**Mixed content** — if the docs site is HTTPS and HISE serves HTTP, browsers block by default. `localhost` is exempt in Chrome / Edge / Safari. Firefox occasionally needs `network.security.ports` whitelist tweaks but usually works for `localhost`.

**Multiple buttons on one page** — each click creates and disposes its own session. State accumulates *in HISE itself* across clicks — this is intentional. Snippet authors can include `/undo apply` or `clearProject` if they want a clean slate.

**Dataset version drift** — datasets baked at `npm run build:embed` time. If HISE adds a new module type, completion/validation in the embed won't know about it until the bundle is rebuilt. Execution still works — only client-side validation is affected.

**Bundle caching** — `import()` is cached by the browser per URL. After deploying a new version, either rename the file (`hise-embed.v2.js`) or rely on HTTP cache headers from the docs host.

## 10. Sample snippets to try

Module tree:

```hsc
/builder
add SimpleEnvelope MyEnv to ModulatorSynth1.GainModulation
list
```

Script eval:

```hsc
/script Interface
1 + 2 * 3
Engine.getSampleRate()
```

Param set with verification:

```hsc
/builder
set ModulatorSynth1.Gain 0.5
/expect get ModulatorSynth1.Gain == 0.5
```

## 11. Reference

- Bundle source: `src/web-embed/index.ts`
- Browser dataset loader: `src/web-embed/browserDataLoader.ts`
- Build script: `scripts/build-embed.mjs`
- Engine run pipeline (parser, validator, executor): `src/engine/run/`
- HTTP transport: `src/engine/hise.ts`
- Result types: `src/engine/result.ts`, `src/engine/run/types.ts`
