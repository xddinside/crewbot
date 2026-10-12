// Connected apps marketplace, backed by Composio Sessions. Catalog comes
// from /api/connectors/catalog — the full toolkit list with logos when a
// Composio API key is configured, a curated set otherwise. Icons resolve
// logo → favicon → monogram.
//
// This is a page, not a modal. It fills the shell's column under the top bar
// and stands directly on the sky: the rail, the search box, the segmented
// pills and every notice are transparent, and the one glass surface is the
// selected app's detail card — the place work happens. What an app *says* is
// decided in `lib/apps-tools-view.ts`, so the rail row and the card under it
// can never disagree.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, ExternalLink, Loader2, Plus, RefreshCw, Search, TriangleAlert, X } from "lucide-react";
import { api, useStore, type Bot, type InstanceInfo } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import {
  appDetailStatus,
  appRailSubtitle,
  resolveApp,
  type AppLine,
  type AppResolved,
} from "@/lib/apps-tools-view";
import { readCachedInventory, writeCachedInventory } from "@/lib/connected-apps-cache";
import { managedConnectorUnavailableReason } from "../../shared/connector-availability";
import { GlassCard } from "@/components/Glass";
import { McpServersPanel } from "./McpServersPanel";

export interface ToolkitCard {
  slug: string;
  label: string;
  blurb: string;
  logo: string | null;
  noAuth?: boolean;
  domain: string | null;
}

export interface ConnectorStatus {
  connected: boolean;
  pending?: boolean;
  status?: string;
  accounts?: Array<{
    id: string;
    alias?: string;
    status: string;
  }>;
}

// The panel is a modal and unmounts whenever it closes. Keep the last known
// account inventory at module scope so reopening never flashes every service
// as disconnected while a fresh secure status check runs in the background.
let cachedConnectorStatus: Record<string, ConnectorStatus> | null = null;
let cachedConnectorStatusAt = 0;
let cachedConnectorStatusAuthoritative = true;
let connectorStatusRequest: Promise<ConnectorInventory> | null = null;
const CONNECTOR_STATUS_CACHE_MS = 30_000;

export interface ConnectorInventory {
  services: Record<string, ConnectorStatus>;
  /** false when the server could not read the credential store: the list is
   * then "we do not know", and nothing may be cleared on the strength of it */
  authoritative: boolean;
}

/** Warm the account inventory once the app server is ready. Concurrent panel
 * opens share the same request, and recent data survives modal unmounts. */
export function preloadConnectedApps(force = false): Promise<ConnectorInventory> {
  if (!force && cachedConnectorStatus !== null && Date.now() - cachedConnectorStatusAt < CONNECTOR_STATUS_CACHE_MS) {
    return Promise.resolve({
      services: cachedConnectorStatus,
      authoritative: cachedConnectorStatusAuthoritative,
    });
  }
  if (connectorStatusRequest) return connectorStatusRequest;
  connectorStatusRequest = api("/api/connectors/connected")
    .then((response) => {
      const services: Record<string, ConnectorStatus> = response.services ?? {};
      // An unreadable credential store tells us nothing about what is
      // connected. Keep the last inventory we were sure about instead.
      if (response.credentialStore === "unavailable") {
        return { services: readCachedInventory()?.services ?? {}, authoritative: false };
      }
      cachedConnectorStatus = services;
      cachedConnectorStatusAt = Date.now();
      cachedConnectorStatusAuthoritative = true;
      writeCachedInventory(services, Date.now());
      return { services, authoritative: true };
    })
    .catch(() => ({ services: readCachedInventory()?.services ?? {}, authoritative: false }))
    .finally(() => {
      connectorStatusRequest = null;
    });
  return connectorStatusRequest;
}

export function disconnectAccountConfirmation(
  service: string,
  account: { id: string; alias?: string },
) {
  const identity = account.alias ? `“${account.alias}” (${account.id})` : `“${account.id}”`;
  return t("connectors.disconnectConfirm", { identity, service });
}

/** Bots that cannot see the workspace's connected apps because their own
 * per-bot grant is off. Connecting an app is only half of it: a bot a Chief
 * of Staff created, a package brought in, or a backup restored starts with
 * that grant off, and until it is on the bot is never told the tools exist
 * and reaches for a browser instead — with nothing on screen saying why.
 * Bots whose engine cannot mount the tools at all are left out, because
 * their switch is disabled: naming them would move the dead end, not end it.
 * Hidden bots are left out for the same reason — the person cannot act on
 * one from here. */
export function botsMissingConnectedApps(bots: Bot[], instances: InstanceInfo[]): Bot[] {
  return bots.filter((bot) =>
    !bot.hidden &&
    bot.composio === false &&
    instances.find((instance) => instance.instanceId === bot.modelSelection.instanceId)
      ?.capabilities?.composioMcp === true);
}

export function hasUsableConnectedApps(configured: boolean, phase: ConnectorInventoryPhase, stale: boolean, status: Record<string, ConnectorStatus>): boolean {
  return configured && phase === "ready" && !stale && Object.values(status).some((service) => service.connected);
}

export function requiresAccountAlias(message: string) {
  return /account alias.*existing connection.*not replaced/i.test(message);
}

export type ConnectorInventoryPhase = "loading" | "ready" | "error";

export function connectorActionLabel(
  phase: ConnectorInventoryPhase,
  state: { busy: boolean; included: boolean; canContinue: boolean; pending?: boolean; hasAccounts: boolean; failed: boolean },
) {
  if (state.busy) return null;
  if (state.included) return t("connectors.action.included");
  if (phase === "loading") return t("connectors.action.checking");
  if (phase === "error") return t("connectors.action.unavailable");
  if (state.canContinue) return t("connectors.action.continue");
  if (state.pending) return t("connectors.action.checkStatus");
  if (state.hasAccounts) return t("connectors.action.addAccount");
  if (state.failed) return t("connectors.action.retry");
  return t("connectors.action.connect");
}

export function connectedInventoryCopy(phase: ConnectorInventoryPhase) {
  if (phase === "loading") return {
    title: t("connectors.empty.loadingTitle"),
    description: t("connectors.empty.loadingDesc"),
  };
  if (phase === "error") return {
    title: t("connectors.empty.errorTitle"),
    description: t("connectors.empty.errorDesc"),
  };
  return {
    title: t("connectors.empty.noneTitle"),
    description: t("connectors.empty.noneDesc"),
  };
}

/** An `AppLine` as one string: the app's own words when it had any, otherwise
 *  the catalog's. Never both, and never an empty line. */
export function appLineText(line: AppLine): string {
  if (line.label) return line.label;
  if (!line.labelKey) return "";
  return t(line.labelKey, line.params);
}

const TONE_CHIP: Record<ReturnType<typeof appDetailStatus>["tone"], string> = {
  connected: "bg-success/12 text-success",
  attention: "bg-warning/12 text-warning",
  idle: "bg-raised text-ink-secondary",
  muted: "bg-raised text-ink-secondary",
};

export function mergeCurrentConnectorStatus(
  current: Record<string, ConnectorStatus>,
  incoming: Record<string, ConnectorStatus>,
  latestGenerations: ReadonlyMap<string, number>,
  requestGenerations: ReadonlyMap<string, number>,
) {
  const next = { ...current };
  for (const [slug, state] of Object.entries(incoming)) {
    if ((latestGenerations.get(slug) ?? 0) !== (requestGenerations.get(slug) ?? 0)) continue;
    next[slug] = state;
  }
  return next;
}

export function mergeCompleteConnectorStatus(
  current: Record<string, ConnectorStatus>,
  incoming: Record<string, ConnectorStatus>,
  latestGenerations: ReadonlyMap<string, number>,
  requestGenerations: ReadonlyMap<string, number>,
  /** Did the server actually KNOW the full picture? A response sent while the
   * credential store was unreadable carries no information about what is
   * connected, so it must not be allowed to clear anything — an empty list
   * from an ignorant server is exactly how a connected app became a Connect
   * button. Disconnection still shows up on the next authoritative answer. */
  authoritative = true,
) {
  const next = { ...current };
  if (!authoritative) return mergeCurrentConnectorStatus(next, incoming, latestGenerations, requestGenerations);
  for (const [slug, state] of Object.entries(current)) {
    if (incoming[slug]) continue;
    if (!state.connected && !state.accounts?.length) continue;
    if ((latestGenerations.get(slug) ?? 0) !== (requestGenerations.get(slug) ?? 0)) continue;
    next[slug] = { connected: false, pending: false, status: "not_connected", accounts: [] };
  }
  return mergeCurrentConnectorStatus(next, incoming, latestGenerations, requestGenerations);
}

export function onlyLatestConnectorResponses(
  incoming: Record<string, ConnectorStatus>,
  latestRequests: ReadonlyMap<string, number>,
  requestIds: ReadonlyMap<string, number>,
) {
  return Object.fromEntries(
    Object.entries(incoming).filter(
      ([slug]) => (latestRequests.get(slug) ?? 0) === (requestIds.get(slug) ?? 0),
    ),
  );
}

/** A toolkit's mark: official logo, else favicon by domain, else monogram.
 * Shared with the onboarding connectors scene so both show the same logos. */
export function ServiceIcon({ card, className = "size-11" }: { card: Pick<ToolkitCard, "logo" | "domain" | "label">; className?: string }) {
  // 0 = official logo, 1 = favicon by domain, 2 = monogram
  const [stage, setStage] = useState(card.logo ? 0 : card.domain ? 1 : 2);
  // The full catalog is well over a thousand cards, so let the browser skip
  // the logos that are scrolled out of view instead of fetching every one.
  if (stage === 0 && card.logo) {
    return (
      <img
        src={card.logo}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(1)}
      />
    );
  }
  if (stage === 1 && card.domain) {
    return (
      <img
        src={`https://www.google.com/s2/favicons?domain=${card.domain}&sz=64`}
        alt=""
        loading="lazy"
        className={cn("rounded-xl object-contain", className)}
        onError={() => setStage(2)}
      />
    );
  }
  return (
    <div className={cn("flex items-center justify-center rounded-xl bg-raised text-[15px] font-semibold text-ink-secondary", className)}>
      {card.label.slice(0, 1).toUpperCase()}
    </div>
  );
}

export function PluginsPanel() {
  const { state, dispatch } = useStore();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const pageRef = useRef<HTMLDivElement>(null);
  const surface = state.pluginsSurface;
  const [cards, setCards] = useState<ToolkitCard[] | null>(null);
  const [source, setSource] = useState<"api" | "curated">("curated");
  const [configured, setConfigured] = useState(false);
  const [mode, setMode] = useState<"managed" | "self-hosted" | "unavailable">("unavailable");
  // Paint what we last knew before any request goes out: the module cache if
  // this window already fetched, otherwise the inventory saved on disk. An
  // empty panel is never the first thing a connected user sees.
  const [status, setStatus] = useState<Record<string, ConnectorStatus>>(
    () => cachedConnectorStatus ?? readCachedInventory()?.services ?? {},
  );
  /** true when what is on screen is remembered rather than confirmed */
  const [stale, setStale] = useState(
    cachedConnectorStatus !== null && !cachedConnectorStatusAuthoritative,
  );
  const [pendingUrls, setPendingUrls] = useState<Record<string, string>>({});
  const [aliasSlug, setAliasSlug] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [inventoryPhase, setInventoryPhase] = useState<ConnectorInventoryPhase>(
    cachedConnectorStatus === null ? "loading" : "ready",
  );
  const [error, setError] = useState<string | { key: LocaleKey } | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"marketplace" | "connected">("marketplace");
  /** which app's detail card is open. Null means "none chosen yet" — the rail
   *  still lists everything, and the card area says so rather than guessing. */
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  const pollTimers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const statusGenerations = useRef(new Map<string, number>());
  const latestStatusRequests = useRef(new Map<string, number>());

  const refreshStatus = useCallback((slugs: string[]): Promise<Record<string, ConnectorStatus>> => {
    if (!slugs.length) return Promise.resolve({});
    const requestGenerations = new Map(slugs.map((slug) => [slug, statusGenerations.current.get(slug) ?? 0]));
    const requestIds = new Map(slugs.map((slug) => {
      const requestId = (latestStatusRequests.current.get(slug) ?? 0) + 1;
      latestStatusRequests.current.set(slug, requestId);
      return [slug, requestId];
    }));
    return api(`/api/connectors?services=${slugs.join(",")}`)
      .then((r) => {
        const services = onlyLatestConnectorResponses(
          r.services ?? {},
          latestStatusRequests.current,
          requestIds,
        );
        // A one-service OAuth poll must not erase every other app's state.
        // A request that began before Connect must also not erase the newer
        // local INITIATED state when its stale not_connected result arrives.
        setStatus((current) => mergeCurrentConnectorStatus(
          current,
          services,
          statusGenerations.current,
          requestGenerations,
        ));
        for (const [slug, state] of Object.entries(services)) {
          const isCurrent = (statusGenerations.current.get(slug) ?? 0) === (requestGenerations.get(slug) ?? 0);
          if (isCurrent && state.connected && !state.pending) setPendingUrls((current) => {
            if (!current[slug]) return current;
            const next = { ...current };
            delete next[slug];
            return next;
          });
        }
        return services;
      })
      .catch(() => ({}));
  }, []);

  const refreshConnectedStatus = useCallback((force = false): Promise<Record<string, ConnectorStatus>> => {
    const requestGenerations = new Map(statusGenerations.current);
    setRefreshing(true);
    return preloadConnectedApps(force)
      .then(({ services, authoritative }) => {
        setStale(!authoritative);
        setStatus((current) => mergeCompleteConnectorStatus(
          current,
          services,
          statusGenerations.current,
          requestGenerations,
          authoritative,
        ));
        for (const [slug, state] of Object.entries(services)) {
          const isCurrent = (statusGenerations.current.get(slug) ?? 0) === (requestGenerations.get(slug) ?? 0);
          if (isCurrent && state.connected && !state.pending) setPendingUrls((current) => {
            if (!current[slug]) return current;
            const next = { ...current };
            delete next[slug];
            return next;
          });
        }
        return services;
      })
      .finally(() => setRefreshing(false));
  }, []);

  const loadConnectionInventory = useCallback((force = false) => {
    const hadCachedInventory = cachedConnectorStatus !== null;
    if (!hadCachedInventory) setInventoryPhase("loading");
    setError(null);
    return refreshConnectedStatus(force)
      .then((services) => {
        setInventoryPhase("ready");
        return services;
      })
      .catch((cause) => {
        if (!hadCachedInventory) setInventoryPhase("error");
        setError(cause instanceof Error ? cause.message : String(cause));
        return {};
      });
  }, [refreshConnectedStatus]);

  useEffect(() => () => {
    for (const timer of pollTimers.current.values()) clearInterval(timer);
    pollTimers.current.clear();
  }, []);

  useEffect(() => {
    if (inventoryPhase !== "ready") return;
    cachedConnectorStatus = status;
    cachedConnectorStatusAt = Date.now();
    cachedConnectorStatusAuthoritative = !stale;
  }, [inventoryPhase, stale, status]);

  useEffect(() => {
    let alive = true;
    void loadConnectionInventory();
    api("/api/connectors/catalog")
      .then((r) => {
        if (!alive) return;
        setCards(r.cards ?? []);
        setSource(r.source ?? "curated");
        setConfigured(Boolean(r.configured));
        setMode(r.mode ?? "unavailable");
      })
      .catch((e) => {
        if (!alive) return;
        setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [loadConnectionInventory]);

  useEffect(() => {
    // A page, so no focus trap: the top bar above it stays reachable, and
    // trapping Tab inside a full-height view would strand it. Escape still
    // closes, and the search box still takes the first Tab stop.
    const page = pageRef.current;
    const focusable = () =>
      Array.from(
        page?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    (page?.querySelector<HTMLElement>("input") ?? focusable()[0] ?? page)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dispatch({ type: "togglePlugins", open: false });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  const openConnectUrl = async (url: string) => {
    if (window.ogb?.openExternal) {
      await window.ogb.openExternal(url);
      return;
    }
    // Browser development fallback. If a popup blocker rejects the first
    // asynchronous open, the visible Continue button retries from a direct
    // user gesture using the URL retained in pendingUrls.
    const opened = window.open("", "_blank");
    if (!opened) {
      setError({ key: "connectors.popupBlockedContinue" });
      return;
    }
    // Open a same-origin blank page first so the OAuth origin never receives
    // an opener reference, while a real null remains a reliable blocked signal.
    opened.opener = null;
    opened.location.replace(url);
  };

  const startPolling = (slug: string) => {
    const old = pollTimers.current.get(slug);
    if (old) clearInterval(old);
    let tries = 0;
    const timer = setInterval(() => {
      void refreshStatus([slug]).then((services) => {
        const state = services[slug];
        if (++tries >= 24 || (state?.connected && !state.pending) || (state?.status && /^(expired|failed)$/i.test(state.status))) {
          clearInterval(timer);
          pollTimers.current.delete(slug);
        }
      });
    }, 5000);
    pollTimers.current.set(slug, timer);
  };

  const connect = async (slug: string, alias?: string) => {
    statusGenerations.current.set(slug, (statusGenerations.current.get(slug) ?? 0) + 1);
    setBusySlug(slug);
    setError(null);
    try {
      const request: RequestInit = { method: "POST" };
      if (alias) request.body = JSON.stringify({ alias });
      const { url } = await api(`/api/connectors/${slug}/authorize`, request);
      setPendingUrls((current) => ({ ...current, [slug]: url }));
      setStatus((current) => ({
        ...current,
        [slug]: {
          ...current[slug],
          connected: current[slug]?.connected ?? false,
          pending: true,
          status: "INITIATED",
        },
      }));
      setAliasSlug(null);
      setAliasDraft("");
      startPolling(slug);
      await openConnectUrl(url);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (requiresAccountAlias(message)) {
        // Recover gracefully if an existing account was discovered after the
        // button rendered. Show the label field and refresh only this app.
        setAliasSlug(slug);
        setAliasDraft("");
        setError({ key: "connectors.aliasNeeded" });
        void refreshStatus([slug]);
      } else {
        setError(message);
      }
    } finally {
      setBusySlug(null);
    }
  };

  const disconnectAccount = (slug: string, accountId: string) => {
    setBusySlug(slug);
    api(`/api/connectors/${slug}/accounts/${encodeURIComponent(accountId)}`, { method: "DELETE" })
      .then(() => refreshStatus([slug]))
      .catch((e) => setError(e.message))
      .finally(() => setBusySlug(null));
  };

  const resolveFor = (card: ToolkitCard): AppResolved =>
    resolveApp(card, status[card.slug], {
      busy: busySlug === card.slug,
      unavailableReason: managedConnectorUnavailableReason(mode, card.slug)
        ? t("connectors.selfHostOnlyReason")
        : null,
      pendingUrl: pendingUrls[card.slug],
    });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (cards ?? [])
      .filter((card) => !needle || `${card.label} ${card.slug} ${card.blurb}`.toLowerCase().includes(needle))
      .filter((card) =>
        tab === "marketplace" || status[card.slug]?.connected || Boolean(status[card.slug]?.accounts?.length))
      .map(resolveFor);
    // resolveFor reads the live inventory, so the list is rebuilt whenever any
    // of it changes and the rail row can never hold a stale answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, search, tab, status, busySlug, mode, pendingUrls]);
  const connectedCount = Object.values(status).filter((service) => service.connected || service.accounts?.length).length;
  const connectedEmptyCopy = connectedInventoryCopy(inventoryPhase);
  const close = () => dispatch({ type: "togglePlugins", open: false });
  // Only worth saying once an app is actually connected and reachable.
  const botsWithoutApps = hasUsableConnectedApps(configured, inventoryPhase, stale, status)
    ? botsMissingConnectedApps(state.bots, state.instances)
    : [];
  // The card follows the rail. A selection the current filter cannot show is
  // not a dead card; it falls to the top of what is actually listed.
  const selected = visible.find((app) => app.card.slug === selectedSlug) ?? visible[0] ?? null;

  const primaryAction = (app: AppResolved) => {
    if (app.unavailableReason) return t("connectors.selfHostOnly");
    if (app.busy) return null;
    return connectorActionLabel(inventoryPhase, {
      busy: app.busy,
      included: app.included,
      canContinue: app.canContinue,
      pending: app.pending,
      hasAccounts: app.accounts.length > 0,
      failed: app.failed,
    });
  };

  const runPrimaryAction = (app: AppResolved) => {
    if (app.pending) {
      if (pendingUrls[app.card.slug]) {
        setError(null);
        void openConnectUrl(pendingUrls[app.card.slug]).catch((e) => setError(e.message));
      } else {
        setAliasSlug(null);
        setError(null);
        void refreshStatus([app.card.slug]);
        startPolling(app.card.slug);
      }
      return;
    }
    setAliasSlug((current) => (current === app.card.slug ? null : app.card.slug));
    setAliasDraft("");
  };

  return (
    <div
      ref={pageRef}
      data-tour="apps-panel"
      role="dialog"
      aria-labelledby="plugins-title"
      tabIndex={-1}
      className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
    >
      {/* The header is the mockup's header, standing on the sky: breadcrumb,
          title, one line of why, then the two controls. */}
      <header className="flex items-start justify-between gap-4 px-5 pt-4 sm:px-8 sm:pt-6">
        <div className="min-w-0">
          <div className="text-[12px] text-ink-secondary">
            {t("connectors.crumbTools")} <span aria-hidden="true">/</span>{" "}
            <span className="text-ink">{t("connectors.crumbApps")}</span>
          </div>
          <h1 id="plugins-title" className="mt-1.5 text-[26px] font-semibold tracking-[-0.02em] text-ink">
            {t("connectors.heading")}
          </h1>
          <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-ink-secondary">{t("connectors.subtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {surface === "apps" && (
            <button
              onClick={() => void loadConnectionInventory(true)}
              disabled={refreshing}
              className="rounded-lg p-2 text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink disabled:opacity-50"
              title={t("connectors.refreshTitle")}
              aria-label={t("connectors.refreshTitle")}
            >
              <RefreshCw size={17} className={cn(refreshing && "animate-spin")} />
            </button>
          )}
          <button
            data-tour="apps-close"
            onClick={close}
            aria-label={t("connectors.closeAria")}
            className="rounded-lg p-2 text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink"
          >
            <X size={19} />
          </button>
        </div>
      </header>

      {/* Apps ⇄ MCP. One pill, and the only always-present control here. */}
      <div className="mt-4 shrink-0 px-5 sm:px-8">
        <div
          className="glass-panel flex w-fit items-center gap-0.5 rounded-full p-1"
          role="tablist"
          aria-label={t("connectors.typeAria")}
        >
          {(["apps", "mcp"] as const).map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={surface === item}
              onClick={() => dispatch({ type: "togglePlugins", open: true, surface: item })}
              className={cn(
                "rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors motion-reduce:transition-none",
                surface === item
                  ? "bg-accent text-[var(--color-accent-ink)]"
                  : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
              )}
            >
              {item === "apps" ? t("connectors.tab.apps") : t("connectors.tab.mcp")}
            </button>
          ))}
        </div>
      </div>

      {surface === "apps" ? (
        <div className="mt-5 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pb-8 sm:px-8 lg:flex-row lg:gap-8 lg:overflow-hidden">
          {/* The rail. Search, the two views, and the apps themselves — all of
              it directly on the canvas, no plate, no shadow. */}
          <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[290px] lg:overflow-y-auto lg:pe-2">
            <div className="flex w-fit items-center gap-0.5 rounded-full p-1 glass-panel" role="tablist" aria-label={t("connectors.viewAria")}>
              <button
                role="tab"
                aria-selected={tab === "marketplace"}
                onClick={() => setTab("marketplace")}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors motion-reduce:transition-none",
                  tab === "marketplace"
                    ? "bg-accent text-[var(--color-accent-ink)]"
                    : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                )}
              >
                {t("connectors.tab.marketplace")}
              </button>
              <button
                role="tab"
                aria-selected={tab === "connected"}
                onClick={() => setTab("connected")}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors motion-reduce:transition-none",
                  tab === "connected"
                    ? "bg-accent text-[var(--color-accent-ink)]"
                    : "text-ink-secondary hover:bg-raised/60 hover:text-ink",
                )}
              >
                {t("connectors.tab.connected")}{connectedCount > 0 ? ` ${connectedCount}` : ""}
              </button>
            </div>

            <label className="flex h-10 items-center gap-2.5 rounded-xl border border-hairline/40 px-3 transition-colors focus-within:border-focus">
              <Search size={16} className="shrink-0 text-ink-secondary" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("connectors.searchPlaceholder")}
                aria-label={t("connectors.searchPlaceholder")}
                className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
              />
            </label>

            {stale && (
              // Say which of the two things is true. Silence here is what makes a
              // remembered list indistinguishable from a confirmed one.
              <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-[12px] text-warning">
                <TriangleAlert size={14} className="mt-px shrink-0" />
                <span>{t("connectors.stale")}</span>
              </div>
            )}
            {!configured && !stale && (
              <div className="rounded-xl border border-warning/30 bg-warning/10 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-warning">
                {t("connectors.notConfigured")}{" "}
                <button
                  className={cn("font-medium underline underline-offset-2", remoteClient && "hidden")}
                  onClick={() => {
                    close();
                    dispatch({ type: "toggleAppSettings", open: true });
                  }}
                >
                  {t("connectors.openSettings")}
                </button>
              </div>
            )}
            {botsWithoutApps.length > 0 && (
              /* The allowance is workspace-wide, not per app, so it stays one
                 notice above the list. The mockup draws per-app assigned-bot
                 chips; the store has no per-app assignment to draw. */
              <div className="rounded-xl border border-hairline/40 bg-raised/40 px-3.5 py-3 text-[12px] leading-relaxed text-ink-secondary">
                <span className="font-medium text-ink">{t("connectors.perBot.title")}</span>{" "}
                {t("connectors.perBot.body")}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {botsWithoutApps.map((candidate) => (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => dispatch({ type: "updateBot", botId: candidate.id, patch: { composio: true } })}
                      className="rounded-full bg-control px-2.5 py-1 text-[11.5px] font-medium text-ink transition-colors hover:bg-raised-hover"
                    >
                      {t("connectors.perBot.allow", { name: candidate.name })}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {configured && !remoteClient && source === "curated" && mode === "self-hosted" && (
              <div className="text-[11.5px] leading-relaxed text-ink-secondary">
                {t("connectors.featuredBefore")}{" "}
                <button
                  className="underline underline-offset-2 hover:text-ink"
                  onClick={() => {
                    close();
                    dispatch({ type: "toggleAppSettings", open: true });
                  }}
                >
                  {t("connectors.updateKey")}
                </button>{" "}
                {t("connectors.featuredAfter")}
              </div>
            )}
            {error && (
              <div role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-[12px] text-danger">
                {typeof error === "string" ? error : t(error.key)}
              </div>
            )}

            {cards === null ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[12.5px] text-ink-secondary">
                <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
              </div>
            ) : (
              <nav className="space-y-0.5" aria-label={t("connectors.section.available")}>
                <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                  {tab === "connected"
                    ? t("connectors.section.yours")
                    : search
                      ? t("connectors.section.results")
                      : t("connectors.section.available")}
                </div>
                {visible.map((app) => {
                  const isSelected = selected?.card.slug === app.card.slug;
                  return (
                    <button
                      key={app.card.slug}
                      type="button"
                      aria-current={isSelected ? "true" : undefined}
                      onClick={() => setSelectedSlug(app.card.slug)}
                      title={app.unavailableReason ?? undefined}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors motion-reduce:transition-none",
                        isSelected ? "bg-accent/10 ring-1 ring-accent/25" : "hover:bg-raised/50",
                      )}
                    >
                      <ServiceIcon card={app.card} className="size-9" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{app.card.label}</span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-secondary">
                          {appLineText(appRailSubtitle(app))}
                        </span>
                      </span>
                      <ChevronRight
                        size={15}
                        aria-hidden="true"
                        className={cn("shrink-0", isSelected ? "text-accent" : "text-ink-secondary/50")}
                      />
                    </button>
                  );
                })}
                {visible.length === 0 && (
                  <div className="px-2 py-10 text-center">
                    <div className="text-[13px] font-medium text-ink">
                      {tab === "connected" ? connectedEmptyCopy.title : t("connectors.noAppsFound")}
                    </div>
                    <div className="mt-1 text-[12px] leading-relaxed text-ink-secondary">
                      {tab === "connected" ? connectedEmptyCopy.description : t("connectors.tryDifferentSearch")}
                    </div>
                    {tab === "connected" && inventoryPhase === "error" && (
                      <button
                        type="button"
                        disabled={refreshing}
                        onClick={() => void loadConnectionInventory(true)}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-raised px-3 py-1.5 text-[12px] text-ink transition-colors hover:bg-raised-hover disabled:opacity-50"
                      >
                        <RefreshCw size={13} className={cn(refreshing && "animate-spin")} />
                        {t("connectors.action.retry")}
                      </button>
                    )}
                  </div>
                )}
              </nav>
            )}
          </aside>

          {/* The one glass surface on this page: the selected app. */}
          <section className="min-w-0 flex-1 pb-6">
            {selected ? (
              <GlassCard className="flex flex-col gap-5 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <ServiceIcon card={selected.card} className="size-12" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
                          {selected.card.label}
                        </h2>
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium",
                            TONE_CHIP[appDetailStatus(selected).tone],
                          )}
                        >
                          {selected.included || selected.accounts.length > 0 ? (
                            <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                          ) : null}
                          {t(appDetailStatus(selected).labelKey)}
                        </span>
                      </div>
                      <p className="mt-1 max-w-[440px] text-[12.5px] leading-relaxed text-ink-secondary">
                        {selected.card.blurb}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {selected.canContinue && (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          void openConnectUrl(pendingUrls[selected.card.slug]).catch((e) => setError(e.message));
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full border border-hairline/40 px-3 py-1.5 text-[12px] text-ink transition-colors hover:bg-raised/60"
                      >
                        <ExternalLink size={13} aria-hidden="true" />
                        {t("connectors.detail.continueSignIn")}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={
                        !configured ||
                        inventoryPhase !== "ready" ||
                        selected.busy ||
                        selected.included ||
                        Boolean(selected.unavailableReason)
                      }
                      title={selected.unavailableReason ?? undefined}
                      onClick={() => runPrimaryAction(selected)}
                      className="inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[12.5px] font-medium text-[var(--color-accent-ink)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {selected.busy ? (
                        <Loader2 size={13} className="mx-auto animate-spin" />
                      ) : (
                        primaryAction(selected)
                      )}
                    </button>
                  </div>
                </div>

                {(selected.accounts.length > 0 || selected.included) && (
                  <div className="border-t border-hairline/35 pt-4">
                    <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">
                      {t("connectors.detail.accounts")}
                    </div>
                    <div className="mt-2.5 space-y-1.5">
                      {selected.accounts.map((account) => {
                        const active = /^active$/i.test(account.status);
                        return (
                          <div
                            key={account.id}
                            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-raised/40"
                          >
                            <div
                              aria-hidden="true"
                              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/12 text-[11px] font-semibold text-accent"
                            >
                              {(account.alias || account.id).slice(0, 1).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
                                {active && <Check size={13} className="shrink-0 text-success" aria-hidden="true" />}
                                <span className="truncate">{account.alias || account.id}</span>
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-ink-secondary">
                                {account.alias ? `${account.id} · ` : ""}{account.status.toLowerCase()}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={selected.busy}
                              onClick={() => {
                                if (!window.confirm(disconnectAccountConfirmation(selected.card.label, account))) return;
                                disconnectAccount(selected.card.slug, account.id);
                              }}
                              className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] text-ink-secondary transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-40"
                              aria-label={t("connectors.disconnectAria", {
                                account: account.alias || account.id,
                                service: selected.card.label,
                              })}
                            >
                              {t("connectors.disconnect")}
                            </button>
                          </div>
                        );
                      })}
                      {selected.accounts.length === 0 && (
                        <p className="px-2.5 text-[12px] leading-relaxed text-ink-secondary">
                          {t("connectors.detail.noAccounts")}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {(selected.accounts.length > 0 || selected.pending) && !selected.pending && (
                  /* Add account is the same action as the button above, with a
                     label to go with it; the alias form is what that action
                     asks for when the provider needs a name. */
                  <div className="border-t border-hairline/35 pt-4">
                    {aliasSlug === selected.card.slug ? (
                      <form
                        className="flex flex-wrap items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const alias = aliasDraft.trim();
                          if (!alias) {
                            setError({ key: "connectors.aliasRequired" });
                            return;
                          }
                          void connect(selected.card.slug, alias);
                        }}
                      >
                        <input
                          autoFocus
                          value={aliasDraft}
                          maxLength={64}
                          onChange={(event) => setAliasDraft(event.target.value)}
                          placeholder={t("connectors.aliasPlaceholder")}
                          aria-label={selected.accounts.length > 0
                            ? t("connectors.aliasAriaAnother", { service: selected.card.label })
                            : t("connectors.aliasAriaNew", { service: selected.card.label })}
                          className="min-w-0 flex-1 rounded-xl border border-hairline/40 bg-transparent px-3 py-2 text-[12.5px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={selected.busy || !aliasDraft.trim()}
                          className="rounded-full bg-accent px-3.5 py-2 text-[12px] font-medium text-[var(--color-accent-ink)] disabled:opacity-40"
                        >
                          {t("connectors.action.continue")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAliasSlug(null);
                            setAliasDraft("");
                          }}
                          className="rounded-full px-3 py-2 text-[12px] text-ink-secondary transition-colors hover:text-ink"
                        >
                          {t("common.cancel")}
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => runPrimaryAction(selected)}
                        className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-raised/40"
                      >
                        <span
                          aria-hidden="true"
                          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-hairline/60 text-ink-secondary"
                        >
                          <Plus size={14} />
                        </span>
                        <span>
                          <span className="block text-[12.5px] font-medium text-ink">{t("connectors.detail.addAccount")}</span>
                          <span className="mt-0.5 block text-[11.5px] text-ink-secondary">
                            {t("connectors.detail.addAccountHint", { service: selected.card.label })}
                          </span>
                        </span>
                      </button>
                    )}
                  </div>
                )}

                {configured && !remoteClient && (
                  <div className="border-t border-hairline/35 pt-4 text-[11.5px] leading-relaxed text-ink-secondary">
                    {t("connectors.managedByComposio")}
                  </div>
                )}
              </GlassCard>
            ) : (
              <div className="flex h-full min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-hairline/50 px-6 text-center">
                <div className="text-[14px] font-medium text-ink">{t("connectors.detail.pickOne")}</div>
                <p className="mt-1 max-w-[360px] text-[12.5px] leading-relaxed text-ink-secondary">
                  {t("connectors.detail.pickOneBody")}
                </p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <McpServersPanel />
      )}
    </div>
  );
}
