---
name: world-review
description: Review a world-import output bundle for semantic quality. Use after world-import emits normalized sources, extraction stages, merge stage, and markdown artifacts, especially with a stronger reviewer model.
---

# World Review

Review a world-import bundle. Focus on semantic quality that deterministic tests cannot prove:

- entity/fact recall from the source fixture;
- duplicate and alias handling;
- provenance correctness;
- uncertainty and dispute visibility;
- usefulness/readability of markdown artifacts.

Read `references/scoring.md` before scoring. Use source slices rather than rereading whole corpora when checking individual claims.
