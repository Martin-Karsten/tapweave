import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from './toolchain.mjs';
import {preparedFixtures} from './prepared-fixtures.mjs';
import {readRecord} from '../abi/records.ts';
export function testPreparedABI(wasm){
 const base=wasm.oe_abi_control(),out=base+256,error=base+320;
 const view=()=>new DataView(wasm.memory.buffer);
 const result=()=>view().getBigUint64(out,true);
 function header(kind,size){new Uint8Array(wasm.memory.buffer,base,256).fill(0);view().setUint32(base,kind|65536,true);view().setUint32(base+4,size,true)}
 header(1,16);view().setUint32(base+8,1,true);assert.equal(wasm.oe_engine_create(base,out,error),0);const engine=result();
 assert.equal(wasm.oe_preparation_capabilities(engine,out),0);
 assert.equal(readRecord(view(),Number(result()),14).preparation_version,2);
 assert.equal(wasm.oe_preparation_capabilities(engine,0),1);
 const fixture=preparedFixtures().find(fixture=>fixture.id==='abi-record-fields');
 mkdirSync(resolve(root,'artifacts/prepared'),{recursive:true});const path=resolve(root,'artifacts/prepared/abi.osu');writeFileSync(path,fixture.text);
 const reference=JSON.parse(execFileSync(resolve(root,'artifacts/prepared-native'),[path],{encoding:'utf8'}));
 function prepare(text){
  const bytes=Buffer.from(text);assert.equal(wasm.oe_buffer_reserve(engine,1,BigInt(bytes.length),out),0);
  const address=Number(result()),token=view().getBigUint64(out+16,true);new Uint8Array(wasm.memory.buffer,address,bytes.length).set(bytes);
  header(2,32);view().setBigUint64(base+8,token,true);view().setUint32(base+20,bytes.length,true);view().setUint32(base+24,2,true);
  return wasm.oe_map_prepare(engine,base,out,error);
 }
 assert.equal(prepare(fixture.text),0);const map=result();
 assert.equal(wasm.oe_map_describe(engine,map,out),0);
 const address=Number(result()),byteCount=view().getUint32(out+8,true);
 function bytes(){return new Uint8Array(wasm.memory.buffer,address,byteCount)}
 const digest=()=>createHash('sha256').update(bytes()).digest('hex');
 assert.equal(digest(),Buffer.from(reference.description_digest).toString('hex'));
 const descriptionView=()=>new DataView(wasm.memory.buffer,address,byteCount);
 const descriptor=readRecord(descriptionView(),0,8);assert.equal(Number(descriptor.total_bytes),byteCount);
 const span=(record,name)=>{
  const offset=record[name+'_offset'],count=record[name+'_count'],stride=record[name+'_stride'];
  assert.ok(Number.isInteger(offset)&&offset%8===0&&offset>=0&&offset<=byteCount);
  assert.ok(Number.isInteger(count)&&count>=0&&Number.isInteger(stride)&&stride>0&&count*stride<=byteCount-offset);
  return {offset,count,stride};
 };
 const string=(record,name)=>{const {offset,count,stride}=span(record,name);assert.equal(stride,1);return new TextDecoder().decode(bytes().subarray(offset,offset+count))};
 const records=(record,name,kind)=>{const {offset,count,stride}=span(record,name);return Array.from({length:count},(_,index)=>readRecord(descriptionView(),offset+index*stride,kind))};
 function samples(record,name){return records(record,name,11).map(sample=>{assert.equal(sample.reserved_68,0);return ({name:string(sample,'name'),bank:string(sample,'bank'),suffix:string(sample,'suffix'),volume:sample.volume|0,use_beatmap:!!sample.use_beatmap,layered:!!sample.layered,candidates:records(sample,'candidates',12).map(candidate=>{assert.equal(candidate.reserved_20,0);return string(candidate,'name')})});})}
 const objects=records(descriptor,'objects',9);assert.equal(objects.length,reference.objects.length);
 for(let index=0;index<objects.length;index++){
  const object=objects[index],expected=reference.objects[index];
  const scalarExpected={...expected,
   kind:{CIRCLE:1,SLIDER:2,SPINNER:8}[expected.kind],
   position_x:expected.position[0],position_y:expected.position[1],
   end_position_x:expected.end_position[0],end_position_y:expected.end_position[1],
   stack_offset_x:expected.stack_offset[0],stack_offset_y:expected.stack_offset[1],
   new_combo:Number(expected.new_combo),last_in_combo:Number(expected.last_in_combo),
   generate_ticks:Number(expected.generate_ticks),reserved_268:0,
  };
  const signedFields=new Set(['stack_height','combo_index','combo_index_with_offsets','index_in_combo','spins_required','maximum_bonus_spins']);
  const arrayNames=['vertices','cumulative','samples','tail_samples','auxiliary_samples','components'];
  for(const [field,value] of Object.entries(object)){
   if(arrayNames.some(name=>field.startsWith(name+'_')))continue;
   assert.ok(Object.hasOwn(scalarExpected,field),`Unverified object field: ${field}`);
   assert.equal(signedFields.has(field)?value|0:value,scalarExpected[field],field);
  }
  for(const field of ['samples','tail_samples','auxiliary_samples'])assert.deepEqual(samples(object,field),expected[field]);
  const vertices=span(object,'vertices');assert.equal(vertices.count,expected.vertices.length);assert.equal(vertices.stride,16);
  for(let point=0;point<vertices.count;point++)for(let axis=0;axis<2;axis++)assert.equal(descriptionView().getFloat64(vertices.offset+point*16+axis*8,true),expected.vertices[point][axis]);
  const cumulative=span(object,'cumulative');assert.equal(cumulative.count,expected.cumulative.length);for(let item=0;item<cumulative.count;item++)assert.equal(descriptionView().getFloat64(cumulative.offset+item*8,true),expected.cumulative[item]);
  const components=records(object,'components',10);assert.equal(components.length,expected.components.length);
  for(let child=0;child<components.length;child++){
   const expectedComponent=expected.components[child];
   const scalarExpected={...expectedComponent,kind:{Head:0,Tick:1,Repeat:2,Tail:3,LegacyLastTick:4,SpinnerTick:5,SpinnerBonusTick:6}[expectedComponent.kind],position_x:expectedComponent.position[0],position_y:expectedComponent.position[1]};
   for(const [field,value] of Object.entries(components[child])){
    if(field.startsWith('samples_'))continue;
    assert.ok(Object.hasOwn(scalarExpected,field),`Unverified component field: ${field}`);
    assert.equal(value,scalarExpected[field],field);
   }
   assert.deepEqual(samples(components[child],'samples'),expectedComponent.samples);
  }
 }
 assert.ok(objects.some(object=>object.combo_offset>0),'Exercise nonzero combo offset');
 assert.equal(descriptor.format_version,reference.format_version);
 assert.deepEqual(records(descriptor,'breaks',15),reference.breaks);
 for(const pointKind of ['timing_points','difficulty_points','sample_points','effect_points']){
  const points=records(descriptor,pointKind,16).map(point=>Object.fromEntries(Object.entries(point).map(([field,value])=>[field,['generate_ticks','kiai','omit_first_bar'].includes(field)?!!value:['source_id','meter','sample_set','sample_index','volume'].includes(field)?value|0:value])));
  assert.deepEqual(points,reference[pointKind],pointKind);
 }
 const playbackRecords=records(descriptor,'playback',17);assert.equal(playbackRecords.length,1);
 const playback=playbackRecords[0];
 for(const [field,value] of Object.entries(reference.playback)){
  if(field==='audio_filename')assert.equal(string(playback,field),value);
  else assert.equal(typeof value==='boolean'?!!playback[field]:playback[field],value,field);
 }
 for(const field of ['hp','cs','od','ar','slider_multiplier','tick_rate'])assert.equal(descriptor[field],reference.difficulty[field],field);
 assert.equal(descriptor.stack_leniency,reference.stack_leniency);
 assert.equal(descriptor.reserved_244,0);
 const schedule=records(descriptor,'schedule',13);assert.equal(schedule.length,reference.schedule.length);
 schedule.forEach((entry,index)=>{for(const key of ['time_ms','object_index','component_index'])assert.equal(entry[key],reference.schedule[index][key])});
 assert.throws(()=>readRecord(new DataView(wasm.memory.buffer,address,8),0,8));
 const originalDigest=digest();assert.equal(prepare('invalid'),5);assert.equal(digest(),originalDigest);
 // Both geometry builds share the production budget; this small map fits the memory quota.
 const controlPoints=Array.from({length:7999},(_,pointIndex)=>`${257+pointIndex}:192`).join('|');
 const workLimitedMap=`osu file format v14\n[HitObjects]\n256,192,1000,2,0,B|${controlPoints},1,1\n`;
 assert.equal(prepare(workLimitedMap),4);
 assert.equal(readRecord(view(),error,7).code,18,'PREPARATION_WORK');
 assert.equal(digest(),originalDigest,'Work exhaustion must preserve the published map');

 let grew=false;const beforeFailedCandidate=wasm.memory.buffer;
 const oversized='osu file format v14\n[TimingPoints]\n0,500\n[HitObjects]\n'+Array(8).fill('256,192,1000,2,14,L|456:192,9000,300').join('\n');
 assert.equal(prepare(oversized),4);if(beforeFailedCandidate!==wasm.memory.buffer)grew=true;assert.equal(digest(),originalDigest);
 const sessions=[];
 for(let index=0;index<4;index++){
  const before=wasm.memory.buffer;header(3,32);view().setUint32(base+8,1,true);view().setBigUint64(base+16,8n*1024n*1024n,true);
  assert.equal(wasm.oe_session_create(engine,map,base,out,error),0);sessions.push(result());if(before!==wasm.memory.buffer)grew=true;
 }
 assert.ok(grew,'prepared lifecycle matrix must exercise detached views');
 assert.equal(digest(),originalDigest);
 assert.equal(wasm.oe_map_release(engine,map),0);assert.equal(wasm.oe_map_describe(engine,map,out),9);
 for(const session of sessions)assert.equal(wasm.oe_session_reset(engine,session,0),0);
 assert.equal(digest(),originalDigest);
 for(const session of sessions)assert.equal(wasm.oe_session_release(engine,session),0);
 assert.equal(wasm.oe_engine_release(engine),0);assert.equal(wasm.oe_preparation_capabilities(engine,out),9);
 console.log(`Prepared ABI: typed records/candidates, failed replacement, shared ownership, reset/disposal, stale handles; growth ${grew}.`);
 return {acceptance:['A24','A25'],oracle:'local-contract-tests',quotaFailure:true,grew,descriptionBytes:byteCount};
}
