const map = (version, body = '') => `osu file format v${version}\n${body}`;
export function fixtures() {
  const result = [];
  const add = (id, text, acceptance, expectedStatus = 'OK') => result.push({ id, text, acceptance, expectedStatus });
  for (const version of [...Array.from({ length: 14 }, (_, i) => i + 1), 128]) {
    add(`version-${version}`, map(version, '[Difficulty]\nOverallDifficulty: 7\n[TimingPoints]\n0,500\n[HitObjects]\n12.75,-12.75,100,1,0\n'), ['A01', 'A02', 'A03', 'A04']);
  }
  for (const version of [0, 15, 127, 129]) add(`unsupported-${version}`, map(version), ['A04'], 'UNSUPPORTED');
  add('missing-header', '[General]\nMode: 0', ['A05'], 'MALFORMED_MAP');
  add('bad-number', map(14, '[Difficulty]\nCircleSize: 1e999'), ['A05'], 'MALFORMED_MAP');
  add('truncated-slider', map(14, '[HitObjects]\n0,0,0,2,0,B|10:10'), ['A05'], 'MALFORMED_MAP');
  add('wrong-mode', map(14, '[General]\nMode: 3'), ['A05'], 'UNSUPPORTED');
  add('unknown-object', map(14, '[HitObjects]\n0,0,0,128,0'), ['A05'], 'UNSUPPORTED');
  add('bom-whitespace-defaults', '\ufeff  osu file format v14\r\n\r\n// hello\r\n[Unknown]\r\nopaque\r\n[Metadata]\r\nTitle: 日本語\r\n[Difficulty]\r\nCircleSize: 99\r\nApproachRate: 4\r\nOverallDifficulty: 8\r\nFutureKey: ignored', ['A01']);
  add('ordering', map(128, '[HitObjects]\n0,0,200,1,0\n0,0,100,2,0,B|10:10|L|20:20,2,30\n0,0,100,8,0,500'), ['A04']);
  const red = '100,500,4,1,1,60,1,0';
  const green = '100,-50,4,2,3,80,0,1';
  for (const [id, lines] of [['red-green', [red, green]], ['green-red', [green, red]]]) {
    add(id, map(14, `[TimingPoints]\n${lines.join('\n')}\n200,NaN,4,1,0,100,0,0`), ['A06']);
  }
  add('red-nan', map(14, '[TimingPoints]\n0,NaN,4,1,0,100,1,0'), ['A05'], 'MALFORMED_MAP');
  add('quota-edge', map(14, '[HitObjects]\n' + Array.from({ length: 10000 }, (_, i) => `0,0,${i},1,0`).join('\n')), ['A24']);
  add('quota-overflow', map(14, '[HitObjects]\n' + '0,0,0,1,0\n'.repeat(10001)), ['A05'], 'QUOTA_EXCEEDED');
  return result;
}
