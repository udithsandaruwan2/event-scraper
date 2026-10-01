import { useEffect, useMemo, useState } from "react";
import {
  COMING_KEYWORDS,
  NEW_KEYWORDS,
  PENDING_KEYWORDS,
  TICKET_KEYWORDS,
} from "@shared/keywords";
import type { Condition, EventsResponse, SpotEvent } from "@shared/types";
import { FILTERS, SALE_LABEL, downloadCsv, formatFetched, formatWhen, matchesQuery, placeLine, posterParts } from "./format";

type StatusFilter = Condition | "all";

export function App() {
  const [payload, setPayload] = useState<EventsResponse | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("all");
  const [category, setCategory] = useState("all");
  const [platform, setPlatform] = useState("all");

  useEffect(() => {
    const controller = new AbortController();
    const firstLoad = reloadKey === 0;
    if (!firstLoad) setRefreshing(true);
    const fresh = reloadKey > 0 ? "?fresh=1" : "";
    fetch(`/api/events${fresh}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`The event feed returned ${response.status}`);
        return (await response.json()) as EventsResponse;
      })
      .then((data) => {
        setPayload(data);
        setPhase("ready");
        setError("");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Could not load events");
        setPhase((current) => (current === "ready" ? "ready" : "error"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  const events = payload?.events ?? [];
  const cities = useMemo(() => options(events, (event) => event.city), [events]);
  const categories = useMemo(() => options(events, (event) => event.category), [events]);
  const platforms = useMemo(() => options(events, (event) => event.platform), [events]);

  const scoped = events.filter((event) => {
    if (city !== "all" && event.city !== city) return false;
    if (category !== "all" && event.category !== category) return false;
    if (platform !== "all" && event.platform !== platform) return false;
    return matchesQuery(event, query);
  });
  const visible = scoped.filter((event) => status === "all" || event.conditions.includes(status));
  const counts = countConditions(scoped);

  return (
    <div className="page">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            TS
          </span>
          <div>
            <p className="eyebrow">Sri Lanka · live listings</p>
            <h1>TicketSpot</h1>
          </div>
        </div>
        <div className="top-actions">
          <p className="fetched">
            {payload ? `Updated ${formatFetched(payload.fetchedAt)}` : "Looking up listings"}
            {payload?.cached ? " · cached" : ""}
          </p>
          <button type="button" className="button ghost" onClick={() => downloadCsv(visible, payload?.fetchedAt ?? "")} disabled={!visible.length}>
            Export
          </button>
          <button type="button" className="button solid" onClick={() => setReloadKey((value) => value + 1)} disabled={phase === "loading" || refreshing}>
            {phase === "loading" || refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <p className="lede">
        New runs pull ticket listings that are on sale, just added, still pending, or only a save-the-date. Open a card to check the seller’s page before you buy.
      </p>

      {payload?.warnings.length ? (
        <div className="notice" role="status">
          {payload.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="notice notice-error" role="alert">
          <p>{error}</p>
        </div>
      ) : null}

      <div className="layout">
        <aside className="panel">
          <label className="search">
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Title, venue, EDM, Colombo"
            />
          </label>

          <div className="stat-list" role="group" aria-label="Event status">
            {FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className="stat"
                aria-pressed={status === filter.id}
                onClick={() => setStatus(filter.id)}
              >
                <span>
                  <strong>{filter.label}</strong>
                  <small>{filter.hint}</small>
                </span>
                <b>{filter.id === "all" ? scoped.length : counts[filter.id]}</b>
              </button>
            ))}
          </div>

          <Select label="City" value={city} onChange={setCity} options={cities} />
          <Select label="Category" value={category} onChange={setCategory} options={categories} />
          <Select label="Source" value={platform} onChange={setPlatform} options={platforms} />

          <details className="rules">
            <summary>How a listing is sorted</summary>
            <Rule title="Tickets live" words={TICKET_KEYWORDS} />
            <Rule title="Newly released" words={["latest 10 marketplace listings", "presale", ...NEW_KEYWORDS]} />
            <Rule title="Coming soon" words={COMING_KEYWORDS} />
            <Rule title="Pending" words={["seller status: pending", ...PENDING_KEYWORDS]} />
            <p>
              New + tickets is a listing that is both new and already on sale. A pending event stays in Pending even if a draft price is attached.
            </p>
          </details>
        </aside>

        <section className="results" aria-live="polite">
          <div className="results-bar">
            <h2>{visible.length === 1 ? "1 event" : `${visible.length} events`}</h2>
            <div className="sources">
              {(payload?.sources ?? []).map((source) => (
                <span key={source.id} className={source.ok ? "source ok" : "source"} title={source.note}>
                  {source.label}
                  <b>{source.count}</b>
                </span>
              ))}
            </div>
          </div>

          {phase === "loading" && !payload ? (
            <div className="stack">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="card skeleton" />
              ))}
            </div>
          ) : null}

          {phase !== "loading" && !visible.length ? (
            <div className="empty">
              <h3>Nothing in this view</h3>
              <p>Clear a filter or refresh. Ticket pages change through the day, and social search often stays quiet when the search engine blocks it.</p>
            </div>
          ) : null}

          <div className="stack">
            {visible.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function EventCard({ event }: { event: SpotEvent }) {
  const poster = posterParts(event.start);
  return (
    <article className={`card tone-${event.primary}`}>
      <Poster event={event} month={poster.month} day={poster.day} />
      <div className="card-body">
        <div className="card-topline">
          <span className={`pill tone-${event.primary}`}>{labelFor(event.primary)}</span>
          <span className="platform">{event.platform}</span>
          <span className={`sale sale-${event.sale}`}>{SALE_LABEL[event.sale]}</span>
        </div>
        <h3>{event.title}</h3>
        <p className="meta">
          <span>{formatWhen(event.start)}</span>
          {placeLine(event) ? <span>{placeLine(event)}</span> : null}
        </p>
        {event.preview ? <p className="preview">{event.preview}</p> : null}
        <div className="chips">
          {event.category ? <span>{event.category}</span> : null}
          {event.priceLabel ? <span>{event.priceLabel}</span> : null}
          {event.organizer ? <span>{event.organizer}</span> : null}
          {event.genres.map((genre) => (
            <span key={genre}>{genre}</span>
          ))}
          {event.signals.slice(0, 4).map((signal) => (
            <span key={signal} className="signal">
              {signal}
            </span>
          ))}
        </div>
        <div className="card-foot">
          <span className={event.priority === "High" ? "priority high" : "priority"}>
            {event.priority} · {event.action}
          </span>
          <a href={event.link} target="_blank" rel="noreferrer">
            Open listing
          </a>
        </div>
      </div>
    </article>
  );
}

function Poster({ event, month, day }: { event: SpotEvent; month: string; day: string }) {
  const [failed, setFailed] = useState(false);
  if (event.image && !failed) {
    return (
      <div className="poster">
        <img src={event.image} alt="" onError={() => setFailed(true)} />
        <span>
          {day} {month}
        </span>
      </div>
    );
  }
  return (
    <div className="poster poster-fallback" aria-hidden="true">
      <span className="poster-month">{month}</span>
      <span className="poster-day">{day}</span>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="select">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="all">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Rule({ title, words }: { title: string; words: string[] }) {
  return (
    <p>
      <strong>{title}.</strong> {words.slice(0, 8).join(", ")}
      {words.length > 8 ? "…" : ""}
    </p>
  );
}

function labelFor(condition: SpotEvent["primary"]): string {
  if (condition === "listed") return "Listed";
  return FILTERS.find((filter) => filter.id === condition)?.label ?? condition;
}

function options(events: SpotEvent[], pick: (event: SpotEvent) => string | undefined): string[] {
  return [
    ...new Set(
      events
        .map(pick)
        .map((value) => value?.trim())
        .filter((value): value is string => typeof value === "string" && !/^(null|undefined|n\/a)$/i.test(value)),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

function countConditions(events: SpotEvent[]): Record<Condition, number> {
  const counts: Record<Condition, number> = {
    tickets_live: 0,
    newly_released: 0,
    live_and_new: 0,
    coming_soon: 0,
    pending: 0,
  };
  for (const event of events) {
    for (const condition of event.conditions) counts[condition] += 1;
  }
  return counts;
}
