// The left column of Projects.
//
// A room is a project, and the conversations inside it are its threads. Both
// are the workspace's own rows: the project row is a `select`, the thread rows
// are the same `SidebarThreadRow` the sidebar tree renders, so the two views
// can never disagree about which conversation is open or what it is called.
//
// It floats on the sky — no panel, no right border — because the conversation
// beside it is the only surface on this screen that needs glass. Archived
// threads sit at the bottom as a disclosure, and the whole workspace (bots,
// sections, rooms, tools) stays one click away through the same sheet Home
// uses, so nothing the sidebar held is unreachable from here.

import { useState } from "react";
import { Archive, ChevronRight, PanelLeft, Plus } from "lucide-react";
import { useStore, type Bot, type Group, type Task } from "@/state/store";
import { NewRoomPanel } from "./Sidebar";
import { SidebarThreadRow } from "./SidebarThreadRow";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { projectList, type ProjectEntry } from "@/lib/project-context";

const rowClass =
  "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[14px] text-ink outline-none transition-colors duration-[var(--motion-fast)] hover:bg-raised/60 focus-visible:ring-2 focus-visible:ring-accent/60";

/** Archived threads belong to whoever archived them, so the section says
 *  which assistant a row came from rather than pretending rooms archive. */
function ArchivedThreadRow({ bot, task }: { bot: Bot; task: Task }) {
  const { dispatch } = useStore();
  return (
    <div className="flex min-w-0 items-center gap-1">
      <span className="min-w-0 flex-1">
        <SidebarThreadRow
          task={task}
          ownerId={bot.id}
          current={task.threadId === bot.threadId}
          compact
          onSelect={() =>
            dispatch({
              type: "switchTask",
              botId: bot.id,
              threadId: task.threadId,
            })
          }
          onRename={(title) =>
            dispatch({
              type: "renameTask",
              botId: bot.id,
              threadId: task.threadId,
              title,
            })
          }
          onDelete={() =>
            dispatch({
              type: "deleteTask",
              botId: bot.id,
              threadId: task.threadId,
            })
          }
          onArchive={(archivedAt) =>
            dispatch({
              type: "updateTask",
              botId: bot.id,
              threadId: task.threadId,
              patch: { archivedAt },
            })
          }
        />
      </span>
    </div>
  );
}

function ProjectRow({ entry, group }: { entry: ProjectEntry; group?: Group }) {
  const { dispatch } = useStore();
  // The project you are in is open; the others collapse to their name, so a
  // workspace with many rooms still reads as a list rather than a tree.
  const [open, setOpen] = useState(entry.current);
  const expanded = entry.current || open;

  return (
    <div>
      <div className="flex min-w-0 items-center">
        <button
          type="button"
          aria-current={entry.current ? "page" : undefined}
          aria-expanded={group && !group.dm ? expanded : undefined}
          onClick={() => {
            if (group && group.threadId !== entry.threads[0]?.threadId) {
              dispatch({
                type: "switchGroupTask",
                groupId: entry.id,
                threadId: entry.threads[0]?.threadId,
              });
            } else {
              dispatch({ type: "select", id: entry.id });
            }
            setOpen(true);
          }}
          className={cn(
            rowClass,
            "min-w-0 flex-1",
            entry.current
              ? "font-semibold"
              : "text-ink-secondary hover:text-ink",
          )}
        >
          {group && !group.dm ? (
            <ChevronRight
              aria-hidden="true"
              size={13}
              onClick={(event) => {
                event.stopPropagation();
                setOpen((value) => !value);
              }}
              className={cn(
                "shrink-0 transition-transform duration-[var(--motion-base)]",
                expanded && "rotate-90",
              )}
            />
          ) : (
            <span className="size-[5px] shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
          {entry.unread && (
            <span
              className="size-2 shrink-0 rounded-full bg-accent"
              aria-label={t("task.unread")}
            />
          )}
        </button>
      </div>
      {/* A room with no conversations of its own has nothing to nest, so it
          renders as one row — the same shape the sidebar's room tree gives
          it, rather than a row that repeats its own name. */}
      {expanded && group && !group.dm && group.tasks?.length ? (
        <div
          className="mb-1 ml-4 space-y-0.5 border-l border-hairline/30 pl-2"
          role="group"
          aria-label={t("task.namedList", { name: entry.name })}
        >
          {entry.threads.map((thread) => (
            <SidebarThreadRow
              key={thread.threadId}
              task={{
                threadId: thread.threadId,
                title: thread.title,
                busy: false,
                unread: thread.unread,
                queued: thread.queued,
              }}
              ownerId={entry.id}
              current={thread.current}
              compact
              onSelect={() => {
                if (thread.threadId !== group.threadId) {
                  dispatch({
                    type: "switchGroupTask",
                    groupId: entry.id,
                    threadId: thread.threadId,
                  });
                } else {
                  dispatch({ type: "select", id: entry.id });
                }
              }}
              onRename={(title) =>
                dispatch({
                  type: "renameGroupTask",
                  groupId: entry.id,
                  threadId: thread.threadId,
                  title,
                })
              }
              onDelete={() =>
                dispatch({
                  type: "deleteGroupTask",
                  groupId: entry.id,
                  threadId: thread.threadId,
                })
              }
            />
          ))}
          <button
            type="button"
            disabled={Boolean(group.working || group.busyBotId)}
            onClick={() =>
              dispatch({ type: "newGroupTask", groupId: entry.id })
            }
            title={t("task.newShort")}
            className="flex min-h-7 w-full items-center gap-2 rounded-md px-3 py-1 text-left text-[12px] text-ink-secondary outline-none transition-colors hover:bg-raised/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40"
          >
            <Plus aria-hidden="true" size={12} className="shrink-0" />
            <span className="truncate">{t("task.newShort")}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ProjectRail({
  group,
  onOpenAll,
}: {
  group: Group;
  onOpenAll: () => void;
}) {
  const { state } = useStore();
  const [newRoom, setNewRoom] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const projects = projectList({
    groups: state.groups,
    pendingQueued: state.pendingQueued,
    currentGroupId: state.selectedId,
    currentThreadId: group.threadId,
  });

  // Archived conversations are the person's own, not a room's: each keeps the
  // assistant it belongs to, so the row can open the exact thread.
  const archived = state.bots.flatMap((bot) =>
    (bot.tasks ?? [])
      .filter((task) => !task.routineRunId && task.archivedAt !== undefined)
      .map((task) => ({ bot, task })),
  );

  return (
    <aside
      aria-label={t("project.rail.aria")}
      data-project-rail=""
      className="hidden w-[264px] shrink-0 flex-col overflow-y-auto px-2 pb-6 md:flex"
    >
      <button
        type="button"
        onClick={() => setNewRoom(true)}
        className={cn(rowClass, "text-ink-secondary hover:text-ink")}
      >
        <Plus aria-hidden="true" size={15} className="shrink-0" />
        <span className="truncate">{t("project.rail.new")}</span>
      </button>

      <section className="mt-4">
        <h2 className="px-2.5 pb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-secondary">
          {t("project.rail.projects")}
        </h2>
        {projects.length === 0 ? (
          <p className="px-2.5 py-1 text-[13px] text-ink-secondary/80">
            {t("project.rail.empty")}
          </p>
        ) : (
          <div className="space-y-0.5">
            {projects.map((entry) => (
              <ProjectRow
                key={entry.id}
                entry={entry}
                group={state.groups.find(
                  (candidate) => candidate.id === entry.id,
                )}
              />
            ))}
          </div>
        )}
      </section>

      {archived.length > 0 && (
        <section className="mt-5">
          <button
            type="button"
            aria-expanded={archivedOpen}
            onClick={() => setArchivedOpen((value) => !value)}
            className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-left text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <ChevronRight
              aria-hidden="true"
              size={13}
              className={cn(
                "shrink-0 transition-transform duration-[var(--motion-base)]",
                archivedOpen && "rotate-90",
              )}
            />
            <Archive aria-hidden="true" size={13} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {t("project.rail.archived")}
            </span>
            <span className="text-[11px] font-medium tabular-nums normal-case">
              {archived.length}
            </span>
          </button>
          {archivedOpen && (
            <div className="mt-1 space-y-0.5">
              {archived.map(({ bot, task }) => (
                <ArchivedThreadRow
                  key={`${bot.id}:${task.threadId}`}
                  bot={bot}
                  task={task}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* The whole workspace, not just this project: assistants, sections,
          rooms, archived bots and the tools row. Same Sidebar Home opens, so
          no destination gains a screen the old route could not reach. */}
      <div className="mt-auto pt-6">
        <button
          type="button"
          data-tour="tools"
          onClick={onOpenAll}
          className={cn(rowClass, "text-ink-secondary hover:text-ink")}
        >
          <PanelLeft aria-hidden="true" size={15} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">
            {t("home.rail.all")}
          </span>
        </button>
      </div>

      {newRoom && <NewRoomPanel onClose={() => setNewRoom(false)} />}
    </aside>
  );
}
