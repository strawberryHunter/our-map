import { world } from './env';
export default {
  getItem: async (k: string) => world.storage.get(k) ?? null,
  setItem: async (k: string, v: string) => { world.storage.set(k, v); },
  removeItem: async (k: string) => { world.storage.delete(k); },
};
