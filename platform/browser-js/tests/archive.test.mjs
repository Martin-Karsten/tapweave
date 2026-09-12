import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { Archive_Assets, Loose_Assets, ASSET_LIMITS, normalize_asset_path } from '../src/archive.mjs';

const fixture_text = 'osu file format v14\n[HitObjects]\n256,192,1000,1,0';

test('stored and deflated archives extract verified entries lazily', async () => {
  for (const compression_level of [0, 6]) {
    const bytes = zipSync({ 'Folder/Map.osu': strToU8(fixture_text), 'Folder/music.wav': new Uint8Array(10000) }, { level: compression_level });
    const archive = new Archive_Assets(bytes);
    assert.equal(archive.extracted_bytes, 0);
    assert.deepEqual(archive.list_maps(), ['folder/map.osu']);
    assert.equal(new TextDecoder().decode(await archive.read('Folder\\Map.osu')), fixture_text);
    assert.equal(await archive.read('missing.wav'), null);
    const music = await archive.read('folder/music.wav');
    assert.equal(music.length, 10000);
    assert.strictEqual(await archive.read('folder/music.wav'), music);
    archive.dispose();
    assert.equal(archive.extracted_bytes, 0);
    await assert.rejects(archive.read('folder/map.osu'), { code: 'DISPOSED' });
  }
});

test('unsafe and ambiguous filenames reject before extraction', () => {
  for (const filename of ['../map.osu', '/map.osu', 'C:\\map.osu', 'folder//map.osu', 'folder/./map.osu']) {
    assert.throws(() => normalize_asset_path(filename), { code: 'INVALID_ASSET_PATH' });
    assert.throws(() => new Archive_Assets(zipSync({ [filename]: strToU8(fixture_text) })), { code: 'INVALID_ASSET_PATH' });
  }
  assert.throws(() => new Archive_Assets(zipSync({ 'map.osu': new Uint8Array(), 'MAP.osu': new Uint8Array() })),
    { code: 'DUPLICATE_ASSET' });
});

test('archive quotas and truncation are checked before publication', () => {
  const bytes = zipSync({ 'map.osu': strToU8(fixture_text) });
  for (const lowered_limits of [{ archive_bytes: 1 }, { entry_count: 0 }, { entry_bytes: 1 }, { extracted_bytes: 1 }]) {
    assert.throws(() => new Archive_Assets(bytes, { ...ASSET_LIMITS, ...lowered_limits }), { code: 'QUOTA_EXCEEDED' });
  }
  for (const byte_count of [0, 21, bytes.length - 1]) {
    assert.throws(() => new Archive_Assets(bytes.subarray(0, byte_count)), { code: 'MALFORMED_ARCHIVE' });
  }
});

test('payload CRC corruption and false inflated size reject', async () => {
  const bytes = zipSync({ 'map.osu': strToU8(fixture_text) }, { level: 0 });
  bytes[30 + 'map.osu'.length] ^= 1;
  const archive = new Archive_Assets(bytes);
  await assert.rejects(archive.read('map.osu'), { code: 'MALFORMED_ARCHIVE' });
  assert.equal(archive.extracted_bytes, 0);
  const inflated = zipSync({ 'map.osu': new Uint8Array(100000) });
  const view = new DataView(inflated.buffer);
  const directory_offset = view.getUint32(inflated.length - 22 + 16, true);
  view.setUint32(22, 1, true);
  view.setUint32(directory_offset + 24, 1, true);
  await assert.rejects(new Archive_Assets(inflated).read('map.osu'), { code: 'MALFORMED_ARCHIVE' });
});

test('encrypted, unsupported compression and local/directory disagreement reject', () => {
  for (const mutate of [
    view => view.setUint16(6, 1, true),
    view => view.setUint16(8, 99, true),
    view => view.setUint32(18, 1, true),
  ]) {
    const bytes = zipSync({ 'map.osu': strToU8(fixture_text) });
    mutate(new DataView(bytes.buffer));
    assert.throws(() => new Archive_Assets(bytes));
  }
});

test('loose assets enforce the same naming and ownership rules', async () => {
  const assets = new Loose_Assets([new File([fixture_text], 'Map.osu')]);
  assert.deepEqual(assets.list_maps(), ['map.osu']);
  assert.equal(new TextDecoder().decode(await assets.read('map.osu')), fixture_text);
  assert.throws(() => new Loose_Assets([new File([], 'Map.osu'), new File([], 'map.osu')]), { code: 'DUPLICATE_ASSET' });
  assets.dispose();
  await assert.rejects(assets.read('map.osu'), { code: 'DISPOSED' });
});

test('empty DEFLATE payload and overlapping entries reject', () => {
  const bytes = zipSync({ 'empty.osu': new Uint8Array() }, { level: 0 });
  const view = new DataView(bytes.buffer);
  const directory_offset = view.getUint32(bytes.length - 22 + 16, true);
  view.setUint16(8, 8, true);
  view.setUint16(directory_offset + 10, 8, true);
  assert.throws(() => new Archive_Assets(bytes), { code: 'MALFORMED_ARCHIVE' });
  const overlapping = zipSync({ 'first.osu': new Uint8Array(64), 'second.osu': new Uint8Array(64) }, { level: 0 });
  const overlapping_view = new DataView(overlapping.buffer);
  const central_offset = overlapping_view.getUint32(overlapping.length - 22 + 16, true);
  overlapping_view.setUint32(18, 104, true);
  overlapping_view.setUint32(22, 104, true);
  overlapping_view.setUint32(central_offset + 20, 104, true);
  overlapping_view.setUint32(central_offset + 24, 104, true);
  assert.throws(() => new Archive_Assets(overlapping), { code: 'MALFORMED_ARCHIVE', message: 'Overlapping ZIP entries.' });
});
