import type { Config } from "@netlify/functions";
import { loadEvents } from "../../server/load-events.ts";

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  try {
    const body = await loadEvents(fresh);
    return Response.json(body, {
      headers: { "Cache-Control": fresh ? "no-store" : "public, max-age=60" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load events";
    return Response.json({ error: message }, { status: 500 });
  }
}

export const config: Config = {
  method: "GET",
};
