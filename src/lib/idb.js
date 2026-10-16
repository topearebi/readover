// Minimal promise wrapper around IndexedDB. Replaces Dexie (one less dependency).

export function openDB(name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    if (upgrade) req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion, req.transaction);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn(`IndexedDB "${name}" upgrade blocked by another tab`);
  });
}

export function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/** Small table helper bound to one object store. */
export function table(dbPromise, storeName) {
  const run = async (mode, fn) => {
    const db = await dbPromise;
    const tx = db.transaction(storeName, mode);
    const done = txDone(tx); // attach before awaiting, or 'complete' can be missed
    const result = fn(tx.objectStore(storeName));
    const isRequest = (typeof IDBRequest !== 'undefined' && result instanceof IDBRequest) ||
      (result && typeof result === 'object' && ('onsuccess' in result || 'onerror' in result));
    const value = isRequest ? await promisify(result) : await result;
    await done;
    return value;
  };

  return {
    get: (key) => run('readonly', (s) => s.get(key)),
    put: (value) => run('readwrite', (s) => s.put(value)),
    delete: (key) => run('readwrite', (s) => s.delete(key)),
    all: () => run('readonly', (s) => s.getAll()),
    byIndex: (index, value) => run('readonly', (s) => s.index(index).getAll(value)),
    getMany: (keys) =>
      run('readonly', (s) => Promise.all(keys.map((k) => promisify(s.get(k))))),
    bulkPut: (values) =>
      run('readwrite', (s) => {
        values.forEach((v) => s.put(v));
      }),
    bulkDelete: (keys) =>
      run('readwrite', (s) => {
        keys.forEach((k) => s.delete(k));
      }),
    deleteByIndex: (index, value) =>
      run('readwrite', async (s) => {
        const keys = await promisify(s.index(index).getAllKeys(value));
        keys.forEach((k) => s.delete(k));
      }),
  };
}
