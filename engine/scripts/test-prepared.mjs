import './verify-sources.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash,randomFillSync} from 'node:crypto';
import {root,compile,verifyCompiler} from './toolchain.mjs';
import {preparedFixtures} from './prepared-fixtures.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const compiler=verifyCompiler();
if(process.argv.includes('--upstream'))execFileSync(process.execPath,[resolve(root,'scripts/test.mjs')],{stdio:'inherit'});
const directory=resolve(root,'artifacts/prepared');mkdirSync(directory,{recursive:true});
compile(['build','prepared_native','-o:speed','-out:artifacts/prepared-native']);
compile(['build','prepared_wasm','-target:js_wasm32','-o:speed','-out:artifacts/prepared.wasm','-extra-linker-flags:--export-memory --max-memory=268435456']);
const fixtures=preparedFixtures();
const paths=fixtures.map(fixture=>{const path=resolve(directory,fixture.id+'.osu');writeFileSync(path,fixture.text);return path});
let memory;
const {instance}=await WebAssembly.instantiate(readFileSync(resolve(root,'artifacts/prepared.wasm')),{odin_env:{
 sin:Math.sin,cos:Math.cos,tick_now:()=>performance.now(),
 rand_bytes(pointer,count){randomFillSync(new Uint8Array(memory.buffer,pointer,count))},
 write(fd,pointer,count){(fd===2?process.stderr:process.stdout).write(new Uint8Array(memory.buffer,pointer,count));return count},
}});
const wasm=instance.exports;memory=wasm.memory;
const schema=JSON.parse(readFileSync(resolve(root,'prepared_trace/prepared.schema.json')));
function validate(value,definition,path='trace'){
 if(definition.$ref)return validate(value,schema.$defs[definition.$ref.split('/').at(-1)],path);
 if(definition.const!==undefined)assert.equal(value,definition.const,path);
 if(definition.enum)assert.ok(definition.enum.includes(value),path);
 if(definition.type==='number'||definition.type==='integer'){assert.ok(Number.isFinite(value),path);if(definition.type==='integer')assert.ok(Number.isInteger(value),path);return}
 if(definition.type==='boolean'||definition.type==='string'){assert.equal(typeof value,definition.type,path);return}
 if(definition.type==='array'){assert.ok(Array.isArray(value),path);if(definition.minItems!==undefined)assert.ok(value.length>=definition.minItems,path);if(definition.maxItems!==undefined)assert.ok(value.length<=definition.maxItems,path);value.forEach((item,index)=>validate(item,definition.items,`${path}[${index}]`));return}
 if(definition.type==='object'){assert.deepEqual(Object.keys(value).sort(),definition.required.toSorted(),path);for(const key of definition.required)validate(value[key],definition.properties[key],`${path}.${key}`)}
}
const native=[];const statistics=[];let growthCount=0;
for(let index=0;index<fixtures.length;index++){
 const fixture=fixtures[index];const nativeText=execFileSync(resolve(root,'artifacts/prepared-native'),[paths[index]],{encoding:'utf8',maxBuffer:128e6}).trim();
 const input=Buffer.from(fixture.text);const before=memory.buffer.byteLength;
 const pointer=wasm.prepared_reserve(input.length);assert.ok(pointer);
 new Uint8Array(memory.buffer,pointer,input.length).set(input);
 const count=wasm.prepared_run();assert.ok(count,fixture.id);
 const wasmText=new TextDecoder().decode(new Uint8Array(memory.buffer,wasm.prepared_output(),count));
 assert.ok(nativeText===wasmText,`Native/WASM preparation differs: ${fixture.id}`);
 if(memory.buffer.byteLength>before)growthCount++;
 const trace=JSON.parse(nativeText);validate(trace,schema);native.push(trace);
 writeFileSync(paths[index]+'.local.json',nativeText);
 statistics.push({fixture:fixture.id,...JSON.parse(execFileSync(resolve(root,'artifacts/prepared-native'),[paths[index],'--stats'],{encoding:'utf8'}))});
 wasm.prepared_dispose();
}
wasm.prepared_dispose();assert.equal(wasm.prepared_reserve(0xffffffff),0);
assert.throws(()=>validate({...native[0],schema_version:999},schema));
let upstream;let dotnetVersion=null;
if(process.argv.includes('--upstream')){
 const dotnet=process.env.DOTNET_BIN||'dotnet';dotnetVersion=execFileSync(dotnet,['--version'],{encoding:'utf8'}).trim();
 execFileSync(process.execPath,[resolve(root,'scripts/verify-sources.mjs'),'--require-checkouts'],{stdio:'inherit'});
 const project=resolve(root,'reference-host/ReferenceHost.csproj');
 execFileSync(dotnet,['restore',project,'--locked-mode'],{stdio:'inherit'});
 execFileSync(dotnet,['build',project,'--no-restore','-c','Release','-p:RunAnalyzers=false'],{stdio:'inherit'});
 const text=execFileSync(dotnet,[resolve(root,'reference-host/bin/Release/net10.0/ReferenceHost.dll'),'--prepared',...paths],{encoding:'utf8',maxBuffer:128e6});
 upstream=text.split('\n').filter(line=>line.startsWith('{')).map(JSON.parse);assert.equal(upstream.length,fixtures.length);
}
const childKinds={Head:'SliderHeadCircle',Tick:'SliderTick',Repeat:'SliderRepeat',Tail:'SliderTailCircle',SpinnerTick:'SpinnerTick',SpinnerBonusTick:'SpinnerBonusTick'};
const differences=[];const records=[];
for(let index=0;index<fixtures.length;index++){
 const fixture=fixtures[index],actual=native[index],expected=upstream?.[index];
 let maximumError=0,signedError=0,values=0,exact=true;
 function compare(local,reference,path){
  if(typeof reference==='number'){
   const error=local-reference;maximumError=Math.max(maximumError,Math.abs(error));signedError+=error;values++;if(error!==0)exact=false;
   const geometric=/\.(vertices|cumulative|calculated_distance|path_distance)(\.|$)/.test(path);
   const position=/\.(position|end_position|stack_offset)\./.test(path);
   // Existing tolerances; discrete state and integral times remain exact.
   const tolerance=geometric?1e-4:position?1e-6:Number.isInteger(reference)?0:Math.max(1e-9,Math.abs(reference)*1e-12);
   if(!Number.isFinite(local)||Math.abs(error)>tolerance)differences.push({fixture:fixture.id,path,local,reference,tolerance});return;
  }
  if(reference===null||typeof reference!=='object'){if(local!==reference)differences.push({fixture:fixture.id,path,local,reference});return}
  if(Array.isArray(reference)&&local?.length!==reference.length){differences.push({fixture:fixture.id,path,localLength:local?.length,referenceLength:reference.length});return}
  for(const key of Object.keys(reference))compare(local?.[key],reference[key],`${path}.${key}`);
 }
 if(expected){
  const projected={objects:actual.objects.map(object=>({...object,
   events:object.kind==='SLIDER'?object.components.map(component=>({kind:component.kind,time_ms:component.event_time_ms,span_start_ms:component.span_start_ms,span_index:component.span_index,progress:component.progress})):[],
   children:object.components.filter(component=>component.kind!=='LegacyLastTick').map(component=>({kind:childKinds[component.kind],time_ms:component.time_ms,position:component.position,samples:component.samples})).sort((first,second)=>first.time_ms-second.time_ms),
  }))};
  compare(projected,expected,'trace');writeFileSync(paths[index]+'.upstream.json',JSON.stringify(expected));
 }
 const zeroDuration=actual.objects.some(object=>object.kind==='SLIDER'&&object.span_duration===0);
 const disabledTicks=actual.objects.some(object=>object.kind==='SLIDER'&&!object.generate_ticks);
 records.push({fixture:fixture.id,sha256:hash(fixture.text),source:fixture.source??'synthetic-project-fixture',acceptance:['A08','A09','A10','A11'],experiments:['H03','H04'],nativeWasmEqual:true,
  oracle:expected?(zeroDuration||disabledTicks?'pinned-upstream-with-canonical-policy':exact?'pinned-upstream-exact':'pinned-upstream-within-existing-tolerances'):'local-consistency-only',
  upstreamSha256:expected?hash(JSON.stringify(expected)):null,traceSha256:hash(JSON.stringify(actual)),maximumNumericError:expected?maximumError:null,meanSignedNumericError:expected&&values?signedError/values:null,
  canonicalPolicy:[zeroDuration?'Non-finite upstream legacy-marker progress is encoded as 0; marker is not a scoring child.':null,disabledTicks?'Infinite disabled tick distance is encoded as 0 with generate_ticks=false.':null].filter(Boolean),
 });
}
const manifest=JSON.parse(readFileSync(resolve(root,'reference/source-manifest.json')));
const findings={schemaVersion:1,compiler,sourceCommit:manifest.osu.commit,frameworkCommit:manifest.framework.commit,dotnetVersion,upstreamExecuted:!!upstream,
 lifecycle:process.argv.includes('--upstream')?JSON.parse(readFileSync(resolve(root,'artifacts/acceptance.json'))).lifecycle:null,
 dependencyLockSha256:hash(readFileSync(resolve(root,'reference-host/packages.lock.json'))),nativeWasmGrowthEvents:growthCount,records,differences,statistics};
writeFileSync(resolve(directory,'acceptance.json'),JSON.stringify(findings,null,2)+'\n');
assert.equal(differences.length,0,JSON.stringify(differences.slice(0,12),null,2));
if(upstream)writeFileSync(resolve(root,'reference/findings/m1.json'),JSON.stringify(findings,null,2)+'\n');
console.log(`${fixtures.length} complete-map traces and binary-description digests match native/WASM; upstream ${upstream?'H03/H04 comparisons passed':'not executed'}.`);
