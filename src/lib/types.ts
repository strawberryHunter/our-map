export type Couple = { id: string; invite_code: string };
export type Member = { couple_id: string; user_id: string; display_name: string };
export type PersonRow = { id: string; couple_id: string; name: string; embeddings: number[][] };

export type Memory = {
  id: string;
  couple_id: string;
  started_at: string;
  ended_at: string;
  lat: number | null;
  lng: number | null;
  place: string | null;
  title: string | null;
  summary: string | null;
  people: string[];
  cover_photo: string | null;
};

export type PhotoRow = {
  id: string;
  memory_id: string;
  storage_path: string;
  taken_at: string;
  lat: number | null;
  lng: number | null;
  width: number | null;
  height: number | null;
  people: string[];
};
