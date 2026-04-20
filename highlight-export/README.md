# HISE Highlighter — Docs Export

Drop-in tokenizers for the HISE docs website. Zero runtime
dependencies, zero `node:` imports — safe for Vite/Nuxt SSR + client
bundling.

This directory is a **verbatim mirror** of `src/engine/highlight/` in
the hise-cli repo. Do not edit files here directly — upstream changes
flow from the CLI source via `just export-highlight`. See the main
[hise-cli README](../README.md#syntax-highlighter-export) for the
maintenance workflow.

## Install in Nuxt

Copy the whole directory into the Nuxt project:

```
utils/hise-highlight/      (or lib/hise-highlight/)
  hisescript.ts
  tokens.ts
  constants.ts
  builder.ts
  dsp.ts
  ui.ts
  sequence.ts
  inspect.ts
  undo.ts
  slash.ts
  xml.ts
  index.ts
  README.md
```

## Supported fence languages

| Fence | Tokenizer | Example |
|-------|-----------|---------|
| ` ```hsc ` | HiseScript source (multiline editor contents) | `var x = Engine.getSampleRate();` |
| ` ```builder ` | builder mode command | `add SineGenerator as "osc" to /` |
| ` ```dsp ` | DSP graph command | `add gain source osc to /master` |
| ` ```ui ` | UI mode command | `add Button as "play" to root` |
| ` ```sequence ` | event sequence | `500ms play sine` |
| ` ```inspect ` | inspect mode | `version` |
| ` ```undo ` | undo mode | `back 2` |
| ` ```slash ` | slash commands | `/builder add Gain` |
| ` ```xml ` | HISE preset XML | `<Preset Version="4.0.0">` |

## ProsePre.vue (Nuxt Content override)

Minimal component — checks if fence language is supported, runs
tokenizer, emits styled spans. Falls back to default Shiki renderer
for everything else.

```vue
<script setup lang="ts">
import { computed } from "vue";
import { tokenizeHise, TOKEN_COLORS, isHiseLanguage } from "~/utils/hise-highlight";

const props = defineProps<{
  code: string;
  language?: string;
}>();

const spans = computed(() =>
  props.language && isHiseLanguage(props.language)
    ? tokenizeHise(props.language, props.code)
    : null
);
</script>

<template>
  <pre v-if="spans" :class="`language-${language} hise-hl`"><code><span
    v-for="(s, i) in spans" :key="i"
    :style="{ color: s.color ?? TOKEN_COLORS[s.token], fontWeight: s.bold ? 'bold' : 'normal' }"
  >{{ s.text }}</span></code></pre>
  <ProsePreDefault v-else v-bind="$attrs" :code="code" :language="language" />
</template>

<style scoped>
.hise-hl {
  background: #1e1e1e;
  color: #DDDDFF;
  padding: 1rem;
  border-radius: 6px;
  overflow-x: auto;
}
.hise-hl code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
  line-height: 1.5;
}
</style>
```

`ProsePreDefault` is Nuxt Content's default; import or inline as
needed for your Nuxt Content version.

## Colors

All colors are hex literals in `tokens.ts` (`TOKEN_COLORS`) and
`constants.ts` (`MODE_ACCENTS`). Matches the CLI terminal palette and
HISE multiline editor. For light/dark theming, replace `TOKEN_COLORS`
usage with CSS classes (`.tok-keyword`, `.tok-string`, etc.) in
`ProsePre.vue`.
