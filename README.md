# TicketSpot

Sri Lanka event dashboard. On each run it loads public ticket listings, marks which ones are on sale, newly added, pending, or still a save-the-date, and lets you filter the board.

## Run

```bash
npm install
npm run dev
```

Open the local URL Vite prints. The first load calls `/api/events`. Refresh bypasses the three-minute cache.

## Filters

- **Tickets live** — a package is on sale, in presale, or sold out, or the text says book now / tickets out / early bird.
- **Newly released** — one of the 10 latest TicketsMinistry listings, a presale, or announcement language (`just announced`, `new event`, `launching`). Other published listings stay on the board as “Listed” until they match a filter.
- **New + tickets** — both newly released and tickets live.
- **Coming soon** — `save the date`, `coming soon`, `stay tuned`, and similar lines. If tickets are already on sale, the card’s main badge stays Tickets live and it still appears in this filter.
- **Pending** — the seller status is pending, or the text says waitlist / TBA / on hold.

City, category, source, and text search stack on top of those.

## Where events come from

- **TicketsMinistry** public events API, including real ticket status.
- **Eventbrite Colombo** public listing page. Those rows do not include remaining ticket counts, so they stay “listing only” unless the description itself says tickets are on sale.
- **Facebook, Instagram, TikTok, and the open web** through public search snippets, using the same sale and announcement phrases as the original detector. Search engines often refuse automated lookups. When that happens the board still fills from the ticket sites, and a note says social posts were blocked.

TicketSpot does not sign in to Facebook or Instagram. It links out so you can verify the post yourself. Export downloads a CSV of the current filter.

## Netlify

Build command `npm run build`, publish directory `dist`. The `/api/events` redirect is already in `netlify.toml`, and the function timeout is 26 seconds. No API keys are required.
