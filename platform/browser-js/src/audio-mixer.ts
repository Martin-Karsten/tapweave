import type { Player_Settings } from './player-settings.js';

interface Gain_Ramp {
  initial: number;
  target: number;
  started: number;
  ends: number;
}

// Page-owned final output gain. Never changes engine intent or clock anchors.
export class Audio_Mixer {
  readonly music: GainNode;
  readonly effects: GainNode;
  private music_ramp: Gain_Ramp;
  private effects_ramp: Gain_Ramp;
  private disposed = false;

  constructor(readonly context: AudioContext, settings: Player_Settings) {
    this.music = context.createGain();
    let effects: GainNode | null = null;
    try {
      effects = context.createGain();
      this.effects = effects;
      this.music.gain.setValueAtTime(settings.music_volume / 100, context.currentTime);
      this.effects.gain.setValueAtTime(settings.effects_volume / 100, context.currentTime);
      this.music.connect(context.destination);
      this.effects.connect(context.destination);
    } catch (error) {
      this.music.disconnect();
      effects?.disconnect();
      throw error;
    }
    this.music_ramp = this.initial_ramp(settings.music_volume / 100);
    this.effects_ramp = this.initial_ramp(settings.effects_volume / 100);
  }

  private initial_ramp(amplitude: number): Gain_Ramp {
    return { initial: amplitude, target: amplitude, started: this.context.currentTime, ends: this.context.currentTime };
  }

  update(settings: Player_Settings): void {
    if (this.disposed) return;
    this.smooth(this.music.gain, this.music_ramp, settings.music_volume / 100);
    this.smooth(this.effects.gain, this.effects_ramp, settings.effects_volume / 100);
  }

  private smooth(parameter: AudioParam, ramp: Gain_Ramp, target: number): void {
    if (target === ramp.target) return;
    const now = this.context.currentTime;
    const progress = ramp.ends <= now ? 1 : (now - ramp.started) / (ramp.ends - ramp.started);
    const amplitude = ramp.initial + (ramp.target - ramp.initial) * progress;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(amplitude, now);
    parameter.linearRampToValueAtTime(target, now + 0.020);
    Object.assign(ramp, { initial: amplitude, target, started: now, ends: now + 0.020 });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.music.disconnect();
    this.effects.disconnect();
  }
}
