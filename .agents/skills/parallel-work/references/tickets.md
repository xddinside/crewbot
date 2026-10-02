# Tickets and dispatch artifacts

Use an ignored scratch directory, currently
`.omb-scratch/parallel-work/<slug>/` in Crewbot. Store `dispatch.md`, one file
per ticket under `issues/`, and one brief per runnable ticket under `briefs/`.
Reference an existing spec; save `spec.md` only when a new contract is needed.
These execution artifacts remain local unless committing them is requested.

## Ticket

```markdown
# T01: <observable outcome or review question>

Source: <plan/spec/issue and the relevant requirement or finding>
Kind: implementation | investigation | review | integration
What it delivers: <complete behavior, or the review/investigation result>
Blocked by: <ticket IDs and why their outputs are required, or None>
Scope: <owned behavior/modules and shared-contract boundaries>
Exclusions: <adjacent work assigned elsewhere>

Acceptance:
- [ ] <observable result or review coverage obligation>
- [ ] <failure/recovery or compatibility case when relevant>

Verification: <existing seam/recipe and evidence required>
Completion: <accepted commit/report plus the required proof>
```

Investigation tickets answer a named uncertainty and deliver a decision with
evidence. Review tickets deliver supported findings, impact, source references,
and coverage/limits. Implementation tickets deliver behavior and regressions.
An integration ticket assembles accepted changes and owns broad verification.

A future blocker does not make a scoped ticket runnable. Preserve its
dependencies when publishing an agent-ready label.

## Dispatch map

List ticket identifiers/URLs, dependency edges, current states, and the next
parallel group. Include one integrator, each worker's mutation ownership,
shared-file regions/contracts, host test capacity, and publication ownership.
Explain any genuinely serial chain; keep independent tickets off that chain.
Map every accepted plan item or review finding to a ticket or explicit deferral.

## Worker brief

```markdown
Ticket: <one ID/URL and canonical contract>
Assignment: <implementation, read-only review, or named investigation>
Base: <repository, owned checkout/branch, pinned SHA or review range>
Ownership: <modules/files/regions; shared-interface agreement>
Read first: <minimal relevant instructions and evidence references>
Acceptance and checks: <ticket acceptance plus verified local recipes>
Resources: <host test slot, fixture/data ownership, publication limits>
Return: <commit/report, exact revision, terminal results/logs, remaining limits>
Checkpoint: <scope uncertainty, repeated failure without new evidence,
             ownership conflict, or context too large for this assignment>
```

Keep briefs small and task-specific. Give a worker one contract and only the
evidence needed to act on it.
The supplied file locations guide navigation; workers recheck current code.

Before distribution, check complete coverage, acyclic dependencies, meaningful
acceptance, single-context sizing, and a conflict-free first runnable group.
