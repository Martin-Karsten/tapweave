// Scenario ports adapted from osu!lazer tests, copyright ppy Pty Ltd, MIT.
// See THIRD_PARTY_NOTICES.md and the per-case upstream method mappings below.
// Expectations are retained test assertions, never generated from Odin output.
export const result = Object.freeze({ miss: 1, meh: 2, ok: 3, great: 5, tick_miss: 9, tick: 10, small_bonus: 11, large_bonus: 12, ignore_miss: 13, ignore_hit: 14, tail: 16 });
const source = (file, method) => `osu.Game.Rulesets.Osu.Tests/${file}.cs::${method}`;
export function beatmap(objects, { hp = 5, od = 5, cs = 5, beat = 1000, multiplier = 1, tick_rate = 1, velocity = 1, breaks = [] } = {}) {
  return `osu file format v14\n[General]\nMode:0\n[Difficulty]\nHPDrainRate:${hp}\nCircleSize:${cs}\nOverallDifficulty:${od}\nApproachRate:5\nSliderMultiplier:${multiplier}\nSliderTickRate:${tick_rate}\n[Events]\n${breaks.map(([start, end]) => `2,${start},${end}`).join('\n')}\n[TimingPoints]\n0,${beat},4,1,0,100,1,0\n0,${-100 / velocity},4,1,0,100,0,0\n[HitObjects]\n${objects.join('\n')}\n`;
}
export const input = (time_ms, x, y, actions = 0) => ({ time_ms, x: Math.fround(x), y: Math.fround(y), actions });
const circle = (x, y, time) => `${x},${y},${time},1,0`;
function nextFloat(number, direction) {
  const storage = new DataView(new ArrayBuffer(8));
  storage.setFloat64(0, number);
  storage.setBigUint64(0, storage.getBigUint64(0) + BigInt(direction));
  return storage.getFloat64(0);
}
export function gameplayFixtures() {
  const fixtures = [];
  const add = fixture => fixtures.push({ end_ms: 5000, replay: false, inputs: [], acceptance: ['A13'], ...fixture });
  const hitArea = (method, id, x, y, expected) => add({ id, audio: true, map: beatmap([circle(100, 100, 1500)]), inputs: [input(1450.5, x, y, 1)], expected: { results: [expected] }, upstream_tests: [source('TestSceneHitCircleArea', method)], adaptation: 'The upstream receptor is scaled to the prepared CS5 radius; coordinates use the same relative radius and the action is delivered through the real playfield.' });
  // OsuHitObject scale includes the pinned 1.00041 compatibility multiplier.
  const radius = Math.fround(64 * Math.fround(0.5 * 1.00041));
  hitArea('TestCircleHitCentre', 'circle-centre-port', 100, 100, result.great);
  add({ id: 'circle-left-edge-port', map: beatmap([circle(0, 0, 1500)]), inputs: [input(1450.5, -radius, 0, 1)], expected: { results: [result.great] }, upstream_tests: [source('TestSceneHitCircleArea', 'TestCircleHitLeftEdge')], adaptation: 'Translate the centre to the origin so the exact radius edge is representable as f32; screen-space round-trip rounding at translated centres belongs to A12.' });
  for (const [distance, expected] of [[0.95, result.great], [1.05, result.miss]]) {
    const correction = Math.fround(Math.fround(Math.fround(distance) * Math.fround(Math.sqrt(2))) / 2 * radius);
    hitArea('TestHitsCloseToEdge', `circle-diagonal-${distance}`, 100 - correction, 100 - correction, expected);
  }
  hitArea('TestCircleMissBoundingBoxCorner', 'circle-bounding-corner', 100 - radius, 100 - radius, result.miss);
  for (const [method, inputs] of [['TestMissViaNotHitting', []], ['TestMissViaEarlyHit', [input(650, 256, 192, 1), input(675, 256, 192)]]]) {
    add({ id: method, map: beatmap([circle(256, 192, 1000)]), inputs, expected: { results: [result.miss] }, upstream_tests: [source('TestSceneMissHitWindowJudgements', method)], adaptation: 'Translate the object and replay times by +1000 ms; the autoplay helper supplies input only, with no gameplay mod.' });
  }
  for (const od of [0, 5, 10]) {
    const windows = od === 0 ? [79.5, 139.5, 199.5] : od === 5 ? [49.5, 99.5, 149.5] : [19.5, 59.5, 99.5];
    for (const [window_index, boundary] of windows.entries()) {
      for (const sign of [-1, 1]) {
        for (const adjacent of [-1, 0, 1]) {
          const time_ms = adjacent === 0 ? 1000 + sign * boundary : nextFloat(1000 + sign * boundary, adjacent);
          const offset = Math.abs(time_ms - 1000);
          const expected = offset <= windows[0] ? result.great : offset <= windows[1] ? result.ok : offset <= windows[2] ? result.meh : result.miss;
          add({ id: `window-od${od}-${window_index}-${sign}-${adjacent}`, map: beatmap([circle(256, 192, 1000)], { od }), inputs: [input(time_ms, 256, 192, 1)], expected: { results: [expected] }, upstream_tests: [], source_symbols: ['osu.Game.Rulesets.Osu/Scoring/OsuHitWindows.cs', 'osu.Game.Rulesets.Osu/Objects/Drawables/DrawableHitCircle.cs'], adaptation: 'Source-derived drawable boundary regression; neighbouring representable absolute input timestamps, not rounded offsets.' });
        }
      }
    }
  }
  for (const [id, time_ms, expected] of [['before', 1400, [1, 1]], ['at', 1500, [1, 2]], ['after', 1600, [1, 5]]]) {
    add({ id: `note-lock-${id}`, map: beatmap([circle(0, 0, 1500), circle(80, 80, 1600)]), inputs: [input(time_ms, 80, 80, 1)], expected: { object_results: expected }, acceptance: ['A14'], upstream_tests: [source('TestSceneStartTimeOrderedHitPolicy', `TestClickSecondCircle${id === 'before' ? 'Before' : id === 'at' ? 'At' : 'After'}FirstCircleTime`)], adaptation: 'Upstream uses custom ±500/1000 ms test windows. Preserve input/order setup and assert standard OD5 result bands; this is a production-window adaptation, not the custom-window test itself.' });
  }
  add({ id: 'one-edge-two-equal-circles', map: beatmap([circle(100, 100, 1500), circle(100, 100, 1500)]), inputs: [input(1500, 100, 100, 1)], expected: { results: [5, 1] }, acceptance: ['A14'], upstream_tests: [], source_symbols: ['osu.Game.Rulesets.Osu/UI/StartTimeOrderedHitPolicy.cs'] });
  const sliderCases = [
    ['TestPressBothKeysSimultaneouslyAndReleaseOne', [[1500, 0, 0, 3], [2500, 0, 0, 2]], 'all_max'],
    ['TestInvalidKeyTransfer', [[250, 0, 0, 1], [1500, 0, 0, 3], [2500, 0, 0, 1]], 'tail_miss'],
    ['TestLeftBeforeSliderThenRightThenLettingGoOfLeft', [[1500, 0, 0, 1], [2500, 0, 0, 3], [3000, 0, 0, 2]], 'all_max'],
    ['TestTrackingRetentionLeftRightLeft', [[250, 0, 0, 1], [1500, 0, 0, 3], [2500, 0, 0, 2]], 'all_max'],
    ['TestTrackingLeftBeforeSliderToRight', [[250, 0, 0, 1], [1500, 0, 0, 3], [2500, 0, 0, 2]], 'all_max'],
    ['TestTrackingPreclicked', [[250, 0, 0, 1]], 'head_miss_tail_hit'],
    ['TestTrackingReturnMidSlider', [[1500, 0, 0, 1], [2500, 150, 150, 1], [3000, 200, 200, 1], [3500, 0, 0, 1], [3800, 0, 0, 1]], 'tail_hit'],
    ['TestTrackingReturnMidSliderKeyDownBefore', [[250, 0, 0, 1], [1500, 0, 0, 3], [2500, 0, 0, 1], [3000, 200, 200, 1], [3500, 0, 0, 1], [3800, 0, 0, 1]], 'tail_miss'],
    ['TestTrackingMidSlider', [[2500, 150, 150, 1], [3000, 200, 200, 1], [3500, 0, 0, 1], [3800, 0, 0, 1]], 'tail_hit'],
    ['TestMidSliderTrackingAcquired', [[250, 0, 0, 1], [1500, 0, 0, 3], [2500, 100, 100, 0], [3000, 0, 0, 1]], 'tail_hit'],
    ['TestMidSliderTrackingAcquiredWithMouseDownOutsideSlider', [[250, 0, 0, 1], [1500, 0, 0, 3], [2500, 100, 100, 2], [3000, 0, 0, 2]], 'tail_hit'],
    ['TestTrackingReleasedValidKey', [[1500, 0, 0, 1], [2500, 100, 100, 1], [3000, 100, 100, 0], [3500, 100, 100, 1], [3800, 0, 0, 1]], 'tail_hit'],
    ['TestTrackingAreaEdge', [[1500, 0, 0, 1], [1750, 0, Math.fround(64 * Math.fround(1.19)), 1], [4000, 25, Math.fround(64 * Math.fround(1.199)), 1]], 'all_max'],
    ['TestTrackingAreaOutsideEdge', [[1500, 0, 0, 1], [1750, 0, Math.fround(64 * Math.fround(1.21)), 1], [4000, 25, Math.fround(64 * Math.fround(1.201)), 1]], 'tail_miss'],
  ];
  for (const [method, frames, assertion] of sliderCases) {
    add({ id: method, map: beatmap(['0,0,1500,2,0,L|25:0,1,25'], { velocity: 0.1, tick_rate: 3 }), inputs: frames.map(frame => input(...frame)), replay: true, expected: { assertion }, acceptance: ['A15', 'A23'], upstream_tests: [source('TestSceneSliderInput', method)], adaptation: 'Same positions, times, actions, length, velocity and tick rate. Two-point perfect curve resolves to a line; prepared through the legacy decoder. Replay interpolation is required.' });
  }
  for (const cs of [0, 5, 10]) {
    const scale = Math.fround(Math.fround(Math.fround(1 - Math.fround(0.7) * ((cs - 5) / 5)) / 2) * Math.fround(1.00041));
    const circle_radius = Math.fround(64 * scale);
    const length = Math.fround(circle_radius * Math.fround(1.2));
    for (const velocity of [0, 5, 10]) {
      add({ id: `follow-area-cs${cs}-velocity${velocity}`, map: beatmap([`0,0,1000,2,0,L|${length}:0,1,${length}`], { cs, velocity: Math.max(0.1, velocity), multiplier: 1.4 }),
        inputs: [input(1000, Math.fround(-circle_radius + 1), 0, 1)], replay: true, end_ms: 8000, expected: { assertion: 'all_max' },
        acceptance: ['A15'], upstream_tests: [source('TestSceneSliderFollowCircleInput', 'TestMaximumDistanceTrackingWithoutMovement')],
        parameters: { circleSize: cs, velocity }, adaptation: 'Full 3×3 parameter matrix. Zero SV uses the same upstream precision-adjusted minimum of 0.1; path and cursor use the upstream f32 radius calculation.' });
    }
  }
  const earlyCases = [
    ['TestHitEarlyMoveIntoFollowRegion', [[850, 156, 192, 1], [900, 191, 192, 1], [2900, 391, 192, 1]], [2, 10, 16, 14]],
    ['TestHitEarlyAndReleaseInFollowRegion', [[850, 156, 192, 1], [900, 191, 192, 1], [950, 191, 192, 0], [2950, 391, 192, 1]], [2, 9, 13, 14]],
    ['TestHitEarlyAndRepressInFollowRegion', [[850, 156, 192, 1], [900, 191, 192, 1], [925, 191, 192, 0], [950, 191, 192, 1], [2950, 391, 192, 1]], [2, 9, 13, 14]],
    ['TestHitEarlyMoveOutsideFollowRegion', [[850, 156, 192, 1], [900, 226, 192, 1], [2900, 426, 192, 1]], [2, 9, 13, 14]],
  ];
  for (const [method, frames, expected] of earlyCases) {
    add({ id: method, map: beatmap(['156,192,1000,2,0,L|356:192,1,200'], { od: 0 }), inputs: frames.map(frame => input(...frame)), replay: true, expected: { results: expected }, audio: true, acceptance: ['A15', 'A20', 'A23'], upstream_tests: [source('TestSceneSliderEarlyHitJudgement', method)], adaptation: 'Same replay, OD0, path and duration. TickDistanceMultiplier=3 with SliderTickRate=3 is represented by tick rate 1, yielding the same single tick.' });
  }
  const lateCases = [
    ['TestHitLateInRangeTracks', 99, 1, 1, 200, 1, [3, 16, 14]],
    ['TestHitLateOutOfRangeDoesNotTrack', 99, 2, 1, 200, 1, [3, 13, 14]],
    ['TestHitLateInRangeHitsTicks', 149, 1, 15, 200, 1, [2, 10, 10, 10, 10, 10, 10, 10, 16, 14]],
    ['TestHitLateOutOfRangeDoesNotHitTicks', 149, 2, 15, 200, 1, [2, 9, 9, 9, 13, 14]],
    ['TestMissHeadInRangeDoesNotTrack', 151, 1, 15, 200, 1, [1, 9, 9, 9, 9, 9, 9, 9, 13, 13]],
    ['TestHitLateInRangeHitsRepeat', 149, 1, 1, 50, 2, [2, 10, 16, 14]],
    ['TestHitLateShortSliderHitsAll', 149, 1, 300, 20, 2, null],
  ];
  for (const [method, offset, velocity, tick_rate, length, spans, expected] of lateCases) {
    // The source constructs objects with multiplier 4 and arbitrary tick
    // multipliers. Preserve velocity/duration/tick distance using equivalent
    // timing points within the legacy decoder's supported difficulty ranges.
    const multiplier = tick_rate === 1 ? 2 : 0.4;
    const beat = tick_rate === 1 ? 500 : tick_rate === 300 ? 10 : 100;
    const mapped_velocity = tick_rate === 300 ? velocity * 0.1 : velocity;
    const target_tick_distance = 400 * velocity / 3 * Math.fround(3 / tick_rate);
    const mapped_tick_rate = 100 * multiplier * mapped_velocity / target_tick_distance;
    const frames = [input(1000 + offset, 156, 192, 1), input(1500 + offset, spans > 1 ? 156 : 356, 192, 1)];
    add({ id: method, map: beatmap([`156,192,1000,2,0,L|${156 + length}:192,${spans},${length}`], { multiplier, beat, velocity: mapped_velocity, tick_rate: mapped_tick_rate }),
      inputs: frames, replay: true, expected: expected ? { results: expected } : { component_results: { SliderHeadCircle: 2, SliderTick: 10, SliderRepeat: 10, SliderTailCircle: 16, Slider: 14 } },
      audio: true, acceptance: ['A15', 'A20', 'A23'], upstream_tests: [source('TestSceneSliderLateHitJudgement', method)],
      adaptation: 'Same path, replay, OD5 and velocity. Represent programmatic TickDistanceMultiplier through legacy tick rate; all component assertions are checked independently upstream.' });
  }
  add({ id: 'spinner-no-input-port', map: beatmap(['256,192,2000,8,0,4000']), expected: { assertion: 'all_min' }, acceptance: ['A16'], upstream_tests: [source('TestSceneSpinnerJudgement', 'TestHitNothing')] });
  for (const spins of [1, 2, 5, 20]) {
    const frames = [];
    const start_angle = Math.fround(-Math.fround(Math.PI) / 2);
    const delta = Math.fround(Math.fround(Math.fround(spins * 2) * Math.fround(Math.PI)) + Math.fround(Math.fround(Math.PI) / 8));
    const end_angle = Math.fround(start_angle + delta);
    for (let time_ms = 2000; time_ms <= 4000; time_ms += 10) {
      const angle = Math.fround(start_angle + Math.fround(Math.fround(end_angle - start_angle) * Math.fround((time_ms - 2000) / 2000)));
      frames.push(input(time_ms, Math.fround(256 + Math.fround(50 * Math.fround(Math.cos(angle)))), Math.fround(192 + Math.fround(50 * Math.fround(Math.sin(angle)))), 1));
    }
    frames.push(input(4000, frames.at(-1).x, frames.at(-1).y));
    add({ id: `spinner-${spins}-spins`, map: beatmap(['256,192,2000,8,0,4000']), inputs: frames, replay: true, expected: spins === 20 ? { assertion: 'all_max' } : { spins }, acceptance: ['A16', 'A23'], upstream_tests: [source('TestSceneSpinnerJudgement', spins === 20 ? 'TestHitEverything' : 'TestNumberOfSpins')], source_symbols: ['osu.Game.Rulesets.Osu.Tests/SpinFramesGenerator.cs'], adaptation: 'Same 2000–4000 ms spinner, OD5, 10 ms frames, angular error margin and final release. f32 operations retained; trigonometric library rounding is checked through fixture coordinates.' });
  }
  for (const hp of [0, 5, 10]) {
    for (const with_break of [false, true]) {
      const frames = [input(1000, 64, 64, 1), input(1010, 64, 64), input(2000, 156, 192, 2),
        input(2500, 181, 192, 2), input(2510, 181, 192), input(4000, 400, 300, 1)];
      add({ id: `player-mixed-hp${hp}-break-${with_break}`, map: beatmap([circle(64, 64, 1000), '156,192,2000,2,0,L|181:192,1,25', circle(400, 300, 4000)],
        { hp, velocity: 0.5, breaks: with_break ? [[2700, 3700]] : [] }), inputs: frames, replay: true, player: true,
        expected: { assertion: 'all_max', state: 'PASSED' }, acceptance: ['A17', 'A18', 'A19', 'A23'], upstream_tests: [],
        source_symbols: ['osu.Game/Screens/Play/Player.cs', 'osu.Game/Rulesets/Scoring/DrainingHealthProcessor.cs'],
        adaptation: 'Source-derived mixed-session health/score integration at HP0/5/10, with and without a break.' });
    }
    add({ id: `player-failure-hp${hp}`, map: beatmap(Array.from({ length: 40 }, (_, object_index) => circle(64 + (object_index % 4) * 100, 64, 1000 + object_index * 100)), { hp }),
      inputs: [], replay: true, player: true, expected: { state: 'FAILED' }, end_ms: 7000, acceptance: ['A19'], upstream_tests: [],
      source_symbols: ['osu.Game/Screens/Play/Player.cs', 'osu.Game.Rulesets.Osu/Scoring/OsuHealthProcessor.cs'], adaptation: 'Source-derived real Player failure and post-failure score observations.' });
  }
  const recording_map = beatmap([1000, 6000, 11000, 16000].map(time_ms => circle(256, 192, time_ms)), { hp: 0 });
  add({ id: 'replay-record-actions-port', map: recording_map, inputs: [input(1000, 256, 192, 2), input(1015, 256, 192),
    input(6000, 256, 192, 1), input(6015, 256, 192), input(11000, 256, 192, 4), input(11015, 256, 192)],
    player: true, record: true, end_ms: 17000, expected: { recorded_actions: [2, 1, 4] }, acceptance: ['A23'],
    upstream_tests: [source('TestSceneReplayRecording', 'TestRecording')], adaptation: 'Translate object/input times by +1000 ms and use HP0 in place of the test-only NoFail mod; preserve right/left/smoke recording assertions.' });
  add({ id: 'replay-record-same-time-release-port', map: recording_map,
    inputs: [input(1000, 256, 192, 2), input(1000, 256, 192)], player: true, record: true, end_ms: 17000,
    expected: { recorded_actions: [2], results: [5, 1, 1, 1] }, acceptance: ['A23'],
    upstream_tests: [source('TestSceneReplayRecording', 'TestPressAndReleaseOnSameFrame')], adaptation: 'Press/release on successive host updates at one frozen beatmap timestamp, matching the source test; +1000 ms time translation and HP0.' });
  return fixtures;
}
export function localFixture(fixture, schedule_ms) {
  return { id: fixture.id, map_text: fixture.map, replay: fixture.replay, schedule_ms, inputs: fixture.inputs.map((frame, frame_index) => ({ sequence: frame_index + 1, raw_time_ms: frame.time_ms, effective_time_ms: frame.time_ms, x: frame.x, y: frame.y, action_bits: frame.actions })) };
}
export function schedules(fixture) {
  const schedules = [{ id: 'direct', times: [fixture.end_ms] }];
  for (const cadence of [30, 60, 120, 144]) {
    for (const stall of [0, 50, 100, 250]) {
      const times = [0];
      for (let frame_index = 1; frame_index / cadence * 1000 < fixture.end_ms; frame_index++) {
        const time_ms = frame_index / cadence * 1000;
        if (time_ms > 1490 && time_ms < 1490 + stall) continue;
        times.push(time_ms);
      }
      times.push(fixture.end_ms);
      schedules.push({ id: `${cadence}hz-stall-${stall}`, times });
    }
  }
  return schedules;
}
