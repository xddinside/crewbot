---
name: parallel-work
description: Turn an implementation or review plan into scoped tickets, dependencies, and worker briefs for parallel development in Crewbot. Use when distributing planned work across agents or preparing that distribution.
---

# Parallel work

Turn an agreed plan into independently verifiable assignments that fit fresh
agent contexts. This self-contained workflow adapts `to-spec` synthesis and
`to-tickets` tracer bullets.

Choose the authorized mode:

- **Prepare:** produce tickets, a dispatch map, and worker briefs. This is the
  default when the request concerns planning or handing out future work.
- **Publish:** create or update tracker tickets when that action is authorized.
- **Execute:** dispatch and coordinate workers when implementation, review, or
  agent execution is authorized. Preparing a plan alone selects Prepare.

Reuse authorization and decisions already present in the conversation. Resolve
routine decomposition yourself; ask only about material missing decisions.

## 1. Establish the contract

Read the supplied plan or review, referenced issues and relevant comments,
applicable `AGENTS.md`, and any relevant domain glossary or ADRs. Inspect only
the code needed to confirm seams, shared contracts, and current ownership.
Pin the source revisions for reviews and existing PRs; identify active workers
before assigning mutations.

Reuse the plan's investigation and reproduction evidence; research only gaps
that affect scope, contracts, or acceptance. Reuse an adequate spec or review.
If behavior is underspecified, use
[spec.md](references/spec.md) to synthesize the missing contract. Distinguish
confirmed defects, accepted changes, and optional suggestions.

**Done:** every assigned outcome has an authoritative source and observable
acceptance; unresolved product decisions are explicit.

## 2. Slice the work

Use [tickets.md](references/tickets.md) to draft one ticket per complete,
verifiable behavior, including its relevant UI, API, storage, and tests.
Each ticket should fit one fresh context. Split unrelated behaviors; keep
routine source lookup and base selection within the worker/integrator brief.
Reserve investigation tickets for uncertainty that determines a contract or
gates other work.

For a **review plan**, assign questions or invariants at pinned revisions.
Workers return evidence and findings; source changes require an implementation
assignment. Independent reviewers can inspect the same files concurrently.

For a **wide refactor**, use expand–contract: introduce compatibility, migrate
callers in bounded batches, then remove the old form. If batches cannot pass
independently, specify an integration branch and a final verification ticket.
Prefactoring earns a ticket only when it enables an identified slice.

**Done:** every accepted outcome maps to a ticket; each ticket has its own
proof and exclusions. One small coherent task may remain one ticket.

## 3. Build the dispatch map

Declare a blocking edge only for a required contract, result, or integrated
change. Keep scheduling constraints separate: shared edits, host resources,
and stack publication. Read overlap alone is not a blocker.

Resolve overlapping mutations with owned regions, a shared-contract ticket,
or serialized edits. Appoint one integrator for shared assembly and PR stacks.
Dependent work starts when required outputs are accepted and available on its
pinned base.

**Done:** the graph is acyclic, ownership is unambiguous, and the runnable
frontier lists tickets with satisfied blockers and available resources.

## 4. Prepare and optionally publish

Use the templates in [tickets.md](references/tickets.md). Save one local file
per ticket, a dispatch map, and one brief per runnable assignment in the
repository's ignored scratch directory. Keep stable tracker descriptions
behavioral; put revision-specific paths and commands in worker briefs.

In Publish mode, resolve the configured tracker from project instructions and
the fork remote. Read matching open issues before creating duplicates. Publish
blockers first; use native dependency links when supported, otherwise explicit
issue references. Apply the configured agent-ready label when available and
record readiness in the body otherwise. Preserve parent issues and unrelated
metadata unless their modification is authorized.

**Done:** every ticket has a local identifier or tracker URL; dependencies and
briefs point to the same authoritative contract.

## 5. Execute only the authorized frontier

In Execute mode, read [execution.md](references/execution.md). Dispatch separate
fresh contexts with bounded ownership, sized so the frontier stays covered: the
next runnable ticket goes out before waiting on one already running. The
coordinator retains the overall objective; workers own their tickets.

**Done:** accepted results advance the frontier. Integration and verification
remain pending until their own acceptance passes.

## Deliver

Return the ticket index, runnable groups, integrator, shared-edit/resource
constraints, and brief locations. State whether work is prepared, published,
running, or verified. In Execute mode, include accepted commits/reports and
remaining verification. Scope changes become explicit follow-up tickets.
