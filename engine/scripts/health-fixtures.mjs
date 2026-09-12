// Ports of OsuHealthProcessorTest and source-derived combo regressions.
// Copyright (c) ppy Pty Ltd, MIT. See THIRD_PARTY_NOTICES.md.
export function healthFixtures() {
  const cases = [
    ['HitCircle', 0.01, true, 1, 5],
    ['SliderHeadCircle', 0.01, true, 1, 5],
    ['SliderTick', 0.01, true, 9, 10],
    ['SliderRepeat', 0.01, true, 9, 10],
    ['SliderTailCircle', 0, true, 13, 16],
    ['Slider', 0, true, 13, 14],
    ['SpinnerTick', 0, false, 13, 11],
    ['SpinnerBonusTick', 0, false, 13, 12],
    ['Spinner', 0.01, true, 1, 5],
  ];
  const fixtures = [];
  for (const [object_kind, starting_health, fail_expected, minimum, maximum] of cases) {
    for (const [suffix, actual, expected_failed] of [['min', minimum, fail_expected], ['max', maximum, false]]) {
      fixtures.push({ id: `upstream-health-${object_kind}-${suffix}`, kind: 'health',
        starting_health, difficulty: 5, health_kinds: [object_kind], combo_flags: [0], actual: [actual],
        expected_failed, upstream_test: `osu.Game.Rulesets.Osu.Tests/OsuHealthProcessorTest.cs::${suffix === 'min' ? 'TestFailAfterMinResult' : 'TestNoFailAfterMaxResult'}` });
    }
  }
  for (const difficulty of [0, 5, 10]) {
    for (const result of [1, 2, 3, 5]) {
      fixtures.push({ id: `health-combo-hp${difficulty}-result${result}`, kind: 'health', starting_health: 0.5,
        difficulty, health_kinds: ['HitCircle', 'HitCircle'], combo_flags: [1, 2], actual: [result, 5] });
    }
    fixtures.push({ id: `health-missed-tail-combo-hp${difficulty}`, kind: 'health', starting_health: 0.5, difficulty,
      health_kinds: ['HitCircle', 'SliderTailCircle', 'HitCircle'], combo_flags: [1, 0, 2], actual: [5, 13, 5], expected_health: 0.61 });
    fixtures.push({ id: `health-new-combo-resets-quality-hp${difficulty}`, kind: 'health', starting_health: 0.5, difficulty,
      health_kinds: ['SliderTailCircle', 'HitCircle'], combo_flags: [0, 3], actual: [13, 5], expected_health: 0.6 });
  }
  return fixtures;
}
