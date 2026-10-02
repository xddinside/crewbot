# Synthesize a missing contract

Reuse the agreed conversation and codebase evidence. Extend the existing
contract where possible; create a spec only when no adequate source exists.
Review assignments can use review questions and invariants instead of user
stories. Cover distinct requirements without padding the story list.

Use these sections as needed:

- **Problem and outcome:** the user-visible problem and desired behavior.
- **Scenarios:** normal operation, failure/recovery, compatibility, and ownership.
- **Decisions:** affected modules, shared interfaces, persistence/replay
  boundaries, migration policy, and resolved tradeoffs.
- **Acceptance:** observable results at existing testing seams and named prior
  verification recipes. Prefer the highest reliable seam for each behavior.
- **Exclusions and open decisions:** work outside the assignment and questions
  that materially affect implementation or acceptance.

Keep the contract independent of filenames and line numbers. Reference the
source plan/review for evidence; put checkout-specific details in worker briefs.
When a new testing seam or unresolved contract changes an agreed outcome,
present that decision for clarification while continuing independent planning.

Done means the slices can inherit clear acceptance without inventing product
behavior. A finished spec is not evidence that the implementation works.
