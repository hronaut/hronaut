import type { BrowserIndexedDbOptions } from './types.js'

export const INDEXED_DB_LIMITS = {
  maxDatabases: 20,
  maxObjectStores: 50,
  maxIndexesPerStore: 50,
  maxEntries: 100,
  maxOffset: 10_000,
  maxNameChars: 512,
  maxKeyPreviewBytes: 2 * 1024,
  maxValuePreviewBytes: 16 * 1024,
  maxValuePreviewBytesTotal: 128 * 1024,
  maxDepth: 5,
  maxCollectionItems: 50
} as const

export interface NormalizedBrowserIndexedDbOptions {
  database?: string
  objectStore?: string
  offset: number
  limit: number
  includeValues: boolean
}

export function normalizeBrowserIndexedDbOptions(
  options: BrowserIndexedDbOptions = {}
): NormalizedBrowserIndexedDbOptions {
  const database = options.database === undefined ? undefined : String(options.database)
  const objectStore = options.objectStore === undefined ? undefined : String(options.objectStore)
  if (database !== undefined && (!database || database.length > INDEXED_DB_LIMITS.maxNameChars)) {
    throw new TypeError(`database must contain 1-${INDEXED_DB_LIMITS.maxNameChars} characters`)
  }
  if (objectStore !== undefined && (!objectStore || objectStore.length > INDEXED_DB_LIMITS.maxNameChars)) {
    throw new TypeError(`objectStore must contain 1-${INDEXED_DB_LIMITS.maxNameChars} characters`)
  }
  if (objectStore !== undefined && database === undefined) throw new TypeError('database is required when objectStore is provided')
  const offset = Math.min(Math.max(Math.floor(Number(options.offset ?? 0) || 0), 0), INDEXED_DB_LIMITS.maxOffset)
  const limit = Math.min(Math.max(Math.floor(Number(options.limit ?? 50) || 50), 1), INDEXED_DB_LIMITS.maxEntries)
  return { database, objectStore, offset, limit, includeValues: options.includeValues === true }
}

export function indexedDbPageScript(options: NormalizedBrowserIndexedDbOptions): string {
  return `(async () => {
    const limits = ${JSON.stringify(INDEXED_DB_LIMITS)};
    const options = ${JSON.stringify(options)};
    if (!globalThis.indexedDB || typeof globalThis.indexedDB.databases !== 'function') {
      throw new Error('IndexedDB database discovery is unavailable for this page.');
    }
    const requestResult = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
    });
    const boundedName = (value) => String(value ?? '').slice(0, limits.maxNameChars);
    const valueType = (value) => {
      if (value === null) return 'null';
      if (Array.isArray(value)) return 'array';
      const tag = Object.prototype.toString.call(value).slice(8, -1);
      return tag || typeof value;
    };
    const normalize = (value, depth, seen, state) => {
      if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
        if (typeof value === 'string' && value.length > 4096) {
          state.truncated = true;
          return value.slice(0, 4096) + '…';
        }
        return value;
      }
      if (typeof value === 'undefined') return '[undefined]';
      if (typeof value === 'bigint') return String(value) + 'n';
      if (typeof value === 'symbol') return '[Symbol]';
      if (typeof value === 'function') return '[Function]';
      if (depth >= limits.maxDepth) {
        state.truncated = true;
        return '[' + valueType(value) + ']';
      }
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
      if (value instanceof Blob) return { type: valueType(value), size: value.size, mimeType: boundedName(value.type) };
      if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', byteLength: value.byteLength };
      if (ArrayBuffer.isView(value)) {
        const values = Array.from(value).slice(0, limits.maxCollectionItems);
        if (value.length > values.length) state.truncated = true;
        return { type: valueType(value), byteLength: value.byteLength, values };
      }
      if (value instanceof Map) {
        const entries = Array.from(value.entries()).slice(0, limits.maxCollectionItems)
          .map(([key, item]) => [normalize(key, depth + 1, seen, state), normalize(item, depth + 1, seen, state)]);
        if (value.size > entries.length) state.truncated = true;
        return { type: 'Map', entries };
      }
      if (value instanceof Set) {
        const values = Array.from(value.values()).slice(0, limits.maxCollectionItems)
          .map((item) => normalize(item, depth + 1, seen, state));
        if (value.size > values.length) state.truncated = true;
        return { type: 'Set', values };
      }
      if (Array.isArray(value)) {
        const values = value.slice(0, limits.maxCollectionItems)
          .map((item) => normalize(item, depth + 1, seen, state));
        if (value.length > values.length) state.truncated = true;
        return values;
      }
      const output = {};
      const entries = Object.entries(value).slice(0, limits.maxCollectionItems);
      if (Object.keys(value).length > entries.length) state.truncated = true;
      for (const [key, item] of entries) output[boundedName(key)] = normalize(item, depth + 1, seen, state);
      return output;
    };
    const preview = (value, maxBytes) => {
      const state = { truncated: false };
      let text;
      try {
        text = JSON.stringify(normalize(value, 0, new WeakSet(), state));
      } catch {
        text = JSON.stringify('[' + valueType(value) + ']');
        state.truncated = true;
      }
      if (text === undefined) text = JSON.stringify('[undefined]');
      const encoded = new TextEncoder().encode(text);
      let returned = encoded.byteLength > maxBytes
        ? new TextDecoder().decode(encoded.slice(0, maxBytes))
        : text;
      while (new TextEncoder().encode(returned).byteLength > maxBytes) returned = returned.slice(0, -1);
      return {
        text: returned,
        bytes: encoded.byteLength,
        truncated: state.truncated || encoded.byteLength > maxBytes
      };
    };
    const rawDatabases = await globalThis.indexedDB.databases();
    const namedDatabases = rawDatabases
      .filter((database) => typeof database.name === 'string' && database.name.length > 0)
      .sort((left, right) => left.name.localeCompare(right.name));
    const usableDatabases = namedDatabases.filter((database) => database.name.length <= limits.maxNameChars);
    const databases = usableDatabases.slice(0, limits.maxDatabases).map((database) => ({
      name: boundedName(database.name),
      version: Number(database.version || 0)
    }));
    const report = {
      databases,
      entries: [],
      offset: options.offset,
      limit: options.limit,
      hasMore: false,
      valuesIncluded: options.includeValues,
      truncated: namedDatabases.length > databases.length
    };
    if (!options.database) return report;
    if (!usableDatabases.some((database) => database.name === options.database)) {
      throw new Error('IndexedDB database not found: ' + options.database);
    }
    const database = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(options.database);
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        resolve(request.result);
      };
      request.onerror = () => fail(request.error || new Error('Could not open IndexedDB database.'));
      request.onupgradeneeded = () => {
        request.transaction?.abort();
        fail(new Error('IndexedDB database changed while it was being inspected. Refresh and try again.'));
      };
      request.onblocked = () => fail(new Error('IndexedDB database is blocked by another page. Close pending database upgrades and try again.'));
    });
    try {
      const storeNames = Array.from(database.objectStoreNames).sort();
      const selectedStoreNames = storeNames
        .filter((storeName) => storeName.length <= limits.maxNameChars)
        .slice(0, limits.maxObjectStores);
      const objectStores = [];
      for (const storeName of selectedStoreNames) {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const indexes = Array.from(store.indexNames).sort().slice(0, limits.maxIndexesPerStore).map((indexName) => {
          const index = store.index(indexName);
          return {
            name: boundedName(index.name),
            keyPath: index.keyPath,
            unique: index.unique,
            multiEntry: index.multiEntry
          };
        });
        const entryCount = await requestResult(store.count());
        objectStores.push({
          name: boundedName(store.name),
          keyPath: store.keyPath,
          autoIncrement: store.autoIncrement,
          indexes,
          entryCount
        });
      }
      report.selectedDatabase = {
        name: boundedName(database.name),
        version: Number(database.version),
        objectStores
      };
      if (storeNames.length > selectedStoreNames.length) report.truncated = true;
      if (!options.objectStore) return report;
      if (!storeNames.includes(options.objectStore)) {
        throw new Error('IndexedDB object store not found: ' + options.objectStore);
      }
      report.selectedObjectStore = options.objectStore;
      const transaction = database.transaction(options.objectStore, 'readonly');
      const store = transaction.objectStore(options.objectStore);
      let remainingValueBytes = limits.maxValuePreviewBytesTotal;
      let skipped = 0;
      await new Promise((resolve, reject) => {
        const request = store.openCursor();
        request.onerror = () => reject(request.error || new Error('Could not read IndexedDB records.'));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          if (skipped < options.offset) {
            skipped += 1;
            cursor.continue();
            return;
          }
          if (report.entries.length >= options.limit) {
            report.hasMore = true;
            resolve();
            return;
          }
          const key = preview(cursor.key, limits.maxKeyPreviewBytes);
          const primaryKey = preview(cursor.primaryKey, limits.maxKeyPreviewBytes);
          const entry = {
            key: key.text,
            keyType: valueType(cursor.key),
            primaryKey: primaryKey.text,
            valueType: valueType(cursor.value),
            ...(key.truncated || primaryKey.truncated ? { keyTruncated: true } : {})
          };
          if (options.includeValues && remainingValueBytes > 0) {
            const value = preview(cursor.value, Math.min(limits.maxValuePreviewBytes, remainingValueBytes));
            entry.valuePreview = value.text;
            entry.valuePreviewBytes = new TextEncoder().encode(value.text).byteLength;
            if (value.truncated) entry.valueTruncated = true;
            remainingValueBytes -= new TextEncoder().encode(value.text).byteLength;
          } else if (options.includeValues) {
            entry.valueTruncated = true;
          }
          report.entries.push(entry);
          cursor.continue();
        };
      });
      return report;
    } finally {
      database.close();
    }
  })()`
}
