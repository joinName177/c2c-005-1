import type { DraftRepository, StoredDraft } from '../ports/draft-repository.port';
import { openStudioDb, requestAsPromise, txAsPromise } from './indexeddb-db';

export interface DraftStoreDriver {
  loadDraft(): Promise<StoredDraft | null>;
  saveDraft(draft: StoredDraft): Promise<void>;
  clearDraft(): Promise<void>;
  getSource(id: string): Promise<Blob | undefined>;
  putSource(id: string, blob: Blob): Promise<void>;
  deleteSources(ids: string[]): Promise<void>;
}

const DRAFT_KEY = 'current';
class BrowserDriver implements DraftStoreDriver {
  private db(): Promise<IDBDatabase> { return openStudioDb(); }
  async loadDraft() { const db = await this.db(); try { return (await requestAsPromise(db.transaction('drafts').objectStore('drafts').get(DRAFT_KEY))) as StoredDraft | null ?? null; } finally { db.close(); } }
  async saveDraft(draft: StoredDraft) {
    const db = await this.db();
    try {
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put(draft, DRAFT_KEY);
      await txAsPromise(tx);
    } finally { db.close(); }
  }
  async clearDraft() {
    const db = await this.db();
    try {
      const tx = db.transaction(['drafts', 'sources'], 'readwrite');
      tx.objectStore('drafts').delete(DRAFT_KEY);
      tx.objectStore('sources').clear();
      await txAsPromise(tx);
    } finally { db.close(); }
  }
  async getSource(id: string) { const db = await this.db(); try { return (await requestAsPromise(db.transaction('sources').objectStore('sources').get(id))) as Blob | undefined; } finally { db.close(); } }
  async putSource(id: string, blob: Blob) {
    const db = await this.db();
    try {
      const tx = db.transaction('sources', 'readwrite');
      tx.objectStore('sources').put(blob, id);
      await txAsPromise(tx);
    } finally { db.close(); }
  }
  async deleteSources(ids: string[]) {
    const db = await this.db();
    try {
      const tx = db.transaction('sources', 'readwrite');
      const store = tx.objectStore('sources');
      ids.forEach((id) => store.delete(id));
      await txAsPromise(tx);
    } finally { db.close(); }
  }
}

export class IndexedDbDraftRepository implements DraftRepository {
  constructor(private readonly driver: DraftStoreDriver = new BrowserDriver()) {}
  loadDraft() { return this.driver.loadDraft(); }
  saveDraft(draft: StoredDraft) { return this.driver.saveDraft(draft); }
  clearDraft() { return this.driver.clearDraft(); }
  getSource(id: string) { return this.driver.getSource(id); }
  putSource(id: string, blob: Blob) { return this.driver.putSource(id, blob); }
  deleteSources(ids: string[]) { return this.driver.deleteSources(ids); }
}
