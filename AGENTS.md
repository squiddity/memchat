# Agent instructions for memchat

## Project purpose

This repository is for building `memchat`: a TypeScript chat agent on top of `@earendil-works/pi-coding-agent` focused on memory-intensive, multi-session conversations. The priority is internal consistency over time, especially for fiction/chat scenarios where arbitrary invented details are acceptable only if they are remembered later.

## Key principles

- Prioritize cross-session consistency and traceable memory behavior.
- Keep the initial agent simple before adding complex memory systems.
- Design memory as a pluggable subsystem so models, storage backends, and pi memory plugins can be compared.
- Preserve compatibility with pi SDK concepts and pi packages/extensions when practical.
- Favor discussion/fiction state models over coding-agent assumptions when they conflict.

## Development guidance

- Use TypeScript for source code.
- Prefer small interfaces and explicit event/state types.
- Avoid hard-coding one model provider or one memory backend.
- When implementing memory, distinguish at least:
  - raw transcript/events,
  - extracted facts,
  - summaries,
  - current world/chat state,
  - conflicts or retcons.
- Add tests or eval fixtures for new memory behavior when feasible.
- Keep README.md updated as architecture decisions become real.
- After changes, run the relevant smoke tests in `docs/smoke-tests.md`.
- For memory backend planning and implementation order, consult `docs/memory-backends.md`.
- When asked to push, use the GitHub CLI authentication already configured for this repository (`gh auth status` / `gh auth setup-git`) instead of unauthenticated HTTPS prompts.

## Pi references

All file reads should stay inside this project folder. For npm packages, consult only packages installed under this repository's `./node_modules` and declared in `package.json`.

For SDK and extension details, consult the local pi docs before implementing:

- Main docs/index: `./node_modules/@earendil-works/pi-coding-agent/docs/index.md`
- SDK docs: `./node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- Extensions docs: `./node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- Skills docs: `./node_modules/@earendil-works/pi-coding-agent/docs/skills.md`
- Package docs: `./node_modules/@earendil-works/pi-coding-agent/docs/packages.md`

## Memory evaluation mindset

When adding features, consider how they help answer:

- Can the agent recall a detail invented many turns ago?
- Can it avoid contradicting entity attributes, locations, relationships, inventory, and plot hooks?
- Can it survive process/session restarts?
- Can it cite or inspect the memory source for a claim?
- Can different memory systems be swapped and compared fairly?
