// Edge Function: writes a title, place name and short summary for one memory.
// Keeps the Claude API key on the server; the app only sends a few small photos.
//
// Secrets: ANTHROPIC_API_KEY (supabase secrets set ANTHROPIC_API_KEY=...)
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by the platform.

import { createClient } from "npm:@supabase/supabase-js@2";
import { parseSummary } from "./parse.ts";

const MODEL = Deno.env.get("SUMMARY_MODEL") ?? "claude-haiku-5-5";

type Body = {
  memoryId: string;
  images: string[]; // base64 JPEG, already downscaled on the phone
  lat: number | null;
  lng: number | null;
  startedAt: string;
  endedAt: string;
  people: string[]; // names of registered people found in the photos
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  // OpenStreetMap Nominatim: free, one request per second, needs a User-Agent.
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=ko&lat=${lat}&lon=${lng}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "our-map-app/1.0" } });
    if (!r.ok) return null;
    const j = await r.json();
    const a = j.address ?? {};
    const area = [a.city ?? a.province ?? a.state, a.borough ?? a.city_district ?? a.suburb, a.quarter ?? a.neighbourhood]
      .filter(Boolean).join(" ");
    const name = j.name && j.name !== a.road ? j.name : "";
    return [area, name].filter(Boolean).join(" · ") || j.display_name || null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response("unauthorized", { status: 401, headers: cors });

    const body = (await req.json()) as Body;
    const place = body.lat != null && body.lng != null ? await reverseGeocode(body.lat, body.lng) : null;

    const fmt = (s: string) =>
      new Date(s).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit" });

    const prompt = [
      "커플이 함께한 하루의 사진들입니다. 둘만 보는 추억 앱에 들어갈 기록을 써주세요.",
      `시간: ${fmt(body.startedAt)} ~ ${fmt(body.endedAt)}`,
      place ? `위치(지도 검색 결과): ${place}` : "위치 정보 없음",
      body.people.length ? `사진에 나온 사람: ${body.people.join(", ")}` : "",
      "",
      "JSON으로만 답하세요: {\"title\": string, \"place\": string, \"summary\": string}",
      "- title: 12자 안팎의 짧은 제목. 이모지 없이.",
      "- place: 사람이 부르는 장소 이름 (예: '성수동 카페거리', '제주 협재해변'). 위치 결과를 우선 참고.",
      "- summary: 사진에서 보이는 것만으로 무엇을 했는지 1~2문장. 과장하거나 감정을 지어내지 말고 담백하게, 반말 일기체.",
    ].filter(Boolean).join("\n");

    const content = [
      ...body.images.slice(0, 4).map((data) => ({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data },
      })),
      { type: "text", text: prompt },
    ];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) throw new Error(`Claude API ${r.status}: ${await r.text()}`);
    const msg = await r.json();
    const text: string = msg.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
    const update = parseSummary(text, place);
    const { error } = await supabase.from("memories").update(update).eq("id", body.memoryId);
    if (error) throw error;

    return new Response(JSON.stringify(update), { headers: { ...cors, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "content-type": "application/json" } });
  }
});
