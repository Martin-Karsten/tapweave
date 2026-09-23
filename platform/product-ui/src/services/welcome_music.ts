// Original Tapweave composition, MIT licensed with this repository. No samples.
// Eight bars of warm major-seventh chords, bell arpeggios and a soft backbeat.
export function create_welcome_buffer(context: BaseAudioContext): AudioBuffer {
  const sample_rate = 22050;
  const beat_seconds = 0.6;
  const buffer = context.createBuffer(1, Math.round(32 * beat_seconds * sample_rate), sample_rate);
  const samples = buffer.getChannelData(0);
  const chords = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 69]];
  const add_tone = (start: number, duration: number, note: number, amplitude: number, bell = false) => {
    const frequency = 440 * 2 ** ((note - 69) / 12);
    const start_sample = Math.round(start * sample_rate);
    for (let sample_index = 0; sample_index < duration * sample_rate; sample_index++) {
      const seconds = sample_index / sample_rate;
      const envelope = Math.min(1, seconds / 0.025) * Math.min(1, (duration - seconds) / 0.15);
      const phase = 2 * Math.PI * frequency * seconds;
      const tone = Math.sin(phase) + (bell ? 0.25 * Math.sin(phase * 2) : 0.12 * Math.sin(phase * 3));
      samples[(start_sample + sample_index) % samples.length] +=
        amplitude * envelope * (bell ? Math.exp(-seconds * 5) : 1) * tone;
    }
  };
  for (let bar_index = 0; bar_index < 8; bar_index++) {
    const chord = chords[bar_index % chords.length];
    const bar_start = bar_index * 4 * beat_seconds;
    for (const note of chord) add_tone(bar_start, 2.6, note, 0.026);
    for (let beat_index = 0; beat_index < 4; beat_index++) {
      const beat_start = bar_start + beat_index * beat_seconds;
      add_tone(beat_start, 0.4, chord[0] - 24, 0.1);
      for (let half_index = 0; half_index < 2; half_index++) {
        const note = chord[(beat_index * 2 + half_index + bar_index) % chord.length] + 12;
        add_tone(beat_start + half_index * beat_seconds / 2, 0.7, note, 0.065, true);
      }
      const start_sample = Math.round(beat_start * sample_rate);
      for (let sample_index = 0; sample_index < sample_rate * 0.22; sample_index++) {
        const seconds = sample_index / sample_rate;
        const attack = Math.min(1, seconds / 0.003);
        const kick = Math.sin(2 * Math.PI * (48 * seconds + 5 * (1 - Math.exp(-seconds * 30))));
        const hat = Math.sin(2 * Math.PI * 7133 * seconds) * Math.sin(2 * Math.PI * 9341 * seconds);
        samples[(start_sample + sample_index) % samples.length] += attack *
          (0.13 * kick * Math.exp(-seconds * 24) + 0.035 * hat * Math.exp(-seconds * 65));
      }
    }
  }
  return buffer;
}

// Page-owned music: scheduling while suspended lets the first allowed resume
// start the same source. No awaited resume can resurrect retired welcome music.
export class Welcome_Music {
  private source: AudioBufferSourceNode | null;
  private readonly gain: GainNode;
  private readonly unlock = () => {
    if (this.source && this.context.state === 'suspended') {
      void this.context.resume().catch(() => {});
    }
  };

  constructor(private readonly context: AudioContext, destination: AudioNode,
    private readonly gestures: EventTarget = window) {
    this.gain = context.createGain();
    this.gain.gain.setValueAtTime(0, context.currentTime);
    this.gain.gain.linearRampToValueAtTime(0.65, context.currentTime + 0.8);
    this.gain.connect(destination);
    this.source = context.createBufferSource();
    this.source.buffer = create_welcome_buffer(context);
    this.source.loop = true;
    this.source.connect(this.gain);
    this.source.start();
    gestures.addEventListener('pointerdown', this.unlock, true);
    gestures.addEventListener('keydown', this.unlock, true);
    gestures.addEventListener('touchend', this.unlock, true);
    this.unlock();
  }

  stop(): void {
    this.gestures.removeEventListener('pointerdown', this.unlock, true);
    this.gestures.removeEventListener('keydown', this.unlock, true);
    this.gestures.removeEventListener('touchend', this.unlock, true);
    const source = this.source;
    if (!source) return;
    this.source = null;
    const now_seconds = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now_seconds);
    this.gain.gain.setValueAtTime(this.gain.gain.value, now_seconds);
    this.gain.gain.linearRampToValueAtTime(0, now_seconds + 0.4);
    source.onended = () => {
      source.disconnect();
      source.buffer = null;
      this.gain.disconnect();
    };
    source.stop(now_seconds + 0.4);
  }
}
