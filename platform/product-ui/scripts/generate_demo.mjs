// Deterministic generator for the original Tapweave demo beatmap (MVP player
// experience, "Original demo"): an approximately 75-second beginner map with
// original synthesized music and no third-party material. The map layout and
// the music arrangement are authored here as explicit constants; running the
// generator twice produces byte-identical output, verified against the
// tracked scripts/demo/manifest.json by `npm run prepare-assets` and the
// vitest suite. Generated archives are never committed (public/ is ignored).
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

export const DEMO_OSU_FILENAME = 'tapweave-demo.osu';
export const DEMO_MUSIC_FILENAME = 'tapweave-demo.wav';
export const DEMO_ARCHIVE_FILENAME = 'tapweave-demo.osz';

export const DEMO_MAP_TITLE = 'Tapweave Demo';
export const DEMO_MAP_ARTIST = 'Tapweave';
export const DEMO_MAP_CREATOR = 'Tapweave';
export const DEMO_MAP_VERSION = 'Beginner';

// Spec constants (mvp-player-experience.md): ~75 s total, 100 BPM, >=4 s
// before the first object, CS4/AR4/OD3/HP2, circles -> sliders -> one
// generous spinner.
const MUSIC_TOTAL_SECONDS = 75;
const MUSIC_SAMPLE_RATE = 22050;
const BEAT_SECONDS = 0.6;
const BAR_SECONDS = 2.4;
// Integer millisecond twins of the beat/bar lengths keep object timestamps
// exact (floating-point drift would produce 15599.999… times).
const CIRCLE_STEP_MS = 1200;
const BAR_MS = 2400;
const FIRST_OBJECT_MS = 4800;
const SLIDER_SECTION_START_MS = 24000;
const CLOSING_SECTION_START_MS = 48000;
const SPINNER_START_MS = 60000;
const SPINNER_END_MS = 70800;
const GROOVE_START_SECONDS = 4.8;
const GROOVE_END_SECONDS = SPINNER_END_MS / 1000;
// Fixed ZIP timestamp keeps the archive byte-stable across runs.
const DEMO_ARCHIVE_MTIME = Date.UTC(2026, 0, 1);

// Circle positions: hand-authored, each at least ~160 px from the previous
// one (CS4 diameter is ~73 px, so even generous spacing stays readable).
const DEMO_CIRCLES = [
  { x: 136, y: 120 }, { x: 376, y: 264 }, { x: 152, y: 304 }, { x: 408, y: 112 },
  { x: 120, y: 216 }, { x: 312, y: 80 }, { x: 428, y: 280 }, { x: 168, y: 80 },
  { x: 344, y: 176 }, { x: 96, y: 304 }, { x: 280, y: 216 }, { x: 432, y: 72 },
  { x: 120, y: 120 }, { x: 320, y: 312 }, { x: 216, y: 176 }, { x: 384, y: 192 },
];

// Slider rows: one per bar, linear, 1.5 beats (210 px at SliderMultiplier 1.4
// and 600 ms beats), each starting a new combo.
const DEMO_SLIDERS = [
  { x: 136, y: 120, end_x: 346, end_y: 120 },
  { x: 376, y: 264, end_x: 166, end_y: 264 },
  { x: 152, y: 304, end_x: 152, end_y: 94 },
  { x: 408, y: 112, end_x: 408, end_y: 322 },
  { x: 120, y: 216, end_x: 330, end_y: 216 },
  { x: 312, y: 80, end_x: 102, end_y: 80 },
  { x: 428, y: 280, end_x: 218, end_y: 280 },
  { x: 168, y: 80, end_x: 168, end_y: 290 },
  { x: 344, y: 176, end_x: 134, end_y: 176 },
  { x: 96, y: 304, end_x: 306, end_y: 304 },
];

// Closing section: circles and two-beat (280 px) sliders interleaved.
const DEMO_CLOSING_CIRCLE_A = { x: 296, y: 120 };
const DEMO_CLOSING_SLIDER_A = { x: 136, y: 240, end_x: 346, end_y: 240 };
const DEMO_CLOSING_CIRCLE_B = { x: 400, y: 96 };
const DEMO_CLOSING_SLIDER_B = { x: 160, y: 304, end_x: 370, end_y: 304 };
const DEMO_CLOSING_CIRCLE_C = { x: 232, y: 176 };

const SLIDER_LENGTH_BEATS_ONE_AND_A_HALF = 210;
const SLIDER_LENGTH_BEATS_TWO = 280;

// Music arrangement: one chord per 2.4 s bar cycling Am-F-C-G, voiced close
// together; the bass doubles the root two octaves down and the arp cycles
// chord tones one octave up. Everything is sine-additive with exponential
// envelopes; the only "noise" is a seeded LCG for the hats.
const midi_frequency = (midi_note) => 440 * 2 ** ((midi_note - 69) / 12);

const CHORD_PAD_VOICINGS = [
  [57, 60, 64], // A minor: A3 C4 E4
  [53, 57, 60], // F major: F3 A3 C4
  [55, 60, 64], // C major (inversion): G3 C4 E4
  [55, 59, 62], // G major: G3 B3 D4
];
const CHORD_BASS_ROOTS = [45, 41, 48, 43]; // A2, F2, C3, G2

const HAT_NOISE_SEED = 0x2a7f_9c31;
const HAT_NOISE_MULTIPLIER = 0x41c6_4e6d;
const HAT_NOISE_MODULUS = 0x8000_0000_0000;

const render_demo_music = () => {
  const total_samples = Math.round(MUSIC_TOTAL_SECONDS * MUSIC_SAMPLE_RATE);
  const mix = new Float64Array(total_samples);
  const noise_state = { value: HAT_NOISE_SEED };
  const next_noise = () => {
    noise_state.value = (noise_state.value * HAT_NOISE_MULTIPLIER) % HAT_NOISE_MODULUS;
    // Center the LCG output and keep the top bits so the hat stays bright.
    return ((noise_state.value / HAT_NOISE_MODULUS) * 2 - 1) * 0.8;
  };

  // One voice render helper: adds `voice_sample(t)` over [start, end).
  const add_voice = (start_seconds, end_seconds, voice_sample) => {
    const first_sample = Math.max(0, Math.floor(start_seconds * MUSIC_SAMPLE_RATE));
    const last_sample = Math.min(total_samples, Math.ceil(end_seconds * MUSIC_SAMPLE_RATE));
    for (let sample_index = first_sample; sample_index < last_sample; sample_index += 1) {
      mix[sample_index] += voice_sample(sample_index / MUSIC_SAMPLE_RATE - start_seconds);
    }
  };

  // Pads: each bar holds its chord with a soft attack, a 0.7 Hz detune shimmer
  // and a release into the next bar. The final bars (past the spinner) are the
  // outro: the groove stops and the last chord rings out to the fade.
  const bar_count = Math.ceil(MUSIC_TOTAL_SECONDS / BAR_SECONDS);
  for (let bar_index = 0; bar_index < bar_count; bar_index += 1) {
    const bar_start = bar_index * BAR_SECONDS;
    const voicing = CHORD_PAD_VOICINGS[bar_index % CHORD_PAD_VOICINGS.length];
    for (const midi_note of voicing) {
      const frequency = midi_frequency(midi_note);
      add_voice(bar_start, bar_start + BAR_SECONDS + 0.3, (elapsed) => {
        const attack = Math.min(1, elapsed / 0.4);
        const release = Math.exp(-Math.max(0, elapsed - BAR_SECONDS) / 0.25);
        const amplitude = attack * release * 0.075;
        return amplitude * (Math.sin(2 * Math.PI * frequency * elapsed) +
          0.28 * Math.sin(2 * Math.PI * (frequency + 0.7) * elapsed));
      });
    }
  }

  // Bass: the chord root, plucked on beats 1 and 3 of every bar.
  for (let bar_index = 0; bar_index < bar_count; bar_index += 1) {
    const bar_start = bar_index * BAR_SECONDS;
    const root_frequency = midi_frequency(CHORD_BASS_ROOTS[bar_index % CHORD_BASS_ROOTS.length]);
    for (const beat_offset of [0, 2 * BEAT_SECONDS]) {
      add_voice(bar_start + beat_offset, bar_start + beat_offset + 0.6, (elapsed) => {
        const amplitude = Math.exp(-elapsed / 0.38) * 0.2;
        return amplitude * Math.sin(2 * Math.PI * root_frequency * elapsed);
      });
    }
  }

  // Arp: chord tones one octave up, eighth notes; joins one bar before the
  // first object and stops with the groove at the spinner end.
  const arp_note_seconds = BEAT_SECONDS / 2;
  for (let arp_time = BAR_SECONDS; arp_time < GROOVE_END_SECONDS; arp_time += arp_note_seconds) {
    const bar_index = Math.floor(arp_time / BAR_SECONDS);
    const voicing = CHORD_PAD_VOICINGS[bar_index % CHORD_PAD_VOICINGS.length];
    const pattern = [voicing[0] + 12, voicing[1] + 12, voicing[2] + 12, voicing[1] + 12];
    const note_index = Math.floor(arp_time / arp_note_seconds) % pattern.length;
    const frequency = midi_frequency(pattern[note_index]);
    add_voice(arp_time, arp_time + 0.4, (elapsed) => {
      const amplitude = Math.exp(-elapsed / 0.16) * 0.11;
      return amplitude * (Math.sin(2 * Math.PI * frequency * elapsed) +
        0.35 * Math.sin(2 * Math.PI * frequency * 2 * elapsed) +
        0.18 * Math.sin(2 * Math.PI * frequency * 3 * elapsed));
    });
  }

  // Kick: a swept sine on every beat while the groove runs. The sweep
  // 110 Hz -> 45 Hz has a closed-form phase integral.
  const kick_sweep_tau = 0.045;
  for (let kick_time = GROOVE_START_SECONDS; kick_time < GROOVE_END_SECONDS; kick_time += BEAT_SECONDS) {
    add_voice(kick_time, kick_time + 0.35, (elapsed) => {
      const phase = 2 * Math.PI * (45 * elapsed + 65 * kick_sweep_tau * (1 - Math.exp(-elapsed / kick_sweep_tau)));
      return Math.exp(-elapsed / 0.22) * 0.45 * Math.sin(phase);
    });
  }

  // Hats: seeded noise bursts on the off-beats, one-pole high-passed. The
  // filter keeps its own previous raw sample, so each burst is rendered with
  // an explicit closure instead of the shared helpers.
  const high_passed_noise_burst = (burst_start) => {
    let previous_raw_sample = 0;
    add_voice(burst_start, burst_start + 0.06, (elapsed) => {
      const raw_sample = next_noise();
      const filtered_sample = raw_sample - previous_raw_sample * 0.92;
      previous_raw_sample = raw_sample;
      return Math.exp(-elapsed / 0.025) * 0.09 * filtered_sample;
    });
  };
  for (let hat_time = 2 * BAR_SECONDS; hat_time < GROOVE_END_SECONDS; hat_time += BEAT_SECONDS) {
    high_passed_noise_burst(hat_time + arp_note_seconds / 2);
  }

  // Normalize to a fixed peak, then shape the final 0.4 s with a linear fade
  // so the clipped last bar ends without a click.
  let peak = 0;
  for (const sample of mix) {
    peak = Math.max(peak, Math.abs(sample));
  }
  const normalize_scale = peak > 0 ? 0.85 / peak : 0;
  const fade_start_sample = total_samples - Math.round(0.4 * MUSIC_SAMPLE_RATE);
  const wav_bytes = Buffer.alloc(44 + total_samples * 2);
  for (let sample_index = 0; sample_index < total_samples; sample_index += 1) {
    let shaped = mix[sample_index] * normalize_scale;
    if (sample_index >= fade_start_sample) {
      shaped *= (total_samples - sample_index) / (total_samples - fade_start_sample);
    }
    wav_bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(shaped * 32767))), 44 + sample_index * 2);
  }

  wav_bytes.write('RIFF', 0);
  wav_bytes.writeUInt32LE(36 + total_samples * 2, 4);
  wav_bytes.write('WAVEfmt ', 8);
  wav_bytes.writeUInt32LE(16, 16);
  wav_bytes.writeUInt16LE(1, 20); // PCM
  wav_bytes.writeUInt16LE(1, 22); // mono
  wav_bytes.writeUInt32LE(MUSIC_SAMPLE_RATE, 24);
  wav_bytes.writeUInt32LE(MUSIC_SAMPLE_RATE * 2, 28); // bytes per second
  wav_bytes.writeUInt16LE(2, 32); // block align
  wav_bytes.writeUInt16LE(16, 34); // bits per sample
  wav_bytes.write('data', 36);
  wav_bytes.writeUInt32LE(total_samples * 2, 40);
  return new Uint8Array(wav_bytes);
};

const render_demo_osu = () => {
  const hit_object_lines = [];
  // Circles: one every two beats; every fourth starts a combo.
  DEMO_CIRCLES.forEach((circle, circle_index) => {
    const time = FIRST_OBJECT_MS + circle_index * CIRCLE_STEP_MS;
    const type = circle_index % 4 === 0 ? 5 : 1;
    hit_object_lines.push(`${circle.x},${circle.y},${time},${type},0`);
  });
  // Sliders: one per bar.
  DEMO_SLIDERS.forEach((slider, slider_index) => {
    const time = SLIDER_SECTION_START_MS + slider_index * BAR_MS;
    hit_object_lines.push(`${slider.x},${slider.y},${time},6,0,L|${slider.end_x}:${slider.end_y},1,${SLIDER_LENGTH_BEATS_ONE_AND_A_HALF}`);
  });
  // Closing interlude: circle, two-beat slider, circle, slider, circle.
  hit_object_lines.push(`${DEMO_CLOSING_CIRCLE_A.x},${DEMO_CLOSING_CIRCLE_A.y},${CLOSING_SECTION_START_MS},1,0`);
  hit_object_lines.push(`${DEMO_CLOSING_SLIDER_A.x},${DEMO_CLOSING_SLIDER_A.y},${CLOSING_SECTION_START_MS + BAR_MS},6,0,L|${DEMO_CLOSING_SLIDER_A.end_x}:${DEMO_CLOSING_SLIDER_A.end_y},1,${SLIDER_LENGTH_BEATS_TWO}`);
  hit_object_lines.push(`${DEMO_CLOSING_CIRCLE_B.x},${DEMO_CLOSING_CIRCLE_B.y},${CLOSING_SECTION_START_MS + 2 * BAR_MS},1,0`);
  hit_object_lines.push(`${DEMO_CLOSING_SLIDER_B.x},${DEMO_CLOSING_SLIDER_B.y},${CLOSING_SECTION_START_MS + 3 * BAR_MS},6,0,L|${DEMO_CLOSING_SLIDER_B.end_x}:${DEMO_CLOSING_SLIDER_B.end_y},1,${SLIDER_LENGTH_BEATS_TWO}`);
  hit_object_lines.push(`${DEMO_CLOSING_CIRCLE_C.x},${DEMO_CLOSING_CIRCLE_C.y},${CLOSING_SECTION_START_MS + 4 * BAR_MS},1,0`);
  // One generous spinner.
  hit_object_lines.push(`256,192,${SPINNER_START_MS},12,0,${SPINNER_END_MS}`);

  return `osu file format v14

[General]
AudioFilename: ${DEMO_MUSIC_FILENAME}

[Metadata]
Title:${DEMO_MAP_TITLE}
Artist:${DEMO_MAP_ARTIST}
Creator:${DEMO_MAP_CREATOR}
Version:${DEMO_MAP_VERSION}

[Difficulty]
HPDrainRate:2
CircleSize:4
OverallDifficulty:3
ApproachRate:4
SliderMultiplier:1.4
SliderTickRate:1

[TimingPoints]
0,600,4,1,1,60,1,0

[HitObjects]
${hit_object_lines.join('\n')}
`;
};

export const generate_demo_parts = () => {
  const osu_text = render_demo_osu();
  const music_bytes = render_demo_music();
  const osz_bytes = zipSync(
    { [DEMO_OSU_FILENAME]: strToU8(osu_text), [DEMO_MUSIC_FILENAME]: music_bytes },
    { level: 6, mtime: DEMO_ARCHIVE_MTIME },
  );
  return { osu_text, music_bytes, osz_bytes };
};

export const sha256_hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

const manifest_entry = (filename, bytes) => ({
  path: filename,
  sha256: sha256_hex(bytes),
  bytes: bytes.byteLength,
});

export const demo_manifest_entries = (parts) => [
  manifest_entry(DEMO_OSU_FILENAME, new TextEncoder().encode(parts.osu_text)),
  manifest_entry(DEMO_MUSIC_FILENAME, parts.music_bytes),
  manifest_entry(DEMO_ARCHIVE_FILENAME, parts.osz_bytes),
];

// Asset preparation entry point: generate, verify against the tracked
// manifest, and publish the archive under public/demo/.
export const write_demo_assets = async (public_demo_directory, { update_manifest = false } = {}) => {
  const manifest_url = new URL('demo/manifest.json', import.meta.url);
  const parts = generate_demo_parts();
  const entries = demo_manifest_entries(parts);

  if (update_manifest) {
    await mkdir(new URL('./', manifest_url), { recursive: true });
    await writeFile(manifest_url, JSON.stringify({ schema_version: 1, outputs: entries }, null, 2) + '\n');
  } else {
    const manifest = JSON.parse(await readFile(manifest_url, 'utf8'));
    for (const entry of entries) {
      const recorded = manifest.outputs.find((candidate) => candidate.path === entry.path);
      if (!recorded || recorded.sha256 !== entry.sha256 || recorded.bytes !== entry.bytes) {
        throw new Error(`demo output "${entry.path}" does not match scripts/demo/manifest.json; ` +
          'if the change is intentional, regenerate with `node scripts/generate_demo.mjs --update-manifest`');
      }
    }
  }

  await mkdir(public_demo_directory, { recursive: true });
  const archive_url = new URL(DEMO_ARCHIVE_FILENAME, public_demo_directory);
  await writeFile(archive_url, parts.osz_bytes);
  return fileURLToPath(archive_url);
};

// CLI: default generates into public/demo and verifies the manifest;
// --update-manifest rewrites it after an intentional demo change.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const update_manifest = process.argv.includes('--update-manifest');
  const published_path = await write_demo_assets(new URL('../public/demo/', import.meta.url), { update_manifest });
  console.log(`Product demo: ${published_path}${update_manifest ? ' (manifest updated)' : ' (manifest verified)'}`);
}
