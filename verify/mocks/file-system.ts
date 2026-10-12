export class File {
  constructor(public uri: string) {}
  async arrayBuffer() { return new TextEncoder().encode(this.uri).buffer as ArrayBuffer; }
}
export const Paths = { cache: '/cache' };
