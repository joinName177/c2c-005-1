export const STUDIO_DB_NAME = 'c2c-005-voice-memes';
export const STUDIO_DB_VERSION = 2;

/** 共享连接：memes / sources / drafts 三个对象仓库。 */
export function openStudioDb(version: number = STUDIO_DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(STUDIO_DB_NAME, version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('memes')) db.createObjectStore('memes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources');
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function txAsPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
