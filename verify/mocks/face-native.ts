import { world } from './env';
export async function peopleInPhoto(uri: string, _w: number, _h: number, people: { id: string }[]) {
  const a = world.gallery.find(g => `ph://${g.id}` === uri)!;
  return a.faces.filter(f => people.some(p => p.id === f));
}
