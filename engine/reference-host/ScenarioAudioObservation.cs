using osu.Framework.Audio.Sample;
using osu.Framework.Bindables;
using osu.Framework.Graphics;
using osu.Framework.Graphics.Textures;
using osu.Game.Audio;
using osu.Game.Skinning;

// The device boundary is a silent test channel. All lookup/play/stop and
// adjustment calls reaching it originate in the real pinned drawable graph.
// Like framework SampleVirtual, it has zero duration; no audible output claimed.
sealed class ScenarioAudioObservation(Func<double> clock) : ISkin, IDisposable
{
    private readonly object synchronization = new();
    private readonly List<object> events = new();
    private readonly List<ObservedSample> samples = new();
    private readonly HashSet<PausableSkinnableSound> observed_sounds = new();
    private long next_voice_id;

    public object[] Snapshot()
    {
        lock (synchronization) return events.ToArray();
    }

    private void record(string command, string name, long voice_id, bool looping, double volume, double pan, double rate)
    {
        lock (synchronization)
            events.Add(new { sequence = events.Count + 1, time_ms = clock(), command, name, voice_id, looping, volume, pan, rate });
    }

    public ISample? GetSample(ISampleInfo sampleInfo)
    {
        // Fixture availability: every first lookup candidate has a silent asset.
        // This is a declared test skin, not a replacement lookup implementation.
        string? name = sampleInfo.LookupNames.FirstOrDefault();
        if (name == null) return null;
        record("lookup_selected", name, 0, false, sampleInfo.Volume / 100.0, 0, 1);
        var sample = new ObservedSample(name, this);
        samples.Add(sample);
        return sample;
    }

    public void Observe(PausableSkinnableSound sound, int object_index, int sound_index)
    {
        if (!observed_sounds.Add(sound)) return;
        void record_sound(string command)
        {
            lock (synchronization)
                events.Add(new { sequence = events.Count + 1, time_ms = clock(), command,
                    object_index, sound_index, looping = sound.Looping,
                    names = sound.Samples.SelectMany(sample => sample.LookupNames).ToArray(),
                    volume = sound.Volume.Value, pan = sound.Balance.Value, rate = sound.Frequency.Value });
        }
        // These are actual drawable-side parameter writes before device mixing.
        // Keep them distinct from virtual channel aggregate adjustment snapshots.
        sound.Volume.BindValueChanged(_ => record_sound("sound_volume"), true);
        sound.Balance.BindValueChanged(_ => record_sound("sound_pan"), true);
        sound.Frequency.BindValueChanged(_ => record_sound("sound_rate"), true);
    }

    public Drawable? GetDrawableComponent(ISkinComponentLookup lookup) => null;
    public Texture? GetTexture(string componentName, WrapMode wrapModeS, WrapMode wrapModeT) => null;
    public IBindable<TValue>? GetConfig<TLookup, TValue>(TLookup lookup) where TLookup : notnull where TValue : notnull => null;

    public void Dispose()
    {
        foreach (var sample in samples) sample.Dispose();
    }

    private sealed class ObservedSample(string name, ScenarioAudioObservation observer) : Sample(name)
    {
        public override double Length => 0;
        protected override SampleChannel CreateChannel() => new ObservedChannel(Name, observer, Interlocked.Increment(ref observer.next_voice_id));
    }

    private sealed class ObservedChannel : SampleChannel
    {
        private readonly ScenarioAudioObservation observer;
        private readonly long voice_id;
        private bool playing;
        public override bool Playing => playing;

        public ObservedChannel(string name, ScenarioAudioObservation observer, long voice_id) : base(name)
        {
            this.observer = observer;
            this.voice_id = voice_id;
            AggregateVolume.BindValueChanged(_ => record("volume"));
            AggregateBalance.BindValueChanged(_ => record("pan"));
            AggregateFrequency.BindValueChanged(_ => record("rate"));
        }

        private void record(string command) => observer.record(command, Name, voice_id, Looping,
            AggregateVolume.Value, AggregateBalance.Value, AggregateFrequency.Value);

        public override void Play()
        {
            base.Play();
            playing = true;
            record("play");
        }

        public override void Stop()
        {
            if (playing) record("stop");
            playing = false;
            base.Stop();
        }
    }
}
