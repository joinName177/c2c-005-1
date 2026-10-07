import type { AudioMaterial } from '../core/models';
import type { MaterialRepositoryPort } from '../ports/material-repository.port';

export interface MaterialStoreDriver { list(): Promise<AudioMaterial[]>; put(value: AudioMaterial): Promise<void>; delete(id: string): Promise<void> }
class BrowserDriver implements MaterialStoreDriver {
  private async db(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open('c2c-005-voice-materials', 1); request.onupgradeneeded = () => request.result.createObjectStore('materials', { keyPath: 'id' }); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
  async list(): Promise<AudioMaterial[]> { const db = await this.db(); return new Promise((resolve, reject) => { const request = db.transaction('materials').objectStore('materials').getAll(); request.onsuccess = () => resolve(request.result as AudioMaterial[]); request.onerror = () => reject(request.error); }); }
  async put(value: AudioMaterial): Promise<void> { const db = await this.db(); return new Promise((resolve, reject) => { const tx = db.transaction('materials', 'readwrite'); tx.objectStore('materials').put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
  async delete(id: string): Promise<void> { const db = await this.db(); return new Promise((resolve, reject) => { const tx = db.transaction('materials', 'readwrite'); tx.objectStore('materials').delete(id); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
}
export class IndexedDbMaterialRepository implements MaterialRepositoryPort {
  constructor(private readonly driver: MaterialStoreDriver = new BrowserDriver()) {}
  async list() { return (await this.driver.list()).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  save(material: AudioMaterial) { return this.driver.put(material); }
  delete(id: string) { return this.driver.delete(id); }
}
