import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const schema = JSON.parse(readFileSync(new URL('../trace_schema/decoded-map.schema.json', import.meta.url), 'utf8'));

// This closed schema uses only these JSON Schema keywords. Unsupported schema
// features are not introduced without extending and testing this validator.
function validate(value, rule, path) {
  const fail = message => { throw new Error(`${path}: ${message}`); };
  if ('const' in rule && value !== rule.const) fail('unexpected constant');
  if (rule.enum && !rule.enum.includes(value)) fail('unknown enum value');
  if (rule.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('expected object');
    for (const key of rule.required) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(rule.properties, key)) fail(`unknown field ${key}`);
      validate(item, rule.properties[key], `${path}.${key}`);
    }
  } else if (rule.type === 'array') {
    if (!Array.isArray(value)) fail('expected array');
    value.forEach((item, index) => validate(item, rule.items, `${path}.${index}`));
  } else if (rule.type === 'number' || rule.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('expected finite number');
    if (rule.type === 'integer' && !Number.isSafeInteger(value)) fail('expected safe integer');
    if (value < rule.minimum || value > rule.maximum) fail('out of bounds');
  } else if (rule.type && typeof value !== rule.type) fail(`expected ${rule.type}`);
}

export function validateTrace(trace) { validate(trace, schema, '$'); }

// Exact comparison for decoder records. Geometry tolerances belong to the M1
// schema and must never silently relax discrete M0 comparisons.
export function firstDifference(expected, actual, path = '$') {
  if (Object.is(expected, actual)) return null;
  if (typeof expected !== typeof actual || expected === null || actual === null || typeof expected !== 'object') {
    return { path, expected, actual };
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) return { path, expected, actual };
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  if (!Array.isArray(expected)) keys.sort();
  for (const key of keys) {
    if (!Object.hasOwn(expected, key) || !Object.hasOwn(actual, key)) return { path: `${path}.${key}`, expected: expected[key], actual: actual[key] };
    const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('usage: node scripts/trace-diff.mjs expected.json actual.json');
  const [expected, actual] = process.argv.slice(2).map(path => JSON.parse(readFileSync(path, 'utf8')));
  validateTrace(expected); validateTrace(actual);
  const difference = firstDifference(expected, actual);
  console.log(JSON.stringify(difference ?? { equal: true }, null, 2));
  process.exitCode = difference ? 1 : 0;
}
