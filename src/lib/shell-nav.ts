// Where the user is, and how that maps onto the three destinations in the top
// bar.
//
// Deliberately *derived*, never stored. The store already knows what is
// selected; adding a second source of truth for "which destination am I on"
// is how a redesign loses a screen. So the mapping below is a pure function
// over state that already exists:
//
//   routines view        → automations (a secondary destination)
//   team-map view        → crew
//   a selected room      → projects
//   a selected bot       → home
//
// and the pills read from it, which means the highlighted pill can never
// disagree with what is on screen.

export type Destination = "home" | "crew" | "projects";

export const DESTINATIONS: readonly Destination[] = ["home", "crew", "projects"] as const;

/** The three main destinations, with the label the top bar shows. Plain
 *  strings, not catalog keys: these are the product's own navigation and must
 *  read identically in every language, the way a wordmark does. */
export const DESTINATION_LABEL: Record<Destination, string> = {
  home: "Home",
  crew: "Crew",
  projects: "Projects",
};

interface NavShape {
  activeView: "chat" | "team-map" | "routines";
  selectedId: string;
  /** True when `selectedId` names a room rather than a bot. */
  selectedIsGroup: boolean;
}

/** The destination the current state belongs to. `crew` is the fallback so a
 *  freshly booted app with nothing selected still lights a pill instead of
 *  leaving all three dark. */
export function destinationFor({ activeView, selectedIsGroup }: NavShape): Destination {
  if (activeView === "team-map") return "crew";
  if (activeView === "routines") return "crew";
  if (selectedIsGroup) return "projects";
  return "home";
}

/** True when `destination` is the one showing. The routines view is shown
 *  from Crew, so Crew stays lit while the calendar is open — otherwise the
 *  nav would go dark on a screen the user reached from a pill. */
export function isDestinationActive(current: Destination, destination: Destination): boolean {
  return current === destination;
}