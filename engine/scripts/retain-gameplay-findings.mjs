import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root } from './toolchain.mjs';
import { gameplayFixtures } from './gameplay-fixtures.mjs';
import { healthFixtures } from './health-fixtures.mjs';
import { gameplayWorkloads } from './gameplay-workloads.mjs';
import { hash, sourceInventory } from './gameplay-provenance.mjs';

const load = path => JSON.parse(readFileSync(resolve(root, path)));
const gameplay = load('artifacts/gameplay/acceptance.json');
const health = load('artifacts/simulation/acceptance.json');
const workloads = load('artifacts/gameplay-workloads/acceptance.json');
const manifest = load('reference/source-manifest.json');
const lock_hash = hash(readFileSync(resolve(root, 'reference-host/packages.lock.json')));
for (const report of [gameplay, workloads]) {
  assert.equal(report.source_commit, manifest.osu.commit);
  assert.equal(report.framework_commit, manifest.framework.commit);
  assert.equal(report.lock_sha256, lock_hash);
}
assert.equal(health.sourceCommit, manifest.osu.commit);
assert.equal(health.frameworkCommit, manifest.framework.commit);
assert.equal(health.lockSha256, lock_hash);
assert.equal(gameplay.upstream_executed, true);
assert.equal(gameplay.filtered, false);
assert.deepEqual(gameplay.failures, []);
assert.equal(health.upstreamExecuted, true);
assert.deepEqual(workloads.failures, []);
assert.equal(workloads.filtered, false);
assert.equal(gameplay.records.length, gameplayFixtures().length);
assert.equal(workloads.records.length, gameplayWorkloads().length);
const compact = (fixtures, report, schedule_count) => fixtures.map(fixture => {
  const record = report.records.find(record => record.id === fixture.id);
  assert.equal(record.fixture_sha256, hash(JSON.stringify(fixture)), `${fixture.id}: stale fixture`);
  assert.equal(record.schedules.length, schedule_count);
  assert.ok(record.schedules.every(schedule => schedule.native_wasm_equal));
  if (record.upstream) {
    assert.equal(record.upstream.observation_sha256,
      hash(readFileSync(resolve(root, `artifacts/gameplay/${fixture.id}.upstream.json`))));
    assert.equal(record.upstream.fixture_sha256,
      hash(readFileSync(resolve(root, `artifacts/gameplay/${fixture.id}.upstream-fixture.json`))));
  }
  return { ...record, schedules: undefined, schedule_count,
    schedules_sha256: hash(JSON.stringify(record.schedules)) };
});
const health_records = healthFixtures().map(fixture => {
  const record = health.records.find(record => record.fixture === fixture.id);
  assert.equal(record.sha256, hash(JSON.stringify(fixture)), fixture.id);
  assert.equal(record.oracle, 'pinned-upstream-component');
  assert.equal(record.nativeWasmEqual, true);
  assert.equal(record.difference, null);
  return record;
});
const health_sources = sourceInventory(healthFixtures().map(fixture => ({ ...fixture,
  upstream_tests: fixture.upstream_test ? [fixture.upstream_test] : [],
  source_symbols: ['osu.Game.Rulesets.Osu/Scoring/OsuHealthProcessor.cs'],
})), process.env.OSU_REFERENCE_CHECKOUT || resolve(root, '.reference/osu'));
const findings = { ...gameplay, records: compact(gameplayFixtures(), gameplay, 17), health: health_records,
  sources: [...gameplay.sources, ...health_sources], workloads: compact(gameplayWorkloads(), workloads, 2),
  reproduce: ['npm --prefix engine test', 'npm --prefix engine run test:simulation:upstream',
    'npm --prefix engine run test:gameplay:upstream', 'node engine/scripts/retain-gameplay-findings.mjs'],
  m2_complete: false };
writeFileSync(resolve(root, 'reference/findings/m2-gameplay-backfill.json'), JSON.stringify(findings, null, 2) + '\n');
console.log(`Retained ${findings.records.length} gameplay, ${findings.health.length} health and ${findings.workloads.length} workload cases.`);
