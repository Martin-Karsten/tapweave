// Original Tapweave synthesis, MIT. No osu! sound recordings are distributed.
// These are resource assets, with no gameplay timing or sample-selection policy.
const SOUNDS = Object.freeze({
  hitnormal: [660, 0.09], hitwhistle: [1320, 0.16], hitfinish: [220, 0.24],
  hitclap: [440, 0.1], slidertick: [1760, 0.035], sliderslide: [220, 0.1],
  sliderwhistle: [880, 0.1], spinnerspin: [440, 0.1], spinnerbonus: [880, 0.18],
});

export function create_fallback_audio(context) {
  const assets = new Map();
  const sample_rate = 24000;
  for (const [name, [frequency, duration_seconds]] of Object.entries(SOUNDS)) {
    const buffer = context.createBuffer(1, Math.round(sample_rate * duration_seconds), sample_rate);
    const channel = buffer.getChannelData(0);
    const looping = ['sliderslide', 'sliderwhistle', 'spinnerspin'].includes(name);
    for (let sample_index = 0; sample_index < channel.length; sample_index++) {
      const position = sample_index / channel.length;
      const envelope = looping ? 0.12 : Math.min(1, position * 40) * (1 - position) ** 3 * 0.45;
      channel[sample_index] = Math.sin(2 * Math.PI * frequency * sample_index / sample_rate) * envelope;
    }
    // Unbanked final candidates allow missing custom banks to fall through in Odin.
    assets.set(`Gameplay/${name}`, buffer);
  }
  return assets;
}
