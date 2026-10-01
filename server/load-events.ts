import { classifyListing, hasSriLankaContext } from "../shared/classify.ts";
import type { EventsResponse, SaleState, SourceReport, SpotEvent } from "../shared/types.ts";
import { colomboToday, decodeHtml, hashId, isUpcoming, plainText, previewText, slugify } from "../shared/text.ts";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MINISTRY_API = "https://api.ticketsministry.com/api/events";
const MINISTRY_PAGES = [
  "https://www.ticketsministry.com/concerts",
  "https://www.ticketsministry.com/theatre",
  "https://www.ticketsministry.com/family",
  "https://www.ticketsministry.com/sports",
  "https://www.ticketsministry.com/other",
];
const EVENTBRITE_URL = "https://www.eventbrite.com/d/sri-lanka--colombo/all-events/";
const SOCIAL_QUERIES = [
  'site:facebook.com "book now" OR "tickets now" colombo concert',
  'site:instagram.com "sri lanka" concert "on sale" OR "coming soon"',
  '"save the date" OR "just announced" concert colombo OR kandy OR galle',
];

const NEW_LISTING_COUNT = 10;
const CACHE_MS = 3 * 60 * 1000;

type CacheEntry = { at: number; body: EventsResponse };
let cache: CacheEntry | null = null;

type Package = { price?: string | number; sold_out?: boolean; active?: boolean };
type MinistryEvent = {
  id: number;
  uid: string;
  name: string;
  description?: unknown;
  type?: string;
  sub_type?: string;
  status?: string;
  start_date?: string;
  end_date?: string;
  thumbnail_img?: string;
  venue?: { name?: string; city?: string; district?: string };
  manager?: { name?: string };
  ticket_packages?: Package[];
  currency?: string;
};

export async function loadEvents(fresh = false): Promise<EventsResponse> {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) {
    return { ...cache.body, cached: true };
  }
  const today = colomboToday();
  const [ministry, eventbrite, social] = await Promise.all([
    loadMinistry(today),
    loadEventbrite(today),
    loadSocial(),
  ]);

  const events = dedupe([...ministry.events, ...eventbrite.events, ...social.events]);
  events.sort((a, b) => (a.start ?? "9999").localeCompare(b.start ?? "9999") || a.title.localeCompare(b.title));

  const body: EventsResponse = {
    fetchedAt: new Date().toISOString(),
    cached: false,
    warnings: [...ministry.warnings, ...eventbrite.warnings, ...social.warnings],
    sources: [ministry.source, eventbrite.source, social.source],
    events,
  };
  cache = { at: Date.now(), body };
  return body;
}

async function loadMinistry(today: string): Promise<Bucket> {
  try {
    const [payload, links] = await Promise.all([getJson(MINISTRY_API, 12000), ministryLinks()]);
    const rows = Array.isArray(payload.data) ? (payload.data as MinistryEvent[]) : [];
    const upcoming = rows.filter((row) => isUpcoming(row.start_date, row.end_date, today));
    const newest = new Set(
      [...upcoming].sort((a, b) => b.id - a.id).slice(0, NEW_LISTING_COUNT).map((row) => row.id),
    );
    const events = upcoming.map((row) => toMinistryEvent(row, newest.has(row.id), links));
    return {
      events,
      warnings: [],
      source: {
        id: "ticketsministry",
        label: "TicketsMinistry",
        ok: true,
        count: events.length,
        note: "Live ticket status from the public events API",
      },
    };
  } catch (error) {
    return emptyBucket("ticketsministry", "TicketsMinistry", `Ticket feed failed: ${shortError(error)}`);
  }
}

function toMinistryEvent(row: MinistryEvent, newlyListed: boolean, links: Map<string, string>): SpotEvent {
  const packages = Array.isArray(row.ticket_packages) ? row.ticket_packages : [];
  const sale = saleOf(row.status ?? "", packages);
  const description = plainText(row.description);
  const venue = clean(row.venue?.name);
  const city = clean(row.venue?.city);
  const district = clean(row.venue?.district);
  const category = categoryLabel(row.type);
  const text = [description, row.sub_type, venue, city, district, category].filter(Boolean).join(" ");
  const classified = classifyListing({
    title: row.name,
    text,
    sale,
    newlyListed,
    publishedListing: true,
  });
  const fallback = classified ?? {
    conditions: ["newly_released" as const],
    primary: "newly_released" as const,
    signals: [],
    genres: [],
    priority: "Medium" as const,
    action: "MONITOR",
  };
  const link =
    links.get(row.uid) ??
    `https://www.ticketsministry.com/${row.type || "concerts"}/${slugify(row.name)}/${row.uid}`;
  return {
    id: `tm-${row.id}`,
    title: clean(row.name) || "Untitled event",
    preview: previewText(description || [row.sub_type, venue, city].filter(Boolean).join(" · ")),
    link,
    image: https(row.thumbnail_img),
    platform: "TicketsMinistry",
    source: "TicketsMinistry",
    ...fallback,
    sale,
    start: clean(row.start_date),
    end: clean(row.end_date),
    venue,
    city,
    district,
    category,
    priceLabel: priceLabel(packages, row.currency || "LKR"),
    organizer: clean(row.manager?.name),
  };
}

async function ministryLinks(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    MINISTRY_PAGES.map(async (page) => {
      try {
        const html = await getText(page, 8000);
        const re = /\/(concerts|theatre|family|sports|other)\/([a-z0-9-]+)\/([A-Za-z0-9-]{6,})/g;
        for (const match of html.matchAll(re)) {
          const uid = match[3];
          if (!map.has(uid)) map.set(uid, `https://www.ticketsministry.com/${match[1]}/${match[2]}/${uid}`);
        }
      } catch {
        // A missing category page should not blank the feed.
      }
    }),
  );
  return map;
}

async function loadEventbrite(today: string): Promise<Bucket> {
  try {
    const html = await getText(EVENTBRITE_URL, 12000);
    const events = parseEventbrite(html, today);
    return {
      events,
      warnings: [],
      source: {
        id: "eventbrite",
        label: "Eventbrite Colombo",
        ok: true,
        count: events.length,
        note: "Public Colombo listings. Ticket inventory is not included.",
      },
    };
  } catch (error) {
    return emptyBucket("eventbrite", "Eventbrite Colombo", `Eventbrite failed: ${shortError(error)}`);
  }
}

function parseEventbrite(html: string, today: string): SpotEvent[] {
  const events: SpotEvent[] = [];
  const scripts = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const script of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(script[1]);
    } catch {
      continue;
    }
    const lists = Array.isArray(data) ? data : [data];
    for (const list of lists) {
      const items = (list as { itemListElement?: unknown }).itemListElement;
      if (!Array.isArray(items)) continue;
      for (const entry of items) {
        const item = (entry as { item?: Record<string, unknown> }).item;
        if (!item || item["@type"] !== "Event" || typeof item.name !== "string") continue;
        const event = toEventbriteEvent(item, today);
        if (event) events.push(event);
      }
    }
  }
  return events;
}

function toEventbriteEvent(item: Record<string, unknown>, today: string): SpotEvent | null {
  const start = typeof item.startDate === "string" ? item.startDate : undefined;
  const end = typeof item.endDate === "string" ? item.endDate : undefined;
  if (!isUpcoming(start, end, today)) return null;
  const location = item.location as { name?: string; address?: { addressLocality?: string; addressCountry?: string } } | undefined;
  const country = location?.address?.addressCountry;
  if (country && country !== "LK") return null;
  const title = decodeHtml(item.name as string);
  const description = decodeHtml(typeof item.description === "string" ? item.description : "");
  const city = clean(location?.address?.addressLocality);
  const venue = clean(location?.name);
  const classified = classifyListing({
    title,
    text: [description, venue, city].filter(Boolean).join(" "),
    sale: "unknown",
    newlyListed: false,
    publishedListing: true,
  });
  if (!classified) return null;
  const link = typeof item.url === "string" ? item.url : "";
  if (!link.startsWith("https://")) return null;
  return {
    id: `eb-${hashId(link)}`,
    title,
    preview: previewText(description || [venue, city].filter(Boolean).join(" · ")),
    link,
    image: imageUrl(item.image),
    platform: "Eventbrite",
    source: "Eventbrite",
    ...classified,
    sale: "unknown",
    start,
    end,
    venue,
    city,
    category: "Event",
  };
}

async function loadSocial(): Promise<Bucket> {
  const warnings: string[] = [];
  const events: SpotEvent[] = [];
  let blocked = 0;
  await Promise.all(
    SOCIAL_QUERIES.map(async (query) => {
      const result = await searchQuery(query);
      if (result.blocked) blocked += 1;
      events.push(...result.events);
    }),
  );
  if (!events.length) {
    warnings.push(
      "Facebook, Instagram, and TikTok posts did not come back on this run. Search engines often block automated lookups. Marketplace listings are still included.",
    );
  }
  return {
    events,
    warnings,
    source: {
      id: "social",
      label: "Facebook, Instagram, and the web",
      ok: events.length > 0,
      count: events.length,
      note:
        events.length > 0
          ? "Public search snippets. Open the link and confirm the post."
          : blocked
            ? "Search was blocked or returned unrelated results."
            : "No matching public posts.",
    },
  };
}

async function searchQuery(query: string): Promise<{ events: SpotEvent[]; blocked: boolean }> {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const html = await getText(ddgUrl, 8000);
    if (/anomaly\.js|cc=botnet/i.test(html)) return { events: [], blocked: true };
    const events = parseDuckDuckGo(html).filter((event) => relevantToQuery(event, query));
    if (events.length) return { events, blocked: false };
  } catch {
    // Fall through to Bing.
  }

  try {
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10&setlang=en-us`;
    const html = await getText(bingUrl, 8000, { Referer: "https://www.bing.com/" });
    const events = parseBing(html).filter((event) => relevantToQuery(event, query));
    if (!events.length) return { events: [], blocked: true };
    return { events, blocked: false };
  } catch {
    return { events: [], blocked: true };
  }
}

function parseDuckDuckGo(html: string): SpotEvent[] {
  const events: SpotEvent[] = [];
  const re =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]{0,1500}?)<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(re)) {
    const event = toSocialEvent(unwrapDuckLink(match[1]), decodeHtml(match[2]), decodeHtml(match[4]));
    if (event) events.push(event);
  }
  return events;
}

function parseBing(html: string): SpotEvent[] {
  const events: SpotEvent[] = [];
  for (const block of html.split('<li class="b_algo').slice(1)) {
    const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    const snippetMatch = block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i);
    if (!titleMatch) continue;
    const event = toSocialEvent(
      decodeHtml(titleMatch[1]),
      decodeHtml(titleMatch[2]),
      decodeHtml(snippetMatch?.[1] ?? ""),
    );
    if (event) events.push(event);
  }
  return events;
}

function toSocialEvent(link: string, title: string, snippet: string): SpotEvent | null {
  if (!link.startsWith("http")) return null;
  let host = "";
  try {
    host = new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (/(duckduckgo|bing|google)\./.test(host)) return null;
  const text = `${title} ${snippet}`;
  if (!hasSriLankaContext(text)) return null;
  const classified = classifyListing({
    title,
    text,
    sale: "unknown",
    newlyListed: false,
    publishedListing: false,
  });
  if (!classified) return null;
  return {
    id: `web-${hashId(link + title)}`,
    title: title || host,
    preview: previewText(snippet || title),
    link,
    platform: platformFromHost(host),
    source: "Web search",
    ...classified,
    sale: "unknown",
    category: "Social post",
  };
}

function relevantToQuery(event: SpotEvent, query: string): boolean {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3 && !["site", "book", "tickets", "save", "date", "just"].includes(token));
  const text = `${event.title} ${event.preview} ${event.link}`.toLowerCase();
  return tokens.some((token) => text.includes(token));
}

function unwrapDuckLink(href: string): string {
  const absolute = href.startsWith("//") ? `https:${href}` : href;
  try {
    const url = new URL(absolute, "https://duckduckgo.com");
    return url.searchParams.get("uddg") ?? absolute;
  } catch {
    return absolute;
  }
}

function platformFromHost(host: string): string {
  if (host.includes("facebook.com") || host.includes("fb.com")) return "Facebook";
  if (host.includes("instagram.com")) return "Instagram";
  if (host.includes("tiktok.com")) return "TikTok";
  if (host.includes("eventbrite.")) return "Eventbrite";
  if (host.includes("ticketsministry.com")) return "TicketsMinistry";
  return "Web";
}

function saleOf(status: string, packages: Package[]): SaleState {
  if (status === "pending") return "pending";
  if (status === "presale") return "presale";
  const active = packages.filter((item) => item.active !== false);
  const open = active.filter((item) => !item.sold_out);
  if (open.length === 0 && (active.length > 0 || status === "soldout")) return "sold_out";
  if (open.length > 0 && active.some((item) => item.sold_out)) return "limited";
  if (open.length > 0) return "open";
  return "unknown";
}

function priceLabel(packages: Package[], currency: string): string | undefined {
  const pool = packages.filter((item) => item.active !== false && !item.sold_out);
  const source = pool.length ? pool : packages;
  const amounts = source
    .map((item) => Number(item.price))
    .filter((amount) => Number.isFinite(amount) && amount >= 0);
  if (!amounts.length) return undefined;
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  const format = (amount: number) =>
    amount === 0 ? "Free" : `${currency} ${new Intl.NumberFormat("en-LK").format(amount)}`;
  if (min === max) return format(min);
  return `${format(min)} – ${format(max)}`;
}

function categoryLabel(type?: string): string {
  switch (type) {
    case "concerts":
      return "Concerts";
    case "theatre":
      return "Theatre";
    case "family":
      return "Family";
    case "sports":
      return "Sports";
    case "other":
      return "Other";
    default:
      return type ? type[0].toUpperCase() + type.slice(1) : "Event";
  }
}

function imageUrl(value: unknown): string | undefined {
  if (typeof value === "string") return https(value);
  if (value && typeof value === "object" && "url" in value) return https((value as { url?: unknown }).url);
  return undefined;
}

function https(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("https://") ? value : undefined;
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || /^(null|undefined|n\/a)$/i.test(text)) return undefined;
  return text;
}

function dedupe(events: SpotEvent[]): SpotEvent[] {
  const seen = new Set<string>();
  const result: SpotEvent[] = [];
  for (const event of events) {
    const key = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "")}|${(event.start ?? "").slice(0, 10)}|${(event.city ?? "").toLowerCase()}`;
    if (seen.has(key) || seen.has(event.link)) continue;
    seen.add(key);
    seen.add(event.link);
    result.push(event);
  }
  return result;
}

type Bucket = { events: SpotEvent[]; warnings: string[]; source: SourceReport };

function emptyBucket(id: string, label: string, warning: string): Bucket {
  return {
    events: [],
    warnings: [warning],
    source: { id, label, ok: false, count: 0, note: warning },
  };
}

async function getText(url: string, timeoutMs: number, extraHeaders: Record<string, string> = {}): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", Accept: "text/html", ...extraHeaders },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).hostname}`);
  return response.text();
}

async function getJson(url: string, timeoutMs: number): Promise<{ data?: unknown }> {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).hostname}`);
  return (await response.json()) as { data?: unknown };
}

function shortError(error: unknown): string {
  return (error instanceof Error ? error.message : "request failed").slice(0, 160);
}
