import test from 'node:test';
import assert from 'node:assert/strict';
import { RECORD_FIELD_TYPES, RECORD } from '../build/abi-records.js';
import { schema } from '../../../engine/abi/records.mjs';

// The typed record table must mirror the generated ABI schema exactly:
// identical field names per kind in schema order, with u32/f64 mapping to
// number and u64 mapping to bigint. A failing case means src/abi-records.ts
// drifted from engine/abi/records.json.
const value_type_by_schema_type = { u32: 'number', f64: 'number', u64: 'bigint' };

test('typed record fields mirror the generated ABI schema', () => {
  assert.ok(Object.keys(RECORD_FIELD_TYPES).length > 0, 'the typed record table is empty');
  for (const [kind, fields] of Object.entries(RECORD_FIELD_TYPES)) {
    const record = schema.records.find(candidate => candidate.kind === Number(kind));
    assert.ok(record, `kind ${kind} is absent from the generated schema`);
    assert.deepEqual(fields.map(([field_name]) => field_name), Object.keys(record.fields),
      `kind ${kind} field names must match schema order`);
    for (const [field_name, value_type] of fields) {
      const schema_type = record.fields[field_name][1];
      assert.equal(value_type, value_type_by_schema_type[schema_type],
        `kind ${kind} field ${field_name} must map ${schema_type} to ${value_type}`);
    }
  }
});

test('named record kinds mirror the generated ABI schema', () => {
  const expected_kinds = Object.fromEntries(schema.records.map(record => [record.name, record.kind]));
  assert.deepEqual(RECORD, expected_kinds);
});
