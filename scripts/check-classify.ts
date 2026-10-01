import assert from "node:assert/strict";
import { classifyListing } from "../shared/classify.ts";

const base = {
  title: "Night in Colombo",
  text: "A concert at BMICH",
  newlyListed: false,
  publishedListing: false,
};

const live = classifyListing({ ...base, sale: "open", text: "Book now at BMICH Colombo" });
assert.equal(live?.primary, "tickets_live");
assert.ok(live?.conditions.includes("tickets_live"));

const freshSale = classifyListing({ ...base, sale: "open", newlyListed: true });
assert.equal(freshSale?.primary, "live_and_new");
assert.ok(freshSale?.conditions.includes("newly_released"));
assert.ok(freshSale?.conditions.includes("tickets_live"));

const presale = classifyListing({ ...base, sale: "presale" });
assert.equal(presale?.primary, "live_and_new");
assert.ok(presale?.signals.includes("presale"));

const pending = classifyListing({ ...base, sale: "pending", text: "RISE UP edm colombo" });
assert.equal(pending?.primary, "pending");
assert.equal(pending?.conditions.includes("tickets_live"), false);

const soon = classifyListing({ ...base, sale: "unknown", text: "Save the date. Colombo concert." });
assert.equal(soon?.primary, "coming_soon");

const announced = classifyListing({
  ...base,
  sale: "unknown",
  text: "Just announced. Tickets out now in Kandy.",
});
assert.equal(announced?.primary, "live_and_new");

const noise = classifyListing({ ...base, sale: "unknown", text: "A random note with no sale language" });
assert.equal(noise, null);

const listed = classifyListing({
  ...base,
  sale: "unknown",
  publishedListing: true,
  text: "A walk around Colombo",
});
assert.equal(listed?.primary, "listed");
assert.deepEqual(listed?.conditions, []);

const dated = classifyListing({ ...base, sale: "sold_out", text: "Save the date at BMICH" });
assert.ok(dated?.conditions.includes("coming_soon"));
assert.equal(dated?.primary, "tickets_live");

const sold = classifyListing({ ...base, sale: "sold_out" });
assert.equal(sold?.action, "SOLD OUT");
assert.equal(sold?.priority, "Medium");
assert.ok(sold?.conditions.includes("tickets_live"));

console.log("classify checks passed");
