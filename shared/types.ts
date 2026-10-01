export type Condition =
  | "tickets_live"
  | "newly_released"
  | "live_and_new"
  | "coming_soon"
  | "pending";

/** Badge shown on a card. "listed" is a published event that matched none of the sale filters. */
export type Badge = Condition | "listed";

export type SaleState = "open" | "limited" | "sold_out" | "presale" | "pending" | "unknown";

export type SpotEvent = {
  id: string;
  title: string;
  preview: string;
  link: string;
  image?: string;
  platform: string;
  source: string;
  conditions: Condition[];
  primary: Badge;
  priority: "High" | "Medium";
  action: string;
  sale: SaleState;
  start?: string;
  end?: string;
  venue?: string;
  city?: string;
  district?: string;
  category?: string;
  priceLabel?: string;
  organizer?: string;
  signals: string[];
  genres: string[];
};

export type SourceReport = {
  id: string;
  label: string;
  ok: boolean;
  count: number;
  note?: string;
};

export type EventsResponse = {
  fetchedAt: string;
  cached: boolean;
  warnings: string[];
  sources: SourceReport[];
  events: SpotEvent[];
};

export type ListingInput = {
  title: string;
  text: string;
  sale: SaleState;
  newlyListed: boolean;
  /** Published marketplace row with no social keyword gate. */
  publishedListing: boolean;
};
