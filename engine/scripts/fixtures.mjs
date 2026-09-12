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
  for (const [id, text] of [
    ['overflow-header', map('18446744073709551630')],
    ['overflow-sound', map(14, '[HitObjects]\n0,0,0,1,18446744073709551617')],
    ['overflow-negative', map(14, '[General]\nMode: -18446744073709551616')],
    ['overflow-sample', map(14, '[HitObjects]\n0,0,0,1,0,0:0:18446744073709551617:0:')],
    ['overflow-timing', map(14, '[TimingPoints]\n0,500,18446744073709551620')],
  ]) add(id, text, ['A05'], 'MALFORMED_MAP');
  return result;
}

export function referenceFixtures() {
  const result = fixtures().filter(f => !['quota-edge', 'quota-overflow', 'bom-whitespace-defaults', 'wrong-mode', 'overflow-header'].includes(f.id));
  const add = (id, body, acceptance=['A01', 'A05'], expectedStatus='OK') => result.push({id, text:map(14, body), acceptance, expectedStatus});
  add('omitted-all', '');
  for(const v of [...Array.from({length:14},(_,i)=>i+1),128]) result.push({id:`defaults-${v}`,text:map(v),acceptance:['A01','A02','A03','A04'],expectedStatus:'OK'});
  add('countdown-name-comments', '[General]\nCountdown: HalfSpeed // comment\nAudioFilename: music\\track.mp3\n[Metadata]\nTitle: title // literal\n[HitObjects]\n0,0,100,1,0 // comment', ['A01']);
  add('combo-source-order-break', '[Events]\n2,100,200\n[HitObjects]\n0,0,300,1,0\n0,0,100,8,0,200\n0,0,200,1,0\n0,0,300,53,0', ['A04']);
  add('general-breaks', '[General]\nAudioLeadIn: 120\nPreviewTime: 300\nSampleSet: Soft\nSampleVolume: 45\nCountdown: 2\nCountdownOffset: 3\nSamplesMatchPlaybackRate: 1\nLetterboxInBreaks: 1\nEpilepsyWarning: 1\nWidescreenStoryboard: 1\nSpecialStyle: 1\n[Events]\n2,10,5\nBreak,40,90\n[TimingPoints]\n100,500\n[HitObjects]\n5,6,100,1,0,0:0:0:0:');
  const lines = ['100,500,3,1,1,20,1,8','100,300,4,2,2,40,1,0','100,-50,4,3,3,60,0,1','100,-25,4,2,4,80,0,0'];
  function permutations(a) { return a.length ? a.flatMap((x,i) => permutations(a.filter((_,j)=>i!==j)).map(rest=>[x,...rest])) : [[]]; }
  permutations(lines).forEach((p,i) => add(`coincidence-${i}`, '[TimingPoints]\n'+p.join('\n')+'\n200,NaN,4,1,0,100,0,1', ['A06','A07']));
  add('nonconsecutive-timing', '[TimingPoints]\n200,-50,4,2,3,70,0,1\n100,500,4,1,0,100,1,0\n200,400,3,3,2,60,1,8', ['A06','A07']);
  add('clamped-control-points', '[TimingPoints]\n100,0,4,1,0,200,1,0\n200,-0.01,4,2,1,-30,0,1\n300,-10000,4,3,2,60,0,0', ['A06','A07']);
  for (const sample of ['1','1:x','0:0:x','0:0:0:x']) add('bad-sample-'+sample.replaceAll(':','-'), '[HitObjects]\n0,0,100,1,0,'+sample, ['A05'], 'MALFORMED_MAP');
  add('slider-banks-only', '[HitObjects]\n0,0,100,2,0,L|100:0,1,100,0|0|ignored,0:0|0:0|ignored,0:0:ignored:ignored', ['A01','A05']);
  add('edge-sound-fallback', '[HitObjects]\n0,0,100,2,0,L|100:0,1,100,x', ['A01','A05']);
  add('bad-edge-bank', '[HitObjects]\n0,0,100,2,0,L|100:0,1,100,0,0:x', ['A05'], 'MALFORMED_MAP');
  return result;
}
