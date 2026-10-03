# Execute a scoped frontier

## Dispatch

Use available agent tooling and concurrency limits. Give each worker its
brief in a fresh context, an owned worktree for mutations, and a clear return
contract. Leaf workers return new scope to the coordinator, who owns further
subdivision and dispatch. Select model/effort for the ticket's uncertainty
and tools; leave provider choice configurable.

Keep the frontier covered: dispatch the next runnable ticket before waiting on
a worker that is already running. A worker with no runnable successor waits
with the others, and the coordinator waits only when nothing is runnable.

Count every worker, reviewer, and helper against one host budget. A worker that
runs tests or typecheck wants roughly a core to itself, so cap concurrent
workers at half the core count and expect every command to slow down as the
budget fills. New scope travels back to the coordinator, which owns
subdivision; depth stays at one.

For reviews, pin a common source snapshot and permit read overlap. For
implementation, confirm active worktree ownership and available prerequisite
commits. The integrator controls shared assembly and publication; workers may
commit their owned changes but publish PR refs only when explicitly assigned.

## Verify

Workers run the acceptance checks for their slice: the `vitest` files the
change touches, plus the mapped fixture recipe when the behavior is
user-visible. Server and conversation evidence follows
`docs/verification/README.md` with owned isolated fixtures; development servers
use `portless`.

The broad gates already run elsewhere. Read `CONTRIBUTING.md` for the current
required jobs and apply `AGENTS.md`'s platform policy. CI shards the suite four
ways and runs its files serially on purpose, so the full `pnpm test` belongs to
CI; reproduce one shard with
`pnpm exec vitest run --shard=n/4`. Lint, typecheck, and the locale check run
in the `pre-push` hook and again as CI's `typecheck + lint` job. When a slice
needs that battery before its own commit, one `pnpm run checks` call covers
it: each check streams to its own log, stdout carries a status line and the
tail of a failure, and the JSON record ties the result to the tree it ran
against. The integrator owns the final assembled broad gate and uncovered
native/package checks.

Wait for CI in one blocking call: `pnpm ci:wait 812 813` covers a stack, opens
each pull request with a tally instead of its roster, and reports a check only
when its state changes. Record the terminal run links in the ticket.

Keep what enters the conversation small. Pipe `gh --json` through `jq -c`, grep
a log inside the scratch directory instead of printing it, and read a skill
through the skill loader instead of `cat`ing it. Context length is the cost
every other rule here buys down.

Coordinate heavy fixture suites on a shared host. Git worktrees isolate edits,
not CPU, disk, ports, or processes. Keep existing load-sensitive serialization
until evidence supports a change; use separate CI runners for existing shards.

Record successful checks against an exact tree/revision, command, environment,
terminal result, and log — `pnpm run checks --json` writes exactly that.
Reuse evidence only while those inputs are unchanged. After relevant edits or
integration, rerun affected acceptance.

## Integrate and checkpoint

Accept worker results after assessing their contract, evidence, and remaining
limits. Make prerequisite outputs available before starting dependent tickets.
Keep the coordinator's overall objective active while individual workers finish.

Collect related base-layer corrections on an integration candidate, verify the
assembled result, and propagate the stack in deliberate batches. Assign one
publisher; preserve remote leases and active-worker changes. Follow applicable
PR-linking and review/merge instructions in the environment.

A new CI failure needs a recorded root cause or bounded investigation. Classify
it as introduced, existing, infrastructure, or unresolved using baseline and
reproduction evidence. Keep useful acceptance and turn new scope into bounded
follow-up tickets.

Repeated failure without new evidence, shared-edit conflict, or growing context
triggers a checkpoint with current commits, reproduction, hypotheses, and next
decision. The coordinator resolves ownership or scopes a fresh assignment.

Let CI perform checks independently. Record exact SHA/run links and keep the
integration ticket pending until terminal evidence is reviewed. Update final PR
descriptions at stable checkpoints.

Done means all assigned acceptance and integration obligations have evidence.
Pending CI or native checks remain explicit pending work, never green claims.
