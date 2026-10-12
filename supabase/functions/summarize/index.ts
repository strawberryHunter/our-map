// Edge Function: writes (or rewrites) the story for one memory.
// Reads the memory, our memo and up to 4 stored photos itself, so the phone only sends the id.
//
// Secrets: ANTHROPIC_API_KEY (supabase secrets set ANTHROPIC_API_KEY=...), optional SUMMARY_MODEL.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by the platform.

import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { buildStoryPrompt, parseStory, type PlaceSource } from "../_shared/story.ts";
import { reverseGeocode } from "../_shared/geo.ts";

const MODEL = Deno.env.get("SUMMARY_MODEL") ?? "claude-haiku-5-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // Acting as the signed-in user: row-level security limits us to their own couple.
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const { memoryId } = (await req.json()) as { memoryId: string };
    const { data: m, error: mErr } = await supabase.from("memories").select("*").eq("id", memoryId).single();
    if (mErr || !m) return json({ error: "memory not found" }, 404);

    const [{ data: photos }, { data: people }] = await Promise.all([
      supabase.from("photos").select("storage_path, people, taken_at").eq("memory_id", memoryId).order("taken_at"),
      supabase.from("people").select("id, name"),
    ]);
    if (!photos?.length) return json({ error: "no photos" }, 400);

    // Up to 4 photos, spread over the day, preferring ones with us in them.
    const ranked = [...photos].sort((a, b) => b.people.length - a.people.length).slice(0, 8)
      .sort((a, b) => a.taken_at.localeCompare(b.taken_at));
    const step = Math.max(1, Math.floor(ranked.length / 4));
    const picks = ranked.filter((_, i) => i % step === 0).slice(0, 4);
    const images: string[] = [];
    for (const p of picks) {
      // Stored photos are already 1600px JPEGs (~300 KB); Storage image transforms need a paid plan.
      const { data } = await supabase.storage.from("photos").download(p.storage_path);
      if (data) images.push(encodeBase64(new Uint8Array(await data.arrayBuffer())));
    }

    const placeSource = (m.place_source ?? null) as PlaceSource;
    const placeHint = placeSource === "manual" ? m.place
      : placeSource === "gps" && m.lat != null ? await reverseGeocode(m.lat, m.lng)
      : null;
    const names = (people ?? []).filter((p) => m.people.includes(p.id)).map((p) => p.name);
    const input = { startedAt: m.started_at, endedAt: m.ended_at, placeSource, placeHint, people: names, memo: m.memo, photoCount: images.length };

    const content = [
      ...images.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } })),
      { type: "text", text: buildStoryPrompt(input) },
    ];
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 600, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) throw new Error(`Claude API ${r.status}: ${await r.text()}`);
    const msg = await r.json();
    const text: string = msg.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
    const story = parseStory(text, input);

    const { error } = await supabase.from("memories").update(story).eq("id", memoryId);
    if (error) throw error;
    return json(story);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
