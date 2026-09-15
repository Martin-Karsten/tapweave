// Developer-workspace synthetic audio context: an explicitly injected clock
// with optional fault injection. It exists only for debug scenarios; the player
// always uses a real AudioContext. Node scenario tests reuse it because it has
// no DOM dependency.
export interface Synthetic_Context_Faults {
  reject_resume?: boolean;
  suspend_after_resume?: boolean;
  fail_next_buffer_source?: boolean;
}

export interface Synthetic_Context_Observations {
  starts: number[];
  stops: number[];
  connections: number;
}

export interface Synthetic_Audio_Context {
  context: AudioContext;
  faults: Synthetic_Context_Faults;
  observations: Synthetic_Context_Observations;
  advance(seconds: number): void;
  set_state(state: AudioContextState): void;
}

const build_parameter = (observations: Synthetic_Context_Observations) => ({
  setValueAtTime(...arguments_: number[]) { observations.connections++; },
  cancelScheduledValues() {},
  linearRampToValueAtTime() {},
});

export function create_synthetic_context(initial_seconds = 0): Synthetic_Audio_Context {
  const sources: { disconnect(): void; onended: (() => void) | null; stop(...arguments_: number[]): void;
    start(...arguments_: number[]): void; playbackRate: object; buffer: unknown }[] = [];
  const observations: Synthetic_Context_Observations = { starts: [], stops: [], connections: 0 };
  const faults: Synthetic_Context_Faults = {};
  const node = () => ({ connect() { observations.connections++; }, disconnect() {} });
  const context_state = { current: 'suspended' as string };
  const context = {
    currentTime: initial_seconds,
    get state() { return context_state.current; },
    set state(value: string) { context_state.current = value; },
    sampleRate: 48000,
    baseLatency: 0.005,
    outputLatency: 0.01,
    destination: {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
    async resume() {
      if (faults.reject_resume) throw new Error('Synthetic audio start rejected.');
      context_state.current = faults.suspend_after_resume ? 'suspended' : 'running';
    },
    async close() { context_state.current = 'closed'; },
    createBufferSource() {
      if (faults.fail_next_buffer_source) {
        faults.fail_next_buffer_source = false;
        throw new Error('Synthetic buffer source dispatch failure.');
      }
      const source = { ...node(), onended: null as (() => void) | null, buffer: null as unknown,
        playbackRate: build_parameter(observations),
        start(...arguments_: number[]) { observations.starts.push(arguments_[0] ?? 0); sources.push(source as never); },
        stop(...arguments_: number[]) { observations.stops.push(arguments_[0] ?? 0); } };
      return source;
    },
    createGain: () => ({ ...node(), gain: build_parameter(observations) }),
    createStereoPanner: () => ({ ...node(), pan: build_parameter(observations) }),
    createBuffer(channel_count: number, length: number, sample_rate: number) {
      const data = Array.from({ length: channel_count }, () => new Float32Array(length));
      return { length, numberOfChannels: channel_count, duration: length / sample_rate, sample_rate,
        getChannelData: (channel_index: number) => data[channel_index] };
    },
  } as unknown as AudioContext;
  const context_object = context as unknown as { currentTime: number };
  return {
    context, faults, observations,
    advance(seconds: number) { context_object.currentTime += seconds; },
    set_state(state: AudioContextState) { context_state.current = state; },
  };
}
