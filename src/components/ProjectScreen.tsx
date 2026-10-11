// Projects — a room and everything around it.
//
// The conversation is the screen. A project's own conversations run down the
// left on the sky; its goal, what it still owes and who is on it run down the
// right, also on the sky. Neither column is a container: they are headings,
// rows and hoverable lines, and the only glass on the page is the conversation
// the chat brings with it.
//
// Below `lg` the right column does not mount and below `md` neither does the
// rail — a phone has one column and one job, and the workspace drawer already
// covers that case. Same rule as Home.

import type { ReactNode } from "react";
import type { Group } from "@/state/store";
import { ProjectContext } from "./ProjectContext";
import { ProjectRail } from "./ProjectRail";

export interface ProjectScreenProps {
  group: Group;
  /** the conversation itself, supplied so this frame never imports a view */
  children: ReactNode;
  /** open the whole workspace — assistants, sections, rooms, archived, tools */
  onOpenAll: () => void;
}

export function ProjectScreen({
  group,
  children,
  onOpenAll,
}: ProjectScreenProps) {
  const remoteClient = window.ogb?.remoteClient?.active === true;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-project-screen="">
      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3 md:px-4 md:pb-4">
        <ProjectRail group={group} onOpenAll={onOpenAll} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
        {!remoteClient && !group.dm && <ProjectContext group={group} />}
      </div>
    </div>
  );
}
