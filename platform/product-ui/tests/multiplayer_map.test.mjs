// @vitest-environment node
import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { zipSync, strToU8 } from 'fflate';
import { Engine_Bridge } from '@browser/engine-bridge.js';
import { Selection_Controller } from '@browser/selection.js';
import {
  describe_local_map,
  hash_bytes,
  matching_filename,
  require_matching_map,
} from '../src/services/multiplayer_map';
import { matching_map } from '../shared/multiplayer';

const engine_bytes = await readFile(
  new URL('../../../engine/artifacts/tapweave.wasm', import.meta.url),
);
const engine_hash = 'c'.repeat(64);
const map_text = (end_ms = 95_000) => `osu file format v14
[General]
AudioFilename: music.wav
[Metadata]
Title:Local fixture
Artist:Tapweave
Creator:Test
Version:Delayed
[HitObjects]
256,192,8000,1,0
256,192,${end_ms},1,0
`;
const music_bytes = new Uint8Array([1, 2, 3, 4]);
const loose_files = (text = map_text(), music = music_bytes) => [
  new File([text], 'selected.osu'),
  new File([music], 'music.wav'),
];

async function with_selection(check) {
  const engine = await Engine_Bridge.create(engine_bytes);
  const controller = new Selection_Controller(engine, {
    decode_audio: async () => ({ length: 100, numberOfChannels: 2 }),
  });
  try {
    await check(controller);
  } finally {
    controller.dispose();
    expect(engine.map_handles.size).toBe(0);
    engine.dispose();
  }
}

test('matching ignores archive compression, directory packaging and unrelated backgrounds; selects exact difficulty', async () => {
  await with_selection(async (controller) => {
    await controller.add_files(loose_files());
    const expected = await describe_local_map(controller.active, engine_hash);
    expect(expected.end_ms).toBe(95_000); // Not the 87-second object span.
    for (const compression_level of [0, 9]) {
      const archive = zipSync(
        {
          'set/first.osu': strToU8(map_text(40_000)),
          'set/matching.osu': strToU8(map_text()),
          'set/music.wav': music_bytes,
          'unrelated.jpg': new Uint8Array([compression_level]),
        },
        { level: compression_level },
      );
      await controller.add_files([new File([archive], 'repacked.osz')], {
        choose_map: (source) => matching_filename(source, expected),
        validate: async (candidate) => {
          const candidate_map = await describe_local_map(candidate, engine_hash);
          require_matching_map(candidate_map, expected);
        },
      });
      expect(controller.error).toBeNull();
      expect(controller.active.filename).toBe('set/matching.osu');
      expect(matching_map(await describe_local_map(controller.active, engine_hash), expected)).toBe(
        true,
      );
    }
  });
});

test('wrong difficulty, edited map, changed or missing music and incompatible engine retain previous selection', async () => {
  await with_selection(async (controller) => {
    await controller.add_files(loose_files());
    const previous_selection = controller.active;
    const expected = await describe_local_map(previous_selection, engine_hash);
    const incompatible_imports = [
      { reason: 'wrong difficulty', files: loose_files(map_text(40_000)) },
      { reason: 'edited map bytes', files: loose_files(map_text() + '\n') },
      {
        reason: 'changed music bytes',
        files: loose_files(map_text(), new Uint8Array([4, 3, 2, 1])),
      },
      { reason: 'missing music', files: [new File([map_text()], 'selected.osu')] },
    ];
    for (const incompatible_import of incompatible_imports) {
      await controller.add_files(incompatible_import.files, {
        choose_map: (source) => matching_filename(source, expected),
        validate: async (candidate) => {
          const candidate_map = await describe_local_map(candidate, engine_hash);
          require_matching_map(candidate_map, expected);
        },
      });
      expect(controller.error, incompatible_import.reason).toBeTruthy();
      expect(controller.active, incompatible_import.reason).toBe(previous_selection);
    }
    expect(() =>
      require_matching_map({ ...expected, engine_hash: 'd'.repeat(64) }, expected),
    ).toThrow(/engine/);
    await controller.add_files(loose_files(map_text(1500).replace('8000', '500')));
    expect((await describe_local_map(controller.active, engine_hash)).end_ms).toBe(1500);
  });
});

test('guest matching locates the host difficulty across the whole session library', async () => {
  await with_selection(async (controller) => {
    // The first import lacks the host's pick; the second one carries it, so
    // the match lives outside the active set.
    await controller.add_files(loose_files(map_text(40_000)));
    const archive = zipSync(
      {
        'deep/matching.osu': strToU8(map_text()),
        'deep/music.wav': music_bytes,
      },
      { level: 9 },
    );
    await controller.add_files([new File([archive], 'repacked.osz')]);
    const host_set = controller.loaded_sets[1];
    const host_map_bytes = await host_set.source.read('deep/matching.osu');
    const host_music_bytes = await host_set.source.read('deep/music.wav');
    const expected = {
      map_hash: await hash_bytes(host_map_bytes),
      music_hash: await hash_bytes(host_music_bytes),
      engine_hash,
      end_ms: 95_000,
    };
    const match = await controller.find_map_by_hash(hash_bytes, expected.map_hash);
    expect(match).toEqual({ set_id: host_set.set_id, filename: 'deep/matching.osu' });
    await controller.select_map(match.set_id, match.filename);
    require_matching_map(await describe_local_map(controller.active, engine_hash), expected);
    // An unknown hash matches nothing without touching the selection.
    expect(await controller.find_map_by_hash(hash_bytes, '7'.repeat(64))).toBeNull();
  });
});
