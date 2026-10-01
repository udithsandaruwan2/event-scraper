import {
  COMING_KEYWORDS,
  GENRE_KEYWORDS,
  NEW_KEYWORDS,
  PENDING_KEYWORDS,
  PLACE_KEYWORDS,
  TICKET_KEYWORDS,
} from "./keywords.ts";
import type { Badge, Condition, ListingInput } from "./types.ts";
import { includesTerm, matchedKeywords, unique } from "./text.ts";

export type Classified = {
  conditions: Condition[];
  primary: Badge;
  signals: string[];
  genres: string[];
  priority: "High" | "Medium";
  action: string;
};

export function hasSriLankaContext(text: string): boolean {
  return PLACE_KEYWORDS.some((term) => includesTerm(text, term));
}

export function classifyListing(input: ListingInput): Classified | null {
  const text = `${input.title}\n${input.text}`;
  const ticketHits = matchedKeywords(text, TICKET_KEYWORDS);
  const newHits = matchedKeywords(text, NEW_KEYWORDS);
  const comingHits = matchedKeywords(text, COMING_KEYWORDS);
  const pendingHits = matchedKeywords(text, PENDING_KEYWORDS);
  const genres = matchedKeywords(text, GENRE_KEYWORDS);

  const onSale = input.sale === "open" || input.sale === "limited" || input.sale === "sold_out";
  const presale = input.sale === "presale";
  const pending = input.sale === "pending" || (pendingHits.length > 0 && !onSale && !presale);
  const ticketsReleased = !pending && (onSale || presale || ticketHits.length > 0);
  const newly = input.newlyListed || presale || newHits.length > 0;
  const coming = comingHits.length > 0;

  const conditions: Condition[] = [];
  if (ticketsReleased) conditions.push("tickets_live");
  if (newly) conditions.push("newly_released");
  if (ticketsReleased && newly) conditions.push("live_and_new");
  if (pending) conditions.push("pending");
  if (coming) conditions.push("coming_soon");

  if (!conditions.length && !input.publishedListing) return null;

  let primary: Badge = "listed";
  if (conditions.includes("pending") && !ticketsReleased) primary = "pending";
  else if (conditions.includes("live_and_new")) primary = "live_and_new";
  else if (conditions.includes("tickets_live")) primary = "tickets_live";
  else if (conditions.includes("coming_soon")) primary = "coming_soon";
  else if (conditions.includes("newly_released")) primary = "newly_released";
  else if (conditions.includes("pending")) primary = "pending";

  const signals = unique([
    ...(presale ? ["presale"] : []),
    ...ticketHits,
    ...newHits,
    ...comingHits,
    ...pendingHits,
    ...(input.newlyListed ? ["latest listing"] : []),
    ...(input.sale === "sold_out" ? ["sold out"] : []),
  ]).slice(0, 8);

  const priority: Classified["priority"] =
    input.sale === "sold_out" ? "Medium" : primary === "tickets_live" || primary === "live_and_new" ? "High" : "Medium";
  const action = input.sale === "sold_out" ? "SOLD OUT" : priority === "High" ? "VERIFY LINK" : "MONITOR";

  return { conditions, primary, signals, genres, priority, action };
}
