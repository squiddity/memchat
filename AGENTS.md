# Agent instructions for memchat

## Purpose

Build `memchat`: a TypeScript chat agent on `@earendil-works/pi-coding-agent` for memory-intensive, multi-session conversations where long-term internal consistency matters.

## Core rules

- Prioritize cross-session consistency and traceable memory behavior.
- Keep memory pluggable; do not hard-code one model provider or backend.
- Use TypeScript and prefer small, explicit interfaces and event/state types.
- When implementing memory, distinguish raw transcript/events, extracted facts, summaries, current state, and conflicts/retcons.
- Prefer skill/tool-based execution surfaces over ad hoc scripts whenever practical: use existing skills, helper commands, documented CLIs, and bounded tools; add or improve helper tools when a workflow becomes repetitive.
- For skill-first workflows such as `world-import`, keep TypeScript helpers deterministic and operational: normalize structure-preserving source blocks, persist stages, validate shape/candidate accounting, emit browseable artifacts, and check provenance/link/coverage integrity. Keep entity identity, relationship meaning, canon truth, retcons/conflicts, synopsis/style quality, and update decisions in model/skill workflow guidance rather than helper code.
- When semantic quality depends on judgment, invest first in skill instructions, bounded inspection tools, contracts, reviewer prompts, and eval fixtures so the executing model has enough leeway and context to produce high-quality maintained wiki outputs.
- For model-backed `world-import` shell runs, prefer stronger debugging by default when behavior is uncertain or a prior run failed to emit world docs: use a stronger model, keep `--debug`, and add `--show-tool-updates` so the next session can inspect tool-level failures quickly.
- For watched or longer-running project code execution, use the active agent harness's supervised execution mechanism when available instead of hiding work behind detached background jobs. Keep inline execution for quick one-shot inspection commands. This applies to `npm run ...` invocations such as imports, builds, tests, playtests, lint/eval runs, provenance audits, helper loops, repair loops, and source-search workflows.
- For a requested browser review of generated Markdown, run `npm run markdown-review` in a supervised Herdr pane placed in a dedicated `mdts` tab when `HERDR_ENV=1`. The review server lives in that tab, not the primary agent pane. To find it, inspect `herdr tab list` for the current workspace's `mdts` tab, then `herdr pane list` and `herdr pane read <review-pane> --source recent-unwrapped --lines 120`. Treat it as active only when its current output contains a `Markdown review URL:` and has not returned to a shell prompt; confirm availability by opening that exact Tailscale URL. If the `mdts` tab or its `review` pane is absent, create it; if the pane exists but is inactive, re-run `npm run markdown-review` in that same pane with `herdr pane run <review-pane> "npm run markdown-review"`. It defaults to the repository `world-output/` tree; use one explicit repository-contained root only when requested. If Herdr is unavailable, an equivalent harness-managed background task may run the command only when it preserves streamed output, returns a stoppable task handle, and is explicitly stopped after review or before session end. Do not use detached shells, `nohup`, `&`, tmux, PID files, or persistent services. Report only the emitted Tailscale URL, and never replace a Tailscale failure with a public bind, tunnel, reverse proxy, or authentication workaround.
- For a requested browser inspection of raw import JSON artifacts, run `npm run artifact-review` in a supervised Herdr pane in a dedicated `artifacts` tab when `HERDR_ENV=1`. It is a separate read-only Tailscale-bound JSON viewer and may run concurrently with `mdts` on port `8522` by default. Find or create the `artifacts` tab/pane, inspect it with `herdr pane read <artifact-pane> --source recent-unwrapped --lines 120`, and treat it as active only when its current output contains `Artifact review URL:` without a returned shell prompt. It defaults to `.memchat-agent-testing/output/`; use one repository-contained root only when requested, and pass `--port <1-65535>` only when a different artifact-review port is explicitly needed. Reuse its pane when inactive and close it after review or before session end. Never replace a Tailscale failure with a public bind, tunnel, reverse proxy, or authentication workaround.
- Add tests or eval fixtures for meaningful memory behavior changes when feasible.
- After changes, run the relevant checks from `docs/smoke-tests.md`.
- When asked to push, use the configured GitHub CLI auth (`gh auth status`, `gh auth setup-git`) rather than unauthenticated HTTPS prompts.

## Read docs on demand

Do not load every doc by default. Read the smallest relevant doc for the task:

- `README.md` — project overview, quick start, and docs map.
- `docs/cli.md` — CLI flags, commands, model selection, memory modes, local package loading.
- `docs/playtesting.md` — how the agent should run manual shell playtests; default to `interactive_shell`, a fresh memory dir, `qmd-hybrid`, and `--memory-debug` unless the user asks otherwise.
- `docs/memory-backends.md` — backend strategy, storage layout, comparison, and implementation order.
- `docs/architecture.md` — goals, memory quality bar, design direction, and current roadmap.
- `docs/world-import.md` — skill-first world-import architecture, helper contract boundary, shell quick-start, Markdown browser review workflow, lint/eval, and debugging.
- `docs/smoke-tests.md` — validation commands after code changes.
- `docs/plans/*.md` — only when a task explicitly references a plan or when implementation details need the latest plan context.

## Pi references

Stay inside this repository for file reads. For npm packages, consult only local `./node_modules` and `package.json`.

When a task depends on pi SDK or extension behavior, load the relevant local pi docs first:

- `./node_modules/@earendil-works/pi-coding-agent/docs/index.md`
- `./node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- `./node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `./node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- `./node_modules/@earendil-works/pi-coding-agent/docs/packages.md`
