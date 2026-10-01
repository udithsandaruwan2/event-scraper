import type { Condition, SaleState, SpotEvent } from "@shared/types";

export const FILTERS: { id: Condition | "all"; label: string; hint: string }[] = [
  { id: "all", label: "All events", hint: "Everything returned on this run" },
  { id: "tickets_live", label: "Tickets live", hint: "On sale, presale, or sold out" },
  { id: "newly_released", label: "Newly released", hint: "Latest listings, presales, announcements" },
  { id: "live_and_new", label: "New + tickets", hint: "A new listing whose tickets are out" },
  { id: "coming_soon", label: "Coming soon", hint: "Save the date or coming soon" },
  { id: "pending", label: "Pending", hint: "Held, waitlist, or still unreleased" },
];

export const SALE_LABEL: Record<SaleState, string> = {
  open: "Tickets open",
  limited: "Selling fast",
  sold_out: "Sold out",
  presale: "Presale",
  pending: "Pending",
  unknown: "Listing only",
};

export function formatWhen(start?: string): string {
  if (!start) return "Date to be announced";
  const hasTime = /[T ]\d{2}:\d{2}/.test(start);
  let iso = start.trim();
  if (iso.includes(" ") && !iso.includes("T")) iso = iso.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso = `${iso}T00:00:00+05:30`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(iso)) iso = `${iso}:00+05:30`;
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(iso)) iso = `${iso}+05:30`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return start;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(hasTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

export function posterParts(start?: string): { month: string; day: string } {
  if (!start || !/^\d{4}-\d{2}-\d{2}/.test(start)) return { month: "TBA", day: "—" };
  const date = new Date(`${start.slice(0, 10)}T00:00:00+05:30`);
  if (Number.isNaN(date.getTime())) return { month: "TBA", day: "—" };
  const month = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", month: "short" }).format(date).toUpperCase();
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Colombo", day: "2-digit" }).format(date);
  return { month, day };
}

export function formatFetched(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Colombo",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function named(value?: string): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (!text || /^(null|undefined|n\/a)$/i.test(text)) return undefined;
  return text;
}

export function placeLine(event: SpotEvent): string {
  const city = named(event.city);
  const district = named(event.district);
  const area = city && district && city.toLowerCase() !== district.toLowerCase() ? `${city}, ${district}` : city || district || "";
  const venue = named(event.venue) ?? "";
  if (!venue) return area;
  if (!area) return venue;
  const venueKey = venue.toLowerCase();
  const areaKey = area.toLowerCase();
  if (areaKey.includes(venueKey) || venueKey.includes(areaKey)) {
    return venue.length >= area.length ? venue : area;
  }
  return `${venue} · ${area}`;
}

export function matchesQuery(event: SpotEvent, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    event.title,
    event.preview,
    event.city,
    event.district,
    event.venue,
    event.category,
    event.organizer,
    event.platform,
    event.sale,
    ...event.signals,
    ...event.genres,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function downloadCsv(events: SpotEvent[], fetchedAt: string): void {
  const headers = [
    "Fetched",
    "Title",
    "When",
    "City",
    "Venue",
    "Category",
    "Condition",
    "Priority",
    "Action",
    "Availability",
    "Price",
    "Platform",
    "Signals",
    "Link",
  ];
  const rows = events.map((event) =>
    [
      fetchedAt,
      event.title,
      event.start ?? "",
      event.city ?? "",
      event.venue ?? "",
      event.category ?? "",
      event.primary,
      event.priority,
      event.action,
      event.sale,
      event.priceLabel ?? "",
      event.platform,
      event.signals.join("; "),
      event.link,
    ]
      .map((value) => csvCell(String(value)))
      .join(","),
  );
  const blob = new Blob([`\uFEFF${headers.join(",")}\n${rows.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const stamp = fetchedAt.slice(0, 16).replace(/[-:T]/g, "");
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `TicketSpot_LiveSales_${stamp}.csv`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}
