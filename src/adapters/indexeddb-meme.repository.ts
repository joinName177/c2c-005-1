import type { VoiceMeme } from '../core/models';
import type { MemeRepository } from '../ports/meme-repository.port';
import { openStudioDb, requestAsPromise, txAsPromise } from './indexeddb-db';

export interface MemeStoreDriver { list(): Promise<VoiceMeme[]>; put(value: VoiceMeme): Promise<void>; delete(id: string): Promise<void> }
class BrowserDriver implements MemeStoreDriver {
  private async db(): Promise<IDBDatabase> { return openStudioDb(); }
  async list(): Promise<VoiceMeme[]> {
    const db = await this.db();
    try { return await requestAsPromise(db.transaction('memes').objectStore('memes').getAll()) as VoiceMeme[]; }
    finally { db.close(); }
  }
  async put(value: VoiceMeme): Promise<void> {
    const db = await this.db();
    try { await txAsPromise((() => { const tx = db.transaction('memes', 'readwrite'); tx.objectStore('memes').put(value); return tx; })()); }
    finally { db.close(); }
  }
  async delete(id: string): Promise<void> {
    const db = await this.db();
    try { await txAsPromise((() => { const tx = db.transaction('memes', 'readwrite'); tx.objectStore('memes').delete(id); return tx; })()); }
    finally { db.close(); }
  }
}
export class IndexedDbMemeRepository implements MemeRepository {
  constructor(private readonly driver: MemeStoreDriver = new BrowserDriver()) {}
  list() { return this.driver.list(); }
  save(meme: VoiceMeme) { return this.driver.put(meme); }
  async rename(id: string, title: string) { const meme = (await this.list()).find((item) => item.id === id); if (meme) await this.driver.put({ ...meme, title }); }
  delete(id: string) { return this.driver.delete(id); }
}
