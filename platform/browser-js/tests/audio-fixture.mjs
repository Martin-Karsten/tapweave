export function audio_context_fixture() {
  const sources = [];
  const calls = [];
  const parameter = () => ({
    setValueAtTime: (...arguments_) => calls.push(['set', ...arguments_]),
    cancelScheduledValues: (...arguments_) => calls.push(['cancel', ...arguments_]),
    linearRampToValueAtTime: (...arguments_) => calls.push(['ramp', ...arguments_]),
  });
  const node = () => ({ connect(destination) { this.destination = destination; }, disconnect() { this.disconnected = true; } });
  return { currentTime: 10, state: 'running', destination: {}, sources, calls,
    async resume() { this.state = 'running'; },
    createBufferSource() {
      const source = { ...node(), playbackRate: parameter(),
        start(...arguments_) { calls.push(['start', ...arguments_]); },
        stop(...arguments_) { calls.push(['stop', ...arguments_]); },
      };
      sources.push(source);
      return source;
    },
    createGain: () => ({ ...node(), gain: parameter() }),
    createStereoPanner: () => ({ ...node(), pan: parameter() }),
    createBuffer(channels, length, sampleRate) {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { length, numberOfChannels: channels, duration: length / sampleRate, sampleRate,
        getChannelData: channel_index => data[channel_index] };
    },
  };
}
