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
  memo: string | null;
  place_source: 'gps' | 'manual' | null;
  origin: 'auto' | 'picked';
  created_by: string | null;
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

export type CourseStop = {
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  time: string | null; // e.g. "14:00"
  category: string | null; // cafe, food, walk, exhibition, ...
  why: string;
  url: string | null;
};
export type Course = { title: string; summary: string; stops: CourseStop[] };
export type DateCourse = {
  id: string;
  couple_id: string;
  request: { area?: string; mood?: string; budget?: string; when?: string; note?: string };
  course: Course;
  saved: boolean;
  created_at: string;
};
