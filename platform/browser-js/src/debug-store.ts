import type { Debug_Report, Debug_Report_Reason } from './debug-report.js';

export interface Stored_Report_Summary {
  key: string;
  created_ms: number;
  created_iso: string;
  reason: Debug_Report_Reason;
  capture_mode: string;
  size_bytes: number;
  failure_operation: string | null;
}

export interface Stored_Report_Entry extends Stored_Report_Summary {
  text: string;
}

export interface Storage_Result {
  stored: boolean;
  warning: string | null;
}

export const MAXIMUM_STORED_REPORTS = 5;

// Minimal persistence surface so eviction/failure logic is testable without a
// real IndexedDB implementation.
export interface Debug_Report_Backend {
  put(entry: Stored_Report_Entry): Promise<void>;
  all(): Promise<Stored_Report_Entry[]>;
  get(key: string): Promise<Stored_Report_Entry | null>;
  delete(key: string): Promise<void>;
}

export class In_Memory_Report_Backend implements Debug_Report_Backend {
  entries = new Map<string, Stored_Report_Entry>();
  failure: Error | null = null;

  private check() {
    if (this.failure) throw this.failure;
  }

  async put(entry: Stored_Report_Entry) { this.check(); this.entries.set(entry.key, entry); }
  async all() { this.check(); return [...this.entries.values()]; }
  async get(key: string) { this.check(); return this.entries.get(key) ?? null; }
  async delete(key: string) { this.check(); this.entries.delete(key); }
}

// Browser IndexedDB adapter. Every failure resolves into a typed warning; a
// failing store never invalidates the in-memory report.
export class IndexedDB_Report_Backend implements Debug_Report_Backend {
  private database: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  constructor(readonly factory: () => IDBFactory | null = () => typeof indexedDB === 'undefined' ? null : indexedDB,
    readonly database_name = 'tapweave-debug', readonly store_name = 'reports') {}

  private open() {
    if (this.database) return Promise.resolve(this.database);
    this.opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const factory = this.factory();
      if (!factory) {
        reject(new Error('IndexedDB is unavailable in this environment.'));
        return;
      }
      const request = factory.open(this.database_name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.store_name)) {
          request.result.createObjectStore(this.store_name, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'));
    });
    return this.opening;
  }

  private async transaction<T>(mode: IDBTransactionMode, operate: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(this.store_name, mode);
      const request = operate(transaction.objectStore(this.store_name));
      // Request success precedes commit. A later abort must still reject the
      // operation, and callers awaiting persistence must be safe to navigate.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  }

  async put(entry: Stored_Report_Entry) { await this.transaction('readwrite', store => store.put(entry)); }
  async all() { return this.transaction<Stored_Report_Entry[]>('readonly', store => store.getAll()); }
  async get(key: string) { return (await this.transaction<Stored_Report_Entry | undefined>('readonly', store => store.get(key))) ?? null; }
  async delete(key: string) { await this.transaction('readwrite', store => store.delete(key)); }
}

export function summarize_stored_report(entry: Stored_Report_Entry): Stored_Report_Summary {
  const { key, created_ms, created_iso, reason, capture_mode, size_bytes, failure_operation } = entry;
  return { key, created_ms, created_iso, reason, capture_mode, size_bytes, failure_operation };
}

// The latest five reports persist locally; older entries are evicted by
// creation time. Storage failures leave the in-memory report usable.
export class Debug_Report_Store {
  private stored_warning: string | null = null;

  constructor(readonly backend: Debug_Report_Backend) {}

  get warning() { return this.stored_warning; }

  async persist(text: string, summary: { created_iso: string; reason: Debug_Report_Reason; capture_mode: string;
    failure_operation: string | null }): Promise<Storage_Result> {
    try {
      const created_ms = Date.parse(summary.created_iso);
      const entry: Stored_Report_Entry = { key: `${created_ms}-${Math.random().toString(36).slice(2, 10)}`,
        created_ms: Number.isFinite(created_ms) ? created_ms : 0, created_iso: summary.created_iso,
        reason: summary.reason, capture_mode: summary.capture_mode, size_bytes: text.length,
        failure_operation: summary.failure_operation, text };
      const existing = (await this.backend.all()).filter(stored => stored.key !== entry.key)
        .sort((first, second) => first.created_ms - second.created_ms || first.key.localeCompare(second.key));
      while (existing.length >= MAXIMUM_STORED_REPORTS) {
        await this.backend.delete(existing.shift()!.key);
      }
      await this.backend.put(entry);
      this.stored_warning = null;
      return { stored: true, warning: null };
    } catch (error) {
      this.stored_warning = `Report storage failed: ${error instanceof Error ? error.message : String(error)}` +
        ' The report remains available in memory.';
      return { stored: false, warning: this.stored_warning };
    }
  }

  async list(): Promise<{ summaries: Stored_Report_Summary[]; warning: string | null }> {
    try {
      const summaries = (await this.backend.all())
        .sort((first, second) => second.created_ms - first.created_ms || second.key.localeCompare(first.key))
        .map(summarize_stored_report);
      return { summaries, warning: null };
    } catch (error) {
      return { summaries: [], warning: `Stored reports are unavailable: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async text(key: string): Promise<string | null> {
    try {
      const entry = await this.backend.get(key);
      return entry?.text ?? null;
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<Storage_Result> {
    try {
      await this.backend.delete(key);
      return { stored: true, warning: null };
    } catch (error) {
      return { stored: false, warning: `Report deletion failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}
