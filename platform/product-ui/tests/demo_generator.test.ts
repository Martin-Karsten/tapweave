import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import manifest from '../scripts/demo/manifest.json';
import {
  DEMO_ARCHIVE_FILENAME,
  DEMO_MAP_ARTIST,
  DEMO_MAP_CREATOR,
  DEMO_MAP_TITLE,
  DEMO_MAP_VERSION,
  DEMO_MUSIC_FILENAME,
  DEMO_OSU_FILENAME,
  generate_demo_parts,
} from '../scripts/generate_demo.mjs';

const CIRCLE_MINIMUM_SPACING = 160;
const PLAYFIELD_WIDTH = 512;
const PLAYFIELD_HEIGHT = 384;
const MUSIC_SAMPLE_RATE = 22050;

const sha256_hex = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

interface Demo_Object {
  readonly x: number;
  readonly y: number;
  readonly time_ms: number;
  readonly type: number;
  readonly end_time_ms: number;
  readonly length: number;
}

const parse_objects = (osu_text: string): Demo_Object[] => {
  const hit_objects_section = osu_text.split('[HitObjects]')[1] ?? '';
  return hit_objects_section.trim().split('\n').filter(line => line !== '').map((line) => {
    const fields = line.split(',');
    const type = Number(fields[3]);
    return {
      x: Number(fields[0]),
      y: Number(fields[1]),
      time_ms: Number(fields[2]),
      type,
      // Spinner rows carry the end time in the sixth field; everything else
      // ends at its start.
      end_time_ms: (type & 8) !== 0 ? Number(fields[5]) : Number(fields[2]),
      length: fields[7] !== undefined ? Number(fields[7]) : 0,
    };
  });
};

describe('demo generator output', () => {
  const parts = generate_demo_parts();
  const objects = parse_objects(parts.osu_text);
  const circles = objects.filter(object => (object.type & 1) !== 0 && (object.type & 2) === 0 && (object.type & 8) === 0);
  const sliders = objects.filter(object => (object.type & 2) !== 0);
  const spinners = objects.filter(object => (object.type & 8) !== 0);

  it('declares the spec difficulty and metadata', () => {
    expect(parts.osu_text).toContain('osu file format v14');
    expect(parts.osu_text).toContain(`AudioFilename: ${DEMO_MUSIC_FILENAME}`);
    expect(parts.osu_text).toContain('HPDrainRate:2');
    expect(parts.osu_text).toContain('CircleSize:4');
    expect(parts.osu_text).toContain('OverallDifficulty:3');
    expect(parts.osu_text).toContain('ApproachRate:4');
    expect(parts.osu_text).toContain(`Title:${DEMO_MAP_TITLE}`);
    expect(parts.osu_text).toContain(`Artist:${DEMO_MAP_ARTIST}`);
    expect(parts.osu_text).toContain(`Creator:${DEMO_MAP_CREATOR}`);
    expect(parts.osu_text).toContain(`Version:${DEMO_MAP_VERSION}`);
  });

  it('leaves at least four seconds before the first object and ends on one generous spinner', () => {
    expect(objects[0]!.time_ms).toBeGreaterThanOrEqual(4000);
    expect(spinners).toHaveLength(1);
    expect(spinners[0]!.time_ms).toBe(60000);
    expect(spinners[0]!.end_time_ms).toBe(70800);
    // Approximately 75 s overall: the outro plays out past the last object.
    expect(spinners[0]!.end_time_ms).toBeLessThan(75000);
  });

  it('builds the beginner shape: spacious circles, then sliders, then a closing interlude', () => {
    expect(circles).toHaveLength(19);
    expect(sliders).toHaveLength(12);
    expect(objects).toHaveLength(32);
    const times = objects.map(object => object.time_ms);
    const sorted_times = [...times].sort((left, right) => left - right);
    expect(times).toEqual(sorted_times);
    for (const object of objects) {
      expect(object.x).toBeGreaterThanOrEqual(0);
      expect(object.x).toBeLessThanOrEqual(PLAYFIELD_WIDTH);
      expect(object.y).toBeGreaterThanOrEqual(0);
      expect(object.y).toBeLessThanOrEqual(PLAYFIELD_HEIGHT);
    }
    // Spacing is a readability property of consecutive circles close in
    // time; circles across section boundaries are many seconds apart.
    for (let circle_index = 1; circle_index < circles.length; circle_index += 1) {
      const previous = circles[circle_index - 1]!;
      const current = circles[circle_index]!;
      if (current.time_ms - previous.time_ms > 1500) continue;
      const spacing = Math.hypot(current.x - previous.x, current.y - previous.y);
      expect(spacing).toBeGreaterThanOrEqual(CIRCLE_MINIMUM_SPACING);
    }
    for (const slider of sliders) {
      expect(slider.length).toBeGreaterThan(0);
    }
  });

  it('synthesizes 75 seconds of PCM16 mono WAV', () => {
    const wav = parts.music_bytes;
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE');
    const sample_rate = wav[24]! | (wav[25]! << 8) | (wav[26]! << 16) | (wav[27]! << 24);
    expect(sample_rate).toBe(MUSIC_SAMPLE_RATE);
    const data_bytes = wav[40]! | (wav[41]! << 8) | (wav[42]! << 16) | (wav[43]! << 24);
    expect(data_bytes).toBe(Math.round(75 * MUSIC_SAMPLE_RATE) * 2);
    expect(wav.byteLength).toBe(44 + data_bytes);
  });

  it('packages the beatmap and music into the archive the shell fetches', { timeout: 30000 }, () => {
    const entries = unzipSync(parts.osz_bytes);
    expect(Object.keys(entries).sort()).toEqual([DEMO_MUSIC_FILENAME, DEMO_OSU_FILENAME].sort());
    expect(strFromU8(entries[DEMO_OSU_FILENAME]!)).toBe(parts.osu_text);
    expect(entries[DEMO_MUSIC_FILENAME]).toEqual(parts.music_bytes);
  });

  it('is deterministic and matches the tracked manifest', { timeout: 60000 }, async () => {
    const regenerated = generate_demo_parts();
    expect(regenerated.osz_bytes).toEqual(parts.osz_bytes);
    expect(regenerated.music_bytes).toEqual(parts.music_bytes);
    expect(regenerated.osu_text).toBe(parts.osu_text);

    const generated_bytes: Record<string, Uint8Array<ArrayBuffer>> = {
      [DEMO_OSU_FILENAME]: new Uint8Array(new TextEncoder().encode(parts.osu_text)),
      [DEMO_MUSIC_FILENAME]: parts.music_bytes,
      [DEMO_ARCHIVE_FILENAME]: parts.osz_bytes,
    };
    expect(manifest.outputs).toHaveLength(Object.keys(generated_bytes).length);
    for (const recorded of manifest.outputs) {
      const bytes = generated_bytes[recorded.path];
      expect(bytes, `manifest records ${recorded.path}`).toBeDefined();
      expect(recorded.sha256).toBe(await sha256_hex(bytes));
      expect(recorded.bytes).toBe(bytes.byteLength);
    }
  });
});
