import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../gameplay_trace/gameplay.schema.json', import.meta.url)));

// The transport has a closed, dependency-free schema. Keep its small keyword
// subset explicit rather than accepting unvalidated fields in oracle output.
function validate(value, rule, path) {
  if ('const' in rule) assert.equal(value, rule.const, path);
  if (rule.enum) assert.ok(rule.enum.includes(value), `${path}: enum`);
  if (rule.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), path);
    assert.deepEqual(Object.keys(value).sort(), rule.required.toSorted(), `${path}: fields`);
    for (const [field, child] of Object.entries(rule.properties)) validate(value[field], child, `${path}.${field}`);
  } else if (rule.type === 'array') {
    assert.ok(Array.isArray(value), path);
    if ('minItems' in rule) assert.ok(value.length >= rule.minItems, path);
    if ('maxItems' in rule) assert.ok(value.length <= rule.maxItems, path);
    value.forEach((item, item_index) => validate(item, rule.items, `${path}[${item_index}]`));
  } else if (rule.type === 'integer' || rule.type === 'number') {
    assert.ok(Number.isFinite(value), path);
    if (rule.type === 'integer') assert.ok(Number.isSafeInteger(value), path);
    if ('minimum' in rule) assert.ok(value >= rule.minimum, path);
    if ('maximum' in rule) assert.ok(value <= rule.maximum, path);
  } else if (rule.type) assert.equal(typeof value, rule.type, path);
}

export const validateGameplay = observation => validate(observation, schema, observation.id ?? '$');
