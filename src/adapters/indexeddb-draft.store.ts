import type { ArrangementDraft } from '../core/arrangement';
import type { DraftStorePort } from '../ports/draft-store.port';

const KEY = 'current';
export interface DraftStoreDriver { get(): Promise<ArrangementDraft | undefined>; put(value: ArrangementDraft): Promise<void>; clear(): Promise<void> }
class BrowserDriver implements DraftStoreDriver {
  private async db(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open('c2c-005-studio-draft', 1); request.onupgradeneeded = () => request.result.createObjectStore('draft'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async get(): Promise<ArrangementDraft | undefined> { const db = await this.db(); return new Promise((resolve, reject) => { const request = db.transaction('draft').objectStore('draft').get(KEY); request.onsuccess = () => resolve(request.result as ArrangementDraft | undefined); request.onerror = () => reject(request.error); }); }
  async put(value: ArrangementDraft): Promise<void> { const db = await this.db(); return new Promise((resolve, reject) => { const tx = db.transaction('draft', 'readwrite'); tx.objectStore('draft').put(value, KEY); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  async clear(): Promise<void> { const db = await this.db(); return new Promise((resolve, reject) => { const tx = db.transaction('draft', 'readwrite'); tx.objectStore('draft').delete(KEY); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
}
export class IndexedDbDraftStore implements DraftStorePort {
  constructor(private readonly driver: DraftStoreDriver = new BrowserDriver()) {}
  load() { return this.driver.get(); }
  save(draft: ArrangementDraft) { return this.driver.put(draft); }
  clear() { return this.driver.clear(); }
}
