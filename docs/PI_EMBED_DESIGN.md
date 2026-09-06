# PI_EMBED_DESIGN.md — Embedded pi Agent for HISE

> Design document for integrating the pi coding agent into hise-cli as a
> HISE-tailored AI agent. Covers architecture, tool surface, the
> verification loop, bundled extensions, safety, and a 1.0 / stretch split.
>
> This is a *what and why* document. Exact tool schemas, event names, and
> configuration shapes live in the implementation (see source references
> throughout).

---

## Vision

hise-cli already serves external AI agents well: the CLI is JSON-first, the
`agent-context` command exposes curated per-mode knowledge, `which` maps
natural-language intents to command recipes, and the shipped pi skills
(`.agents/skills/hise-cli/SKILL.md`, `.agents/skills/hise-dsp/SKILL.md`)
teach any agent how to drive it. An external agent can *use* hise-cli.

This design goes one step further: hise-cli **embeds** an agent. The
differentiator is that the embedded agent never stops at "I made the edit" —
it can **prove** the edit, because the running HISE process is its live
instrument:

- it parses the HiseScript it just wrote (shadow parser),
- it injects real signals into the DSP network it just wired and reads back
  whether modulation actually moves,
- it plays sequences through the callback it just changed,
- it screenshots the UI it just rearranged,
- it reads the forum to ground answers in real-world usage.

The HISE process is treated the way a compiler is in a normal coding agent:
assumed running, with launch and install as the recovery path.

The existing `?<NL>` quickop — today powered by a local Ollama intent
pipeline — keeps its syntax and is reborn on the pi SDK when the integration
lands: a `?` line resolves through a throwaway, non-persisted pi session
(see NL Quickop). The Ollama pipeline is removed at that switchover; it is
not a parallel feature we maintain long-term.

---

## Scope

**In scope**

- An interactive agent session in the TUI (`/ai`) and a one-shot mode in the
  CLI (`hise-cli ai`), both backed by one shared implementation.
- A HISE-tailored agent: HISE project directory as working directory, a
  HISE system preamble, the existing HISE skills, and a tool surface built
  around hise-cli's own engine.
- A feedback loop that lets the model verify its changes against the live
  HISE instance (syntax, signal, behavior, visual).
- A small set of bundled pi extensions: forum research, setup-in-the-loop,
  and a research sub-agent ("explore").

**Out of scope**

- Replacing or modifying the engine layer. The agent is a consumer of the
  existing dispatch pipeline; `src/engine/` stays isomorphic (zero `node:`
  imports) and gains no pi dependency.
- A second HISE client protocol. The agent talks to HISE through the same
  `HiseConnection` the REPL uses.
- Multi-user / remote operation. The agent is local-only: HISE on
  `localhost`, sessions and state on the local machine.

---

## Architecture

### Placement

All pi-facing code lives in the host layers:

- `src/tui/ai/` — TUI integration: the `/ai` mode, event rendering into the
  inline shell, pre-flight launch logic.
- `src/cli/ai.ts` — one-shot CLI mode (print-mode semantics).
- A bundled **`hise` pi extension module** — registers the HISE tools and
  event hooks. It ships *inside* hise-cli (not in any user directory) and is
  injected programmatically, which is what keeps the user's regular pi clean
  of HISE artifacts and vice versa.

The engine is untouched. The HISE tools are thin adapters: they invoke the
same session dispatch the REPL uses, so every command the agent can run is
exactly a command a human can run.

### The pi SDK, embedded

Integration uses the pi SDK (`@earendil-works/pi-coding-agent`,
`createAgentSession`) rather than shelling out to the pi binary. The SDK
gives programmatic control over everything this design needs: session
creation, a tool allowlist, custom tools and extensions, event middleware
(tool interception before and after execution), steering/queueing during
streaming, compaction, and session persistence.

The SDK is **dynamically imported** only when an agent feature is invoked,
so normal hise-cli startup stays fast and light. The unknown is how much the
bun single-file binary grows as a result — see Open Questions.

### Complete state separation

Decision: the embedded agent uses its **own pi state directory**
(a HISE-owned location, not the user's pi directory). Nothing is shared with
a regular pi installation:

- **Auth, models, settings**: the embedded agent has its own credentials and
  model configuration. Rationale: a user who runs both regular pi (for
  other coding) and `/ai` (for HISE work) should never see the two entangle
  — different purposes, different models, different sessions. The cost is a
  one-time first-run authentication, which we make frictionless (see Auth).
- **Sessions**: HISE agent conversations live in their own session store,
  organized per project. `/ai resume` lists HISE conversations only;
  plain-pi conversations in the same directory are never mixed in.
- **Extensions, skills, prompts**: the embedded agent loads exactly what we
  inject (the bundled `hise` extension, the HISE skills, the HISE preamble)
  plus **project-level** resources in the HISE project directory. The
  user's global pi personalizations are deliberately *not* loaded into a HISE
  session.

What this buys: the embedded agent is a self-contained product with a
deterministic configuration, while a HISE project can still carry its own
agent customizations (project-local skills/extensions), which both regular
pi and the embedded agent respect from the same project files.

### HISE project as the agent's working directory

The agent session's working directory is the HISE project directory. This is
the keystone of the design:

- The built-in file tools operate on the project tree — the agent's file
  world *is* the project.
- HiseScript files live in the project's scripts folder, which is exactly
  where the shadow-parser hook looks (see Feedback Loop).
- Project-level resource discovery (skills, extensions, context files) keys
  off this directory for free.
- Sessions name after this directory, so conversation history maps one-to-
  one to projects.

---

## Tool surface

### Design principle: the agent speaks hise-cli

External agents already use hise-cli through one vocabulary: command strings
plus `which` / `agent-context` discovery. The embedded agent keeps exactly
that vocabulary and only changes the *transport* — instead of a subprocess,
commands execute in-process.

This has two big consequences:

1. **No grammar drift.** Pre-1.0, the grammar, verb shapes, and datasets
   change constantly. A string-command tool that reuses the existing parsers
   and dispatch always matches `CLI_GRAMMAR.md`; a set of structured tools
   would be a second vocabulary that rots with every grammar change.
2. **One skill, two worlds.** The existing SKILL.md content stays valid for
   the embedded agent with minimal adaptation: "run `hise-cli ...`" maps to
   the in-process tool. External agents and the embedded agent learn the
   same skill from the same source of truth.

### Tools

- **`hise_command`** — executes canonical direct CLI arguments in-process through
  the existing CLI dispatcher. The tool accepts `argv: string[]` (without the
  executable) and optional `stdin`; it does not accept REPL syntax or a
  separate mode field. This keeps the embedded agent on the same flag-style
  command contract as external agents and avoids CLI/REPL translation drift.
- **`hise_help`** — retrieves authoritative hise-cli documentation in-process.
  Pass a mode for its syntax and commands, or omit the mode for the generated
  command context. This describes how to use HISE; it does not inspect live
  project state.
- **`hise_setup`** — drives the existing setup wizard machinery (see
  Extensions).
- **`hise_verify`** — the verification-ladder meta-tool (see Feedback Loop).
- **`hise_forum`** — HISE forum research (see Extensions).

**Built-in file tools** (working directory = HISE project): `read`, `grep`,
`find`, `edit`, `write`. Deliberately **no shell tool**: HISE work is
script-file editing plus HISE commands; a shell would be the one capability
with no recovery story, and the verification loop already provides the
feedback a shell would otherwise supply.

### Safety model

Two regimes, matched to the two frontends:

- **TUI (`/ai`): optimistic.** The agent executes writes directly. The user
  watches tool-call lines stream into the output log, can abort a run at any
  point, and the session's existing undo support rolls completed changes
  back. No per-write confirmation prompts — that would turn multi-step
  workflows into a "yes, really?" interrogation.
- **CLI one-shot: gated.** `hise-cli ai` is **read-only by default**: it can
  inspect, diagnose, research, and propose. Any command classified as dangerous
  by the shared `AgentCommand.danger` metadata requires `--apply`; unknown
  commands fail closed. `--dry-run` remains allowed for commands that support
  it. Rationale: one-shot invocations are often scripted; the blast radius of
  an unattended agent editing a plugin must be opt-in.

Abort semantics follow the SDK's session abort: it cancels in-flight model
and tool work, leaving the session resumable.

---

## Entry points and UX

### TUI: `/ai`

`/ai` pushes a new mode onto the existing mode stack, so it inherits the
modal REPL's chrome: the tree panel (Ctrl+B), the sticky-bottom input line,
output committed to scrollback.

- Assistant text streams through the existing markdown renderer into the
  output log.
- Tool calls render as compact one-line entries (which command ran, ✓/✗,
  and a collapsed detail for results) rather than dumping raw payloads.
- The input line doubles as the **steering channel**: while the agent is
  running, typed text is queued to the session as steering (mid-run) or
  follow-up (after it stops), matching how pi's interactive TUI behaves.
- `/ai exit` pops the mode back to the previous context; the conversation is
  persisted, so `/ai resume` continues where it left off.

### CLI: `hise-cli ai`

Print-mode semantics: the prompt streams markdown to stdout and the process
exits when the run completes. A JSON output form exposes the full transcript
for scripting; a resume flag continues a saved session. Writes require the
explicit `--apply` flag (see Safety model). This mode is also the natural
entry point for *external* automation that wants the full agent loop rather
than individual commands.

### Pre-flight: the live instrument

On agent entry, a status probe checks whether HISE is reachable. If not, the
existing launch path (the same one the TUI uses) starts HISE and waits for
it; if HISE is not installed at all, the setup wizard path applies. The
probe runs **once at session entry, never per tool call** — a cold HISE
launch takes several seconds, and the agent should open already warm.

Design stance: the running HISE process is a **precondition like a compiler**.
The verification loop (below) therefore never has to reason about a cold
environment; "HISE unavailable" is a pre-flight problem, not a per-tool
problem.

Two exceptions and one nudge:

- **Absent HISE downgrades, broken HISE fails.** If HISE is *not
  installed*, pre-flight must not block session creation — it opens the
  session cold with a setup context, because the agent's first job is to
  make the precondition true (the Setup-in-the-loop flow). If HISE exists
  but won't start, that is a genuine fault: report it, don't open a session
  that pretends the instrument is alive.
- **Discovery.** "Help me set up HISE" is plausibly the first thing a user
  ever types — into an unparseable root-mode line. The landing screen and
  the unknown-command error path should advertise `/ai` as the
  conversational front door.
- **Onboarding scope discipline.** Setup work ends at "HISE running and
  reachable"; extending to project creation or anything further is a
  confirmation, never an assumption. (For the CLI one-shot, a software
  install is a bigger blast radius than a project edit, so the apply-gate
  covers setup runs as well.)

### NL quickop: the `?` syntax, reborn

The TUI's `?<request>` prefix and the `?` lines in `/run` scripts today
resolve natural language to a hise-cli command through the local Ollama
pipeline. The syntax, the parser (`kind: "ai"` lines), the executor's resolve
boundary, and the confirmation-block UX all stay; only the engine behind
them changes when the integration lands.

- **Throwaway sessions.** A `?` resolution runs in an ephemeral pi session:
  in-memory, never persisted, never part of the `/ai` conversation store.
  A `/run` script reuses **one** throwaway session across all its `?` lines
  (warm context within the script, no per-line session cost); a single
  interactive `?` line gets a fresh ephemeral session.
- **Propose-only.** The throwaway session has no mutation tools. The TUI
  flow keeps its confirmation gate (preview the resolved command, Enter to
  execute, Esc to discard) — the existing UX *is* the safety boundary. In
  run scripts the resolved command dispatches through the normal pipeline,
  as today.
- **Model tiering.** The `?` path can use a smaller/faster model than the
  main `/ai` agent. The old Ollama path was local and snappy; a cloud
  quickop compensates with a cheap model, keeping `?` feeling like a
  quickop rather than a conversation.
- **Division of labor.** `?` is stateless one-shot ("do this thing"); `/ai`
  is the stateful conversation ("work with me"). Both share the SDK, the
  auth, and the HISE context seeding.
- **Switchover.** When the pi-backed resolver lands, the Ollama pipeline
  (`src/engine/llm/` and the TUI prediction runner) is removed in the same
  change — no backwards compatibility, per the pre-1.0 policy. Until then
  the Ollama path keeps working untouched, so the switchover is a single
  atomic swap from the user's perspective.

---

## Feedback loop: the agent proves its own changes

This is the core differentiator. External agents can invoke hise-cli; only
the embedded agent gets *tight* feedback, because it can hook into both the
tool pipeline and the live HISE instance.

### Ambient feedback, driven by the active mode

The modal REPL already knows what the user is working on: the mode stack.
The embedded agent inherits this — instead of one generic verification
heuristic, the ambient hooks are a function of the *current mode*.

- `/ai` captures the mode it was entered from, and the hooks then **follow
  the live top of the mode stack**: when the agent operates dsp commands,
  the dsp feedback loop takes over for as long as it stays there. The entry
  mode is simply the initial state — the mode stack is the live intent
  signal, so the hooks track it rather than freeze it. (The `?` quickop is
  precedent: it is already mode-gated to builder/ui/dsp.)
- Each mode's automatic check reuses **that mode's own inspection
  vocabulary** — no new commands, just the mode's read-only verbs run and
  their filtered output appended to the mutation's tool result, before the
  model sees it:
  - **builder** — after module add/remove/move/parameter set: a filtered
    tree view of the affected subtree, so the model sees the exact state
    its op produced.
  - **script** — HiseScript file edit: the shadow-parser flow (below); live
    REPL evals querying callback and parameter state serve as the
    on-demand behavioral check.
  - **ui** — after component/layout edits: a filtered UI tree view; the
    expensive screenshot rung is batched at the end of a change burst,
    not per edit.
  - **dsp** — after network/scriptnode edits: a compile check per edit;
    stimulus traces are batched per burst.
  - **sequence** — after callback/sequencer changes: a short MIDI E2E,
    batched per burst.
  - **root / other** — fall back to inferring the relevant ladder rung
    from the change type itself (the `hise_verify` heuristic).
- **Hooks key off *what changed* first, *mode* second.** A HiseScript file
  edit gets the shadow parse regardless of the active mode — file edits are
  file edits — while the mode governs which *domain* checks (tree views,
  traces) get emphasized. The mode is the default lens; the change type
  overrides it.
- **Cheap per edit, rich per burst.** Per-edit hooks are limited to
  near-synchronous checks — parse, compile, tree diff — because they run
  inside the interaction loop and must not stall it. The expensive rungs
  (stimulus trace, sequence playback, screenshots) run batched at the end
  of a change burst, automatically or on `hise_verify`.
- The system preamble includes a build-generated compact syntax contract assembled from the **per-mode agent-context files**. It carries the complete routine command surface and essential path/tool rules without embedding verbose help, examples, or catalogs. Detailed notes remain behind `hise_help`, while unfamiliar HISE semantics remain behind `hise_research`. The generated contract and `agent-context` therefore share one source of truth with the CLI.

### Script mode: shadow parser on edits

pi's tool pipeline fires a result hook **after any tool executes and allows
modifying the result before the model sees it**. In script mode, when the
edit touches a HiseScript file inside the project's scripts folder, the
hook runs the existing shadow-parser flow
(see `src/cli/diagnose.ts`) and — if there are errors — appends the
diagnostics to the edit's own result and marks it failed.

The payoff is closed-loop self-correction: the model sees a syntax error
inside the result of the edit it just made and fixes it in the *same turn*,
with no human prompting it to "run diagnose" and no extra round-trip.

One caveat the hook must handle: the HISE shadow parser only has diagnostics
for files that have been **included and compiled at least once** (the
existing diagnose flow checks the included-files list and warns otherwise).
A file the agent just created is not included yet, so the hook must first
ensure inclusion (include the file, compile) and then diagnose. In practice
the hook becomes edit → include → diagnose, and the agent never notices.
Files outside the scripts folder are skipped silently, as the existing
diagnose flow already does.

### The verification ladder

Beyond syntax, the agent can verify *behavior* against the live instance.
The ladder, from cheapest to richest:

1. **Syntax** — shadow parser (automatic, see above).
2. **Signal flow** — the DSP trace command: inject a stimulus (dirac/noise/
   DC) into a module and read back parameter and signal probes, including
   recursive tracing and "changed parameters + touched edges" reporting.
   This distinguishes "the modulation edge *exists*" from "the modulation
   *moves*" — topology versus behavior.
3. **Behavior / E2E** — the sequence command injects MIDI into the running
   plugin, letting the agent exercise callbacks the way a user would
   (play a key, move a knob) and read the response.
4. **Visual** — HISE screenshots after builder/UI changes: with a
   vision-capable model, the agent compares what it intended against what
   the tree and UI actually look like.
5. **Output** — rendered audio (the engine's audio-rendering utilities
   already produce waveform and spectrogram images) — a vision model can
   "read" a spectrogram the way it reads a screenshot. Stretch tier; see
   below.

### `hise_verify`: one verdict, picked per change

The ladder is exposed through a single meta-tool. The session is the same
object the REPL uses, so it knows **what changed during the run** — script
edits, new DSP edges, callback modifications, UI moves. `hise_verify`
diffs that change set, picks the relevant rungs per change type, runs them,
and returns a compact verdict block per rung (pass/fail plus the raw values
on failure, so the model can reason about *why*).

Two disciplines make the loop fast enough to use in practice:

- **Ordering is the efficiency strategy.** Cheap rungs run first; the agent
  escalates only when lower rungs pass. A syntax error should never cost the
  agent a DSP trace.
- **Prompt discipline by default.** The HISE preamble (per-mode fragments,
  see Ambient feedback) encodes the ladder: script edits arrive pre-
  diagnosed; wired modulation gets a stimulus trace against the target
  parameter; callback changes get a short sequence; before declaring done,
  `hise_verify` runs over the changes. Verification is part of "done", not
  an afterthought.

The TUI renders verdicts as compact ✓/✗ lines in the output log, so the
human sees the same evidence the agent saw.

### Debug protocol: diagnosing reported failures

Bug reports ("X is silent", "it crashes when I do Y") run a different loop
than building, and the preamble encodes it as a standing protocol:

- **Hypotheses first, stated out loud.** Enumerate the interpretations
  (input-side vs output-side; configuration vs code) and rank them by what
  local data says, before touching anything.
- **Cheap state before expensive tests.** `show` reads against the warm
  instance come first — and local *option* knowledge can end the
  investigation on reads alone, because it turns an untestable symptom into
  a readable configuration fact (appendix example: the XY pad, diagnosed
  from ScriptPanel's callback-delivery tiers on a single read).
- **Behavior tests only when state is inconclusive.** The workhorse recipe
  is *cross-mode*: stimulus from one mode, measurement from another
  (sequence injects MIDI, dsp probes the response). Injectable stimulus
  classes: MIDI notes (sequence), DSP signals (trace), sample-map state
  (sample mode, verified by screenshot). The one class with no injection
  API — mouse/touch — falls back to **instrument-then-ask**: add temporary
  logging, ask the user to perform the action, read the HISE log, fix,
  then remove the instrumentation.
- **Never declare fixed on the strength of the change.** Re-run the exact
  failing repro and report before/after evidence (probe values, log
  lines) — the user gets proof, not an assertion.
- **No debug residue.** The `hise_verify` change-set diff treats leftover
  logging or instrumentation as a failed rung: the fix ships clean.
- **Know the shadow parser's limit.** It catches broken code, not semantic
  errors — a mistyped *callback name* compiles cleanly and simply never
  fires. That class is caught by the agent's callback-vocabulary knowledge
  (explore when local data is silent) and is a candidate for a HISE-side
  compiler warning (the MODE_DEVELOPMENT pairing pattern).

### Standing prompt disciplines

The preamble encodes a few standing rules that the worked examples
(appendix) converged on:

- **Interpret first, act once.** Resolve the request's vocabulary against
  local data, enumerate the plausible readings, and confirm the
  interpretation at one gate before mutating anything. This covers
  ambiguous names ("the ENVELOPE section" → an explicit member list),
  feature forks (built-in page vs scripted component), and ambiguous failure
  reports (input-side vs output-side).
- **Mechanical → do, generative → confirm.** Adding a built-in thing: just
  do it and show the result. Designing a DSP network or writing non-
  trivial HiseScript: propose the design, one confirmation, then run
  without interrupting. Confirm-first must never degenerate into
  interrogation on trivial ops.
- **Questions get an answer and an offer; tasks get a plan and a
  confirmation.** Never implement on the strength of a question; never
  lecture on the strength of a task.
- **Research split.** Mechanism facts come from local data; patterns and
  prior art from the forum; internal framework behavior from the version-
  pinned source tier (see Explore). Escalate the stack in that order, and
  burn an expensive tier only when the cheaper one is actually silent.
- **Onboarding scope discipline.** Setup work ends at "HISE running and
  reachable" (see Pre-flight).

---

## Bundled extensions

All bundled capabilities live in the one injected `hise` extension module:
tools, event hooks, and user commands. A HISE project can layer additional
behavior via project-level pi resources; nothing bundled ever lands in the
user's global pi directory.

### Forum research

The HISE forum runs on NodeBB, whose public API is readable without
credentials. A small tool exposes topic search (ranked hits with title,
URL, excerpt, recency) and topic fetch (posts, truncated with follow-up
fetching for full text).

Why it matters: the MCP docs backend and the mode-local docs cover
*official* documentation, but the forum is where real-world quirks,
workarounds, and design rationale live. The agent can answer *and cite the
thread*, which matters for trust on edge cases. It is also fully self-
contained — a direct API call with no dependency on any hosted service.

### Setup in the loop

The wizard framework (see `src/engine/wizard/`) already has everything:
declarative definitions, a detection phase, the install/launch task
handlers, and TUI rendering of wizard progress. The agent becomes a new
*caller* of that machinery through `hise_setup`: a detect action (platform,
HISE installed/running/reachable, project found, missing dependencies)
returning a status report, and a run action that executes the wizard with
given answers, streaming progress into the TUI through the existing wizard
renderer and returning the outcome to the agent.

This turns mechanical onboarding into conversational onboarding: "I just
installed HISE, where do I start?" → detect → "HISE runs but a dependency is
missing and no project is open yet — want me to fix both?" → wizard runs,
visible → the agent is immediately able to work. The same pattern applies to
hise-cli self-update. This is the setting where the optimistic safety model
shines most: the user explicitly asked, every shell phase streams visibly,
and abort is one keystroke away.

### Research sub-agent

Research in this system is a **four-tier escalation ladder**, ordered by
authority and cost — the mirror image of the verification ladder:

1. **Local datasets** — the main agent, directly, zero latency. API
   signatures, module and component vocabularies. Answers mechanism
   questions.
2. **Docs** — research sub-agent over the docs backend the `/mcp` mode uses.
3. **Forum** — research sub-agent over the forum tool; anecdotal authority,
   real-world coverage.
4. **C++ source** — research sub-agent reading the HISE source tree. The
   ground truth for framework behavior when docs are silent, wrong, or
   version-stale: it answers "what does the engine *actually* do here" with
   `file:line` evidence, e.g. for crash diagnosis (logs give the *where*,
   source gives the *mechanism*, the agent translates to a script-level fix).

The research capability is one tool with a domain parameter
(`docs` | `forum` | `source`): one sub-agent mechanism, the prompt and
toolset vary by domain. It has two entry points:

- a tool the main agent calls when it hits something it cannot answer from
  context, and
- a user command, so a human can ask directly without involving the main
  conversation.

The sub-agent is deliberately constrained:

- **Domain-scoped tools.** Docs/forum: the research backends only. Source:
  `read`/`grep`/`find` only, with the sub-session's working directory set to
  the HISE source root instead of the project — file scope is *per session*,
  so the main agent's project world and the source research install-tree
  world never mix. No project-mutation tools in any domain: a research
  sub-agent *cannot* touch the project by construction, not by prompt.
- **Source domain: version-pinned.** The sub-prompt carries the running
  instance's version (from the pre-flight status probe) and the source
  location (the HisePath setting of the running instance; the setup/launch
  path already discovered it). A source tree whose version marker disagrees
  with the running instance yields findings flagged *unverified-version*,
  never stated as fact — docs drift, a pinned source read doesn't.
- **Grep-first discipline.** The tree is large enough that a wandering
  reader dies of context exhaustion — the same reason this lives in a
  sub-agent at all. The sub-prompt enforces: search symbol/string → read a
  window around the hit → follow at most a couple of call edges → stop.
  Findings carry `file:line` citations, which the main agent quotes and the
  user can open to verify.
- **The main agent never pokes the tree itself.** If the distilled answer
  needs more depth, it fires a second, narrower research call — the main
  conversation's context never absorbs a single line of C++ churn.
- **Distilled output**: exact API signatures plus citations (doc page,
  example, forum thread, source file:line).
- **Ephemeral**: the sub-session is in-memory; it leaves no session behind.
- **Optional cheaper model**: research is search-and-summarize, not
  plan-and-mutate, so it can run on a smaller model from the same
  credentials, at the user's choice.

An honesty boundary belongs in the preamble: the source tier explains
*framework* behavior — the agent may cite it for "the engine does X when
called Y", never to assert "your bug is here" without its own repro
evidence; user-script bugs are not in the HISE tree.

The architectural reason to make this a sub-agent rather than let the main
agent do the lookups itself is **context quarantine**: a research answer
costs many query round-trips and large document chunks. Inline, all of that
churn lands in the main conversation and eventually gets compacted away —
degrading the working context (the DSP refactor you are actually in the
middle of). The sub-agent quarantines the churn; the main session absorbs a
few distilled paragraphs.

Before retrieval, a compact query-expansion turn translates the literal
question into a few alternative searches that preserve its relationships while
adding HISE terminology. Results are merged by reciprocal-rank fusion. Before
full documents are fetched, a dedicated reranking turn receives this larger set
of shallow documentation and example matches and selects a small, bounded
evidence set for synthesis. Selection values are validated against
the retrieved candidates, with a retrieval-order fallback if the reranker
returns malformed output. This improves precision without trusting an
intermediate model to paraphrase or discard source facts. Immediately before
synthesis, a deterministic cleaner removes machine-facing C++ signatures,
source and dispatch sections, preprocessor guard names, and raw thread-safety
labels while preserving the user-facing API text and source identifiers.

Generated examples are diagnosed as standalone code against live HISE. API
validation errors that only report a referenced module missing from the current
project are ignored for research examples: they describe a different project
context, not invalid HiseScript. Syntax errors and other API diagnostics remain
actionable and can trigger correction.

Scope decision: research ships inside the agent (tool + command) in 1.0.
A standalone `hise-cli explore` command outside the agent is a candidate
follow-up — it would serve non-agent users and external agents, but it pulls
the SDK into a non-agent code path and eventually needs a non-pi fallback
for users without credentials.

---

## Auth and first run

Because state is fully separated, the embedded agent has its own
credentials. First-run design:

- On first `/ai` (or `hise-cli ai`) use, missing authentication is detected
  and surfaced clearly, with a guided path: the SDK's interactive
  authentication flow (OAuth where the provider supports it) or provider
  API keys from environment variables.
- Environment keys are picked up automatically when present — many users
  already have provider keys in their environment from other tooling, so
  first run often works with zero setup.
- hise-cli never proxies or stores the user's regular pi credentials;
  "I use both" means two small, separate credential sets, which the
  separation decision explicitly accepts.

---

## 1.0 core vs. stretch

**Core**

- Embedded session: separate state directory, HISE project as working
  directory, pre-flight launch, TUI `/ai` mode + CLI one-shot with gated
  writes, persistent resumable sessions.
- `hise_command` + `hise_help` tools; built-in file tools without shell.
- Mode-driven ambient feedback: per-mode per-edit hooks (filtered tree
  views, shadow parse, compile checks) plus the batched rich rungs (trace,
  sequence, screenshot) at the end of change bursts.
- Verification ladder: trace + sequence rungs and the `hise_verify` meta-
  tool; prompt discipline encoding the ladder.
- Forum research tool.
- Setup-in-the-loop (`hise_setup` detect/run over the existing wizard).
- Explore sub-agent with dual entry point and the four-tier research
  stack (local data → docs → forum → version-pinned C++ source via HisePath).
- Debug protocol and the standing prompt disciplines in the preamble
  (interpret first; mechanical vs generative; question vs task; instrument-
  then-ask; no debug residue).
- `?` quickop rerouted to throwaway pi sessions; Ollama pipeline removed at
  switchover.

**Stretch**

- Visual verification wired automatically: screenshots attached after
  builder/UI mutations (requires a vision-capable model to be useful).
- Audio-output rung: spectrogram/waveform "reading" of rendered audio.
- Event-driven steering: HISE runtime errors and log lines forwarded into
  the running session as steering input, so the agent reacts to crashes
  without the user pasting errors back.
- Standalone `hise-cli explore` outside the agent (plus a non-pi fallback
  for credential-less users).
- Per-project explore customization beyond the default research toolset.

---

## Open questions

These need answers during implementation (spike first):

1. **Bundling cost.** How much does the pi SDK grow the bun single-file
   binary, and does the dynamic import keep startup fast? If the binary
   delta is unacceptable, the fallback is spawning an installed pi in RPC
   mode — same tool/extension design, looser coupling. Measure before
   deciding.
2. **Settings/auth decoupling.** We inject resources programmatically
   (custom tools, inline extension, skills, preamble) rather than relying
   on directory discovery. Confirm that credentials, model configuration,
   and session storage still key off the separate state directory
   independently of how resources are supplied.
3. **Hook latency.** Ambient per-edit hooks (include-then-diagnose in
   script mode, tree views in builder/ui) each cost a HISE round-trip.
   Measure in the mock/live contract suites; the cheap-per-edit / rich-
   per-burst split is the fallback if any single hook hurts interactive
   feel.
4. **Trace/sequence latency.** The rungs depend on real-time playback
   delays. The verify tool should batch stimuli and probes into as few
   round-trips as the API allows.
5. **Model assumptions.** Visual rungs and the "read a spectrogram" stretch
   tier assume a vision-capable model; everything else must work on a text
   model, and the verification verdicts should degrade to numeric readings
   rather than visual claims when the model cannot see.
6. **`?` quickop latency and offline use.** The Ollama path was local and
   instant; the pi quickop is a cloud round-trip. Measure it with a fast
   model, and decide whether an offline fallback (e.g., the Ollama path kept
   as an opt-in local provider) is worth preserving against the pre-1.0
   removal policy.
7. **What the HISE install actually contains.** The source tier assumes the
   installed tree (per HisePath) carries enough of the framework source to
   be readable — confirm whether a standard install ships full sources or
   only headers/includes, and whether the running version can be matched to
   a fetchable source checkout (git tag) when the local tree is
   insufficient. The version-pinning rule already degrades gracefully
   (unverified-version flag), but the *useful* case needs a real tree.
8. **Dataset completeness for standard components.** The shipped UI
   component data covers only the Script* components; standard components
   (Knob, Slider, …) have no local property knowledge, so styling questions
   and config-tier diagnoses escalate to explore. If HISE can emit
   standard-component property metadata, shipping it makes an entire class
   of bug and styling request a one-read local diagnosis (appendix: the XY
   pad case).
9. **Temporal parameter probing.** The trace API probes parameters point-
   in-time; *watching* a modulated parameter wobble (the direct proof of
   wow/flutter) needs a time-series probe. Today's fallback — comparing
   output traces at parameter extremes — works but is indirect. A small
   REST addition, per the MODE_DEVELOPMENT pairing.

---

## Appendix: worked examples

Seven requests spanning the usage spectrum the design was checked against.
None required a new tool; together they produced the discipline lines, the
instrument-then-ask rung, the research stack, and open questions 8–9.

### 1. "Please help me setup HISE on this machine." — *onboarding*

Pre-flight inverts: HISE absent ⇒ the session opens cold with setup context,
not an error. The agent confirms with `hise_setup detect`, lays out the plan,
runs the existing wizard (progress streams through the wizard renderer;
pauses are relayed conversationally), verifies HISE is reachable, and hands
off. The LLM is a thin conversational layer over machinery that already does
the heavy work — the expensive minutes are wizard shell phases, not tokens.
Embedded wins on interactive pauses, live progress, and in-process
confirmation; an external agent can only front-load answers and go blind
during the build.

### 2. "Please add a preset browser to the main page." — *vocabulary fork*

Local data resolves "preset browser" to a built-in *Page* type, not a
widget — and flags a fact in no dataset: editor-world vs plugin-world. One
explore call settles it; the agent presents both readings (built-in editor
page vs a custom scripted component on the preset scripting API) at a single
gate. The short path is a few ops plus a screenshot; the long path is a
generative mini-project running the confirm-first discipline across UI,
script, and verify.

### 3. "I want to add a tape delay FX." — *generative design*

Local data says *no tape delay exists* — the agent refuses to hallucinate a
module, runs one explore pass for prior art, then proposes a full DSP design
(signal path, wow/flutter sources, hiss, parameter set) for a single
confirmation. Execution crosses modes (builder add → dsp build) and the
ambient loop switches with it (compile per edit, traces per burst). The
debug-grade verification: dirac injected, Time moved, first-echo arrival
re-measured — the parameter provably moves the signal. Exposed open question
9 (temporal probing).

### 4. "Move the ENVELOPE section to a new UI page, make it compact — and
knobs to dark mode." — *visual iteration*

The visual grouping resolves to an explicit member list at the gate; "compact" becomes arithmetic (measured boxes → a tighter grid), and the new
page carries its own navigation question in the same confirmation. Execution
batches comma-chained ops (ambient hooks fire per tool call, so batching is
the efficiency rule); verification splits by concern — overlaps by
arithmetic, aesthetics by screenshot, and the user's live HISE window is the
real preview. "Dark mode" is not confirmed vocabulary for standard knobs
(open question 8) → explore resolves the mechanism and the scope question.
Convergence is 1–3 batches of user glances: the agent optimizes, the user
tastes.

### 5. "The arpeggiator is not playing the notes on MIDI channel 2." —
*cross-mode diagnosis*

Hypotheses stated (input filter vs output channel vs the oscillator's own
filter vs a callback). Cheap `show` reads settle many of these on the first
round; otherwise the workhorse recipe runs: sequence injects ch1+ch2 notes,
dsp probes both oscillators' outputs. After the fix, the exact repro is
re-run and before/after probe values reported — never "fixed" on the
strength of the change.

### 6. "The XY pad we scripted on a ScriptPanel doesn't react to mouse
drag." — *config-tier diagnosis*

The shipped dataset carries ScriptPanel's callback-delivery tiers (default:
none) — a single `show` read diagnoses: delivery suppressed by component
configuration, no code involved. The instrument-then-ask rung covers the
residual (mouse has no injection API): temporary logging → user drags → read
the log → fix → remove the instrumentation (the no-debug-residue rung). Also
names the shadow parser's honest limit: a mistyped callback name compiles and
lies by omission.

### 7. "How can I colour the keys according to what samplemap is loaded?" —
*question, not task*

Verb discipline: answer + offer, never silent implementation. The whole
answer composes from local data (a map JSON reader, per-key colouring, the
map-change hook) and is tailored to *their* keyboard component by one read.
If the user says "do it", the same session runs the full pipeline with zero
context rebuild — and the follow-up task is machine-verifiable end to end:
sample mode swaps the map, the VLM confirms the recoloured screenshot. The
most vehicle-neutral of the set: an external agent answers it just as well;
the embedded edge is zero-handoff follow-through.

---

## Related documents

- [DESIGN.md](DESIGN.md) — the three-layer architecture this design plugs
  into.
- [CLI_GRAMMAR.md](CLI_GRAMMAR.md) — the command grammar used by `hise_command`
  executes; any grammar change changes the agent surface automatically, by
  construction.
- [MODE_DEVELOPMENT.md](../MODE_DEVELOPMENT.md) — HISE REST development
  workflow; the verification rungs lean on the same API.
- [WIZARD_CONVERSION.md](WIZARD_CONVERSION.md) — the wizard machinery
  `hise_setup` drives.
- [docs/agent-context/](agent-context/) — the curated per-mode knowledge
  behind `hise_help`.
- [WORKFLOW_GUIDE.md](WORKFLOW_GUIDE.md) and [DSP_DEVELOPMENT_WORKFLOW.md](DSP_DEVELOPMENT_WORKFLOW.md) —
  the human workflows the verification ladder automates.
