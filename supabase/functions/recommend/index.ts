// Edge Function: suggests a date course from our saved memories.
// Claude uses web search so every stop is a real, currently open place; we then geocode the
// stops for the map and save the course for the couple.
//
// Secrets: ANTHROPIC_API_KEY, optional RECOMMEND_MODEL.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCoursePrompt, buildTaste, dropVisited, parseCourse, type CourseRequest } from "../_shared/course.ts";
import { geocode } from "../_shared/geo.ts";

const MODEL = Deno.env.get("RECOMMEND_MODEL") ?? "claude-sonnet-5-5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

type Block = { type: string; text?: string };

async function askClaude(prompt: string): Promise<string> {
  const tools = [{
    type: "web_search_20250305", name: "web_search", max_uses: 6,
    user_location: { type: "approximate", country: "KR", city: "Seoul", timezone: "Asia/Seoul" },
  }];
  const messages: { role: string; content: unknown }[] = [{ role: "user", content: prompt }];
  // Long searches can pause; continue the same turn a few times.
  for (let round = 0; round < 4; round++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 3000, tools, messages }),
    });
    if (!r.ok) throw new Error(`Claude API ${r.status}: ${await r.text()}`);
    const msg = await r.json();
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    return (msg.content as Block[]).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  }
  throw new Error("search took too long");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);
    const { data: member } = await supabase.from("members").select("couple_id").eq("user_id", user.id).single();
    if (!member) return json({ error: "not in a couple" }, 400);

    const request = ((await req.json()) ?? {}) as CourseRequest;
    const { data: memories } = await supabase.from("memories")
      .select("started_at, place, title, summary, memo").order("started_at", { ascending: false }).limit(200);
    const taste = buildTaste(memories ?? []);

    const text = await askClaude(buildCoursePrompt(taste, request));
    const parsed = parseCourse(text);
    if (!parsed) return json({ error: "추천 코스를 만들지 못했어요. 조건을 바꿔 다시 시도해주세요." }, 422);
    const course = dropVisited(parsed, taste.visited);
    if (course.stops.length < 2) return json({ error: "가본 적 없는 곳을 충분히 찾지 못했어요. 지역을 바꿔보세요." }, 422);

    const stops = [];
    for (const s of course.stops) {
      const at = (s.address && await geocode(s.address)) || await geocode(s.name);
      stops.push({ ...s, lat: at?.lat ?? null, lng: at?.lng ?? null });
    }
    const { data: row, error } = await supabase.from("date_courses").insert({
      couple_id: member.couple_id, request, course: { ...course, stops }, created_by: user.id,
    }).select("*").single();
    if (error) throw error;
    return json(row);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
