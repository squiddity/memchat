# memchat

A TypeScript chat-agent experiment built on [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi) for evaluating memory-intensive, multi-session conversations.

## Goal

`memchat` explores how to keep long-running chats internally consistent across sessions. The motivating use case is ongoing fiction/chat roleplay: the model may invent details when needed, but once a detail exists, later sessions should retrieve and respect it instead of contradicting it.

We want a small, hackable agent first, then a repeatable testbench for comparing models, prompts, and memory systems.

## Why build on pi?

Pi already provides a TypeScript SDK, model/provider plumbing, sessions, streaming events, tools, extensions, skills, and package discovery. We can use those pieces while specializing the interaction model for discussion and fiction rather than coding.

Important design direction:

- Use pi SDK primitives for model/session management where possible.
- Keep the initial chat loop simple and observable.
- Treat memory as an interchangeable subsystem.
- Preserve compatibility with pi extensions/plugins where practical, including memory plugins such as `pi-mem`.
- Leave room for custom event/state models tuned to narrative facts, character state, user preferences, chronology, and contradictions.

## Memory problem statement

For this project, good memory means:

1. **Internal consistency first**: later answers should not contradict established facts unless the story/chat intentionally retcons them.
2. **Efficient recall**: use relevant prior context without blindly replaying every old message.
3. **Cross-session continuity**: remembered state must survive process restarts and resumed conversations.
4. **Traceability**: the agent should be able to explain why it believes a fact when possible.
5. **Graceful uncertainty**: when memory is incomplete or conflicting, the agent should acknowledge uncertainty or ask.

Example: if the agent invents that a hallway closet contains a brass telescope, old coats, and a locked cedar box, those details become state that should be recalled when the closet appears again.

## Planned architecture

Early versions will likely contain:

- A CLI chat runner using `createAgentSession()` from `@earendil-works/pi-coding-agent`.
- A memory interface with pluggable implementations.
- A baseline memory implementation using append-only transcripts plus extracted facts.
- Session/event logging for later evaluation.
- A small fiction consistency benchmark.

Future memory implementations may include:

- pi plugin-backed memory adapters.
- Summary hierarchies.
- Entity/event graphs.
- Vector search over utterances and extracted facts.
- Temporal state snapshots.
- Contradiction detection and reconciliation.

## Evaluation ideas

Initial tests should measure whether the agent can:

- Recall invented facts after many intervening turns.
- Maintain character attributes, relationships, locations, inventory, and unresolved plot hooks.
- Distinguish stable facts from speculation.
- Notice conflicting memories.
- Continue accurately after restarting from a previous session.

## Hello-world CLI

Run the current minimal chat loop with:

```bash
npm run dev
```

It uses `@earendil-works/pi-coding-agent`'s SDK with a `DefaultResourceLoader`, disables built-in coding tools, and leaves extension/custom tools available.

### npm-managed local pi packages

For Option B-style plugin loading, install a pi package with npm and list it in `package.json`:

```bash
npm install pi-agent-memory
```

```json
{
  "memchat": {
    "piPackages": ["pi-agent-memory"]
  }
}
```

At startup, memchat resolves those names from local `node_modules` and passes their package roots to pi as local package sources. You can also test without editing `package.json`:

```bash
MEMCHAT_PI_PACKAGES=pi-agent-memory npm run dev
```

Inside the CLI, use `/plugins` to show the resolved local package paths.

## Development status

Implemented:

1. TypeScript project scaffold.
2. `@earendil-works/pi-coding-agent` dependency.
3. Minimal streaming chat CLI.
4. npm-managed local pi package discovery for plugins/extensions.

Next expected steps:

1. Define the first memory adapter interface.
2. Add transcript/fact persistence.
3. Add basic consistency eval fixtures.

## Project conventions

- Prefer TypeScript for application code.
- Keep memory APIs small and model-agnostic.
- Add tests/evals alongside new memory behavior.
- Document assumptions about narrative state and contradiction handling.
