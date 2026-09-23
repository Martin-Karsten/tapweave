import { expect, it, vi } from 'vitest';
import { create_welcome_buffer, Welcome_Music } from '../src/services/welcome_music';

function audio_fixture(state = 'running') {
  const parameter = { value: 0.65, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() };
  const source = { buffer: null, loop: false, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), onended: null as (() => void) | null };
  const gain = { gain: parameter, connect: vi.fn(), disconnect: vi.fn() };
  const context = { state, currentTime: 0, resume: vi.fn(() => Promise.resolve()),
    createGain: () => gain, createBufferSource: () => source,
    createBuffer: (_channels: number, length: number, sample_rate: number) => {
      const samples = new Float32Array(length);
      return { duration: length / sample_rate, getChannelData: () => samples };
    } };
  return { context: context as unknown as AudioContext, source, gain, resume: context.resume };
}

it('renders an audible bounded loop with continuous wraparound and no external assets', () => {
  const { context } = audio_fixture();
  const buffer = create_welcome_buffer(context);
  const samples = buffer.getChannelData(0);
  let peak = 0;
  let energy = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
  }
  expect(buffer.duration).toBe(19.2);
  expect(peak).toBeLessThan(1);
  expect(Math.sqrt(energy / samples.length)).toBeGreaterThan(0.025);
  expect(Math.abs(samples[0] - samples[samples.length - 1])).toBeLessThan(0.02);
});

it('starts on the shared destination, retries blocked autoplay on gestures, and retires permanently', () => {
  const { context, source, gain, resume } = audio_fixture('suspended');
  const gestures = new EventTarget();
  const destination = {} as AudioNode;
  const welcome = new Welcome_Music(context, destination, gestures);
  expect(source.loop).toBe(true);
  expect(source.start).toHaveBeenCalledTimes(1);
  expect(gain.connect).toHaveBeenCalledWith(destination);
  gestures.dispatchEvent(new Event('pointerdown'));
  expect(resume).toHaveBeenCalledTimes(2);
  welcome.stop();
  welcome.stop();
  gestures.dispatchEvent(new Event('keydown'));
  expect(resume).toHaveBeenCalledTimes(2);
  expect(source.stop).toHaveBeenCalledExactlyOnceWith(0.4);
  source.onended?.();
  expect(source.buffer).toBeNull();
  expect(gain.disconnect).toHaveBeenCalledTimes(1);
});
