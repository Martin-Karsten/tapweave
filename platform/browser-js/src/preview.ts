// Menu-scoped music preview: a looping buffer source on the shared audio
// context, started at the beatmap's preview point. This is deliberately not a
// gameplay audio path — it owns no voices from the engine's audio protocol,
// never participates in judgement, and routes through the product mixer's
// music destination so volume settings apply.

const PREVIEW_FADE_SECONDS = 0.2;
const PREVIEW_GAIN = 0.4;

export class Music_Preview {
  private context: AudioContext;
  private destination: AudioNode;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;

  constructor(context: AudioContext, destination: AudioNode) {
    this.context = context;
    this.destination = destination;
  }

  // Returns false when the browser would not start audio (suspended context
  // that user activation could not resume); callers treat that as silence.
  async start(buffer: AudioBuffer, preview_time_ms: number): Promise<boolean> {
    this.stop();
    if (this.context.state === 'suspended') {
      try {
        await this.context.resume();
      } catch {
        return false;
      }
    }
    if (this.context.state !== 'running') {
      return false;
    }
    const start_seconds = preview_time_ms >= 0 && preview_time_ms / 1000 < buffer.duration ?
      preview_time_ms / 1000 : 0;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = start_seconds;
    source.loopEnd = buffer.duration;
    const gain = this.context.createGain();
    const now_seconds = this.context.currentTime;
    gain.gain.setValueAtTime(0, now_seconds);
    gain.gain.linearRampToValueAtTime(PREVIEW_GAIN, now_seconds + PREVIEW_FADE_SECONDS);
    source.connect(gain);
    gain.connect(this.destination);
    source.start(now_seconds, start_seconds);
    this.source = source;
    this.gain = gain;
    return true;
  }

  // Fades out briefly so stopping never clicks; safe to call repeatedly.
  stop() {
    const source = this.source;
    const gain = this.gain;
    this.source = null;
    this.gain = null;
    if (!source || !gain) {
      return;
    }
    const now_seconds = this.context.currentTime;
    try {
      gain.gain.cancelScheduledValues(now_seconds);
      gain.gain.setValueAtTime(gain.gain.value, now_seconds);
      gain.gain.linearRampToValueAtTime(0, now_seconds + PREVIEW_FADE_SECONDS);
      source.stop(now_seconds + PREVIEW_FADE_SECONDS);
    } catch {
      source.disconnect();
      gain.disconnect();
    }
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
  }
}
