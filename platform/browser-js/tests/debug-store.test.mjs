import test from 'node:test';
import assert from 'node:assert/strict';
import { Debug_Report_Store, In_Memory_Report_Backend, IndexedDB_Report_Backend, MAXIMUM_STORED_REPORTS } from '../build/debug-store.js';

function store_fixture() {
  const backend = new In_Memory_Report_Backend();
  return { backend, store: new Debug_Report_Store(backend) };
}

const summary_for = index => ({ created_iso: new Date(1_700_000_000_000 + index * 60_000).toISOString(),
  reason: 'failure', capture_mode: 'basic', failure_operation: `op_${index}` });

test('persist stores reports and evicts the oldest beyond the latest five', async () => {
  const { backend, store } = store_fixture();
  for (let report_index = 0; report_index < 7; report_index++) {
    const result = await store.persist(`report ${report_index}`, summary_for(report_index));
    assert.equal(result.stored, true);
    assert.equal(result.warning, null);
  }
  const { summaries } = await store.list();
  assert.equal(summaries.length, MAXIMUM_STORED_REPORTS);
  assert.deepEqual(summaries.map(summary => summary.failure_operation),
    ['op_6', 'op_5', 'op_4', 'op_3', 'op_2']);
  assert.equal(await store.text(summaries[0].key), 'report 6');
  assert.equal(backend.entries.size, MAXIMUM_STORED_REPORTS);
});

test('persist keeps failure summaries and sizes for the listing', async () => {
  const { store } = store_fixture();
  await store.persist('x'.repeat(1234), summary_for(0));
  const { summaries } = await store.list();
  assert.equal(summaries[0].size_bytes, 1234);
  assert.equal(summaries[0].reason, 'failure');
  assert.equal(summaries[0].capture_mode, 'basic');
  assert.equal(summaries[0].failure_operation, 'op_0');
});

test('storage failure leaves the in-memory report usable and surfaces a warning', async () => {
  const { backend, store } = store_fixture();
  backend.failure = new Error('quota');
  const result = await store.persist('report text', summary_for(0));
  assert.equal(result.stored, false);
  assert.ok(result.warning.includes('Report storage failed'));
  assert.ok(result.warning.includes('remains available in memory'));
  assert.equal(store.warning, result.warning);
  const { summaries, warning } = await store.list();
  assert.deepEqual(summaries, []);
  assert.ok(warning.includes('Stored reports are unavailable'));
  backend.failure = null;
  const recovery = await store.persist('second try', summary_for(1));
  assert.equal(recovery.stored, true);
  assert.equal(store.warning, null);
});

test('remove deletes reports and reports deletion failures', async () => {
  const { backend, store } = store_fixture();
  await store.persist('report', summary_for(0));
  const { summaries } = await store.list();
  const removal = await store.remove(summaries[0].key);
  assert.equal(removal.stored, true);
  assert.equal((await store.list()).summaries.length, 0);
  backend.failure = new Error('locked');
  const failed = await store.remove('missing-key');
  assert.equal(failed.stored, false);
  assert.ok(failed.warning.includes('Report deletion failed'));
});

test('failed reads return null text without throwing', async () => {
  const { backend, store } = store_fixture();
  await store.persist('report', summary_for(0));
  backend.failure = new Error('io');
  assert.equal(await store.text('any-key'), null);
});

function indexed_database_fixture() {
  const request = { result: 'report-key', error: null };
  const transaction = { error: null, objectStore: () => ({ put: () => request }) };
  const open_request = { result: { transaction: () => transaction } };
  const backend = new IndexedDB_Report_Backend(() => ({ open: () => open_request }));
  return { backend, request, transaction, open_request };
}

test('IndexedDB persistence waits for commit after request success', async () => {
  const { backend, request, transaction, open_request } = indexed_database_fixture();
  let settled = false;
  const pending = backend.put({ key: 'report-key' }).then(() => { settled = true; });
  open_request.onsuccess();
  await new Promise(resolve => setImmediate(resolve));
  request.onsuccess?.();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'request success is not a committed transaction');
  transaction.oncomplete();
  await pending;
  assert.equal(settled, true);
});

test('IndexedDB abort after request success rejects persistence', async () => {
  const { backend, request, transaction, open_request } = indexed_database_fixture();
  const pending = backend.put({ key: 'report-key' });
  const rejection = assert.rejects(pending, /transaction aborted/);
  open_request.onsuccess();
  await new Promise(resolve => setImmediate(resolve));
  request.onsuccess?.();
  transaction.onabort();
  await rejection;
});
