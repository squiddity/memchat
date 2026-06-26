# World review scoring

Score 1-5 for each dimension:

1. **Recall:** important reusable people, places, things, and facts are represented.
2. **Deduplication:** aliases and repeated mentions are merged when supported and kept separate when not supported.
3. **Provenance:** artifact claims cite appropriate source spans and quotes.
4. **Conflict visibility:** uncertainty or disagreement remains visible rather than being silently resolved.
5. **Artifact usefulness:** markdown is readable and useful without stage JSON.

Return concise markdown with scores, evidence, and recommended fixes. If reviewer-model access is unavailable, state that semantic scoring was skipped rather than pretending deterministic checks covered it.
