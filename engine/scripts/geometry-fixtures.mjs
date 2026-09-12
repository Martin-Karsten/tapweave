const options = { adjust_length: false, expected_length: 0, optimise_catmull: false, work_limit: 20_000_000 };
const progress = [-0.2, 0, 0.125, 0.25, 0.5, 0.75, 0.875, 1, 1.2];
const point = (position, kind = 'None', degree = 0) => ({ position, kind, degree });
const path = (id, kind, positions, extra = {}, degree = 0) => ({
  id, points: positions.map((p, i) => point(p, i === 0 ? kind : 'None', i === 0 ? degree : 0)),
  options: { ...options, ...extra }, progress,
});
export function geometryFixtures() {
  const fixtures = [
    path('empty', 'Linear', []), path('single', 'Linear', [[3, 4]]),
    path('line-3-4-5', 'Linear', [[0, 0], [3, 4]]),
    path('line-corner', 'Linear', [[0, 0], [100, 0], [100, 100]]),
    path('line-short', 'Linear', [[0, 0], [100, 0], [100, 100]], { adjust_length: true, expected_length: 125 }),
    path('line-extend', 'Linear', [[0, 0], [100, 0], [100, 100]], { adjust_length: true, expected_length: 250 }),
    path('line-zero', 'Linear', [[0, 0], [100, 0]], { adjust_length: true, expected_length: 0 }),
    path('duplicate-tail-no-extension', 'Linear', [[0, 0], [100, 0], [100, 0]], { adjust_length: true, expected_length: 150 }),
    path('duplicate-tail-shortening', 'Linear', [[0, 0], [100, 0], [100, 0]], { adjust_length: true, expected_length: 50 }),
    path('identical', 'Bezier', [[3, 4], [3, 4], [3, 4]]),
    path('quadratic', 'Bezier', [[0, 0], [50, 100], [100, 0]]),
    path('cubic-inflection', 'Bezier', [[0, 0], [100, 200], [0, -200], [100, 0]]),
    path('bezier-long', 'Bezier', [[0, 0], [50_000, 80_000], [100_000, 0]]),
    path('bezier-close', 'Bezier', [[0, 0], [0.00001, 0.00002], [0.00003, 0]]),
    path('perfect-semicircle', 'Perfect', [[0, 0], [50, 50], [100, 0]]),
    path('perfect-reverse', 'Perfect', [[0, 0], [50, -50], [100, 0]]),
    path('perfect-major', 'Perfect', [[50, 0], [-50, 0], [0, 50]]),
    path('perfect-tiny', 'Perfect', [[0.02, 0], [0, 0.02], [-0.02, 0]]),
    path('perfect-collinear', 'Perfect', [[0, 0], [50, 0], [100, 0]]),
    path('perfect-repeated', 'Perfect', [[0, 0], [0, 0], [100, 100]]),
    path('perfect-four-points', 'Perfect', [[0, 0], [30, 90], [60, 30], [100, 0]]),
    path('perfect-large-fallback', 'Perfect', [[0, 0], [100_000, 100_000], [200_000, 0]]),
    path('catmull', 'Catmull', [[0, 0], [50, 100], [100, -20], [200, 0]]),
    path('catmull-two', 'Catmull', [[0, 0], [100, 100]]),
    path('catmull-bulb-raw', 'Catmull', [[0, 0], [100, 100], [100, 100], [200, 0]]),
    path('catmull-bulb-optimised', 'Catmull', [[0, 0], [100, 100], [100, 100], [200, 0]], { optimise_catmull: true }),
    path('catmull-optimised-adjusted', 'Catmull', [[0, 0], [100, 100], [100, 100], [200, 0]], { optimise_catmull: true, adjust_length: true, expected_length: 300 }),
  ];
  for (const degree of [1, 2, 3, 4, 99]) fixtures.push(path(`bspline-degree-${degree}`, 'Bezier', [[0, 0], [30, 100], [80, -50], [140, 90], [200, 0]], {}, degree));
  fixtures.push({ id: 'mixed-explicit-markers', points: [point([0, 0], 'Bezier'), point([50, 100]), point([100, 0], 'Linear'), point([150, 0], 'Perfect'), point([175, 25]), point([200, 0])], options, progress });
  fixtures.push({ id: 'repeated-explicit-split', points: [point([0, 0], 'Bezier'), point([50, 100]), point([50, 100], 'Bezier'), point([100, 0])], options, progress });
  // Reproducible synthetic corpus, independent of beatmap decoding.
  let seed = 0x4d31;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 40; i++) {
    const kind = ['Linear', 'Bezier', 'Catmull', 'Perfect'][i % 4];
    const count = kind === 'Perfect' ? 3 : 3 + i % 5;
    const positions = Array.from({ length: count }, () => [Math.fround(random() * 512), Math.fround(random() * 384)]);
    fixtures.push(path(`seeded-${i}-${kind.toLowerCase()}`, kind, positions, { adjust_length: i % 3 !== 0, expected_length: 100 + random() * 800, optimise_catmull: i % 2 === 0 }));
  }
  return fixtures;
}
