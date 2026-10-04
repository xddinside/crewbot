// Assertions shared by the installed journey and regressions for its evidence.
// Busy/activity are live API fields, deliberately absent from bots.json.
function runningTask(task) {
  return task?.busy === true && task.activity === "working";
}

function idleTask(task) {
  return task?.busy === false && task.activity === "idle";
}

export function assertConcurrentTurns(tasks, targetThread, siblingThread, cwds) {
  if (targetThread === siblingThread) throw new Error("Stop proof needs two distinct threads of the same bot");
  if (cwds.get(targetThread) === cwds.get(siblingThread)) throw new Error("concurrent Stop proof threads need separate project folders");
  for (const id of [targetThread, siblingThread]) {
    const task = tasks.get(id);
    if (!runningTask(task)) throw new Error(`Stop proof thread ${id} is not concurrently running`);
    if (!cwds.get(id) || task.cwd !== cwds.get(id)) throw new Error(`Stop proof thread ${id} is not pinned to the existing fixture folder`);
  }
}

export function assertScopedStop(tasks, targetThread, siblingThread) {
  if (!idleTask(tasks.get(targetThread))) throw new Error("Stop left its target thread running");
  if (!runningTask(tasks.get(siblingThread))) throw new Error("Stop also interrupted the same bot's sibling thread");
}

export function assertAcceptedRequestPreserved(before, after, requestText) {
  for (const message of before) {
    if (!after.some((row) => row.id === message.id)) throw new Error(`Stop lost transcript row ${message.id}`);
  }
  const requests = after.filter((row) => row.role === "user" && row.kind === "text" && row.text === requestText);
  const originals = before.filter((row) => row.role === "user" && row.kind === "text" && row.text === requestText);
  if (originals.length !== 1) throw new Error("Stop proof did not capture the original accepted request");
  if (requests.length !== 1 || requests[0].id !== originals[0].id) throw new Error("stopped accepted work was automatically replayed");
}

export function assertStoppedTranscript(before, after, requestText) {
  assertAcceptedRequestPreserved(before, after, requestText);
  if (after.some((row) => row.role === "bot" && row.kind === "text")) {
    throw new Error("stopped work applied a late assistant answer");
  }
}

export function freshReplyEvidence({ before, after, requestText, expectedReply }) {
  const previous = new Set(before.map((row) => row.id));
  const requests = after.filter((row) => !previous.has(row.id) && row.role === "user" && row.kind === "text" && row.text === requestText);
  const request = requests[0];
  if (requests.length !== 1) return null;
  const requestIndex = after.indexOf(request);
  const reply = after.find((row, index) => index > requestIndex && !previous.has(row.id)
    && row.role === "bot" && row.kind === "text" && row.text?.includes(expectedReply));
  return reply ? { requestId: request.id, replyId: reply.id } : null;
}
