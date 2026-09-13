import { testDrawABI, testSceneABI } from './draw-abi-test.mjs';
import {testGameplayABI} from './gameplay-abi-test.mjs';
import {testPreparedABI} from './prepared-abi-test.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {root} from './toolchain.mjs';
import { readRecord } from '../abi/records.ts';

// Each access reacquires memory.buffer; no JS object represents a hit object.
export function testABI(wasm) {
 const {memory}=wasm, base=wasm.oe_abi_control(), out=base+256, error=base+320;
 const view=()=>new DataView(memory.buffer);
 const u32=(offset,value)=>view().setUint32(base+offset,value,true);
 const u64=(offset,value)=>view().setBigUint64(base+offset,BigInt(value),true);
 const result=()=>view().getBigUint64(out,true);
 const header=(kind,size)=>{new Uint8Array(memory.buffer,base,256).fill(0);u32(0,kind|(1<<16));u32(4,size)};
 const engine=()=>{header(1,16);u32(8,1);assert.equal(wasm.oe_engine_create(base,out,error),0);return result()};
 const reserve=(e,text)=>{
  const bytes=Buffer.from(text);assert.equal(wasm.oe_buffer_reserve(e,1,BigInt(bytes.length),out),0);
  const ptr=Number(result()),token=view().getBigUint64(out+16,true);
  new Uint8Array(memory.buffer,ptr,bytes.length).set(bytes);return {token,count:bytes.length};
 };
 const prepare=(e,input,flags=1)=>{header(2,32);u64(8,input.token);u32(20,input.count);u32(24,flags);return wasm.oe_map_prepare(e,base,out,error)};
 const session=(e,m,bytes)=>{header(3,32);u32(8,1);u64(16,bytes);assert.equal(wasm.oe_session_create(e,m,base,out,error),0);return result()};
 const native=JSON.parse(execFileSync(resolve(root,'artifacts/abi-native'),{encoding:'utf8'}));
 assert.deepEqual(native.capabilities,[65540,64,2,0,1,0,14,128,8388608,0,67108864,0,1,0,202608042,3]);
 assert.deepEqual(native.statuses,[1,0,0,0,0,0,0,0,0,3,0,0,0,0,9]);
 const text='osu file format v14\n[TimingPoints]\n100,500\n[HitObjects]\n0,0,0,1,0';
 assert.equal(wasm.oe_engine_create(0,out,error),1);
 assert.deepEqual(Array.from({length:16},(_,i)=>view().getUint32(error+4*i,true)),native.error);
 header(1,8);assert.equal(wasm.oe_engine_create(base,out,error),1);
 header(1,264);assert.equal(wasm.oe_engine_create(base,out,error),1);
 header(99,16);assert.equal(wasm.oe_engine_create(base,out,error),3);
 header(1,16);u32(0,1|(2<<16));assert.equal(wasm.oe_engine_create(base,out,error),3);
 header(1,16);u32(8,1);assert.equal(wasm.oe_engine_create(base,base,error),1);
 const first=engine(), other=engine();
 assert.equal(wasm.oe_engine_capabilities(first,out),0);
 const cap=Number(result());
 assert.equal(readRecord(view(),cap,4).abi_major,2);
 assert.throws(()=>readRecord(view(),cap+1,4));
 assert.throws(()=>readRecord(new DataView(memory.buffer,cap,8),0,4));
 assert.deepEqual(Array.from({length:16},(_,i)=>view().getUint32(cap+4*i,true)),[65540,64,2,0,1,0,14,128,8388608,0,67108864,0,1,0,202608042,3]);
 const input=reserve(first,text);
 assert.equal(prepare(first,{...input,token:input.token+1n}),1);
 assert.equal(prepare(first,{...input,count:0xffffffff}),1);
 assert.equal(prepare(other,input),1);
 assert.equal(prepare(first,input),0);const map=result();
 assert.equal(wasm.oe_map_retain(other,map),9);
 assert.equal(wasm.oe_map_retain(first,first),9);
 assert.equal(wasm.oe_map_describe(first,map,out),0);
 const desc=Number(result());assert.equal(view().getUint32(desc+16,true),1);
 // Failed replacement and failed reserve preserve the old map and inbox token.
 assert.equal(wasm.oe_buffer_reserve(first,1,0xffffffffffffffffn,out),4);
 assert.equal(prepare(first,input),0);assert.equal(wasm.oe_map_release(first,result()),0);
 const invalid=reserve(first,'invalid');assert.equal(prepare(first,invalid),5);
 assert.equal(view().getUint32(error+12,true),1);
 assert.equal(wasm.oe_map_describe(first,map,out),0);
 assert.equal(prepare(first,input),1);
 const s=session(first,map,128);
 for(const [kind,invoke] of [[2,address=>wasm.oe_map_prepare(first,address,out,error)],[3,address=>wasm.oe_session_create(first,map,address,out,error)]]) {
  for(const [recordKind,version,size,address,expected] of [[kind,1,8,base,1],[kind,1,264,base,1],[999,1,32,base,3],[kind,2,32,base,3],[kind,1,32,base+1,1]]) {
   header(recordKind,size);u32(0,recordKind|(version<<16));const retained=result();
   assert.equal(invoke(address),expected);assert.equal(result(),retained);
  }
 }
 assert.equal(wasm.oe_engine_capabilities(first,0),1);
 assert.equal(wasm.oe_map_describe(first,map,0),1);
 assert.equal(wasm.oe_buffer_reserve(first,1,1n,0),1);
 for(const [fn,args] of [['inputs',[0,error]],['inputs_from_reserved',[0n,0,error]],['advance',[0,0]],['snapshot',[0,0]],['pause',[0,0]],['resume',[0]],['result',[0]]]) assert.equal(wasm['oe_session_'+fn](first,s,...args),3);
 assert.equal(wasm.oe_session_reset(first,s,NaN),1);
 assert.equal(wasm.oe_session_reset(first,s,Infinity),1);
 assert.equal(wasm.oe_session_reset(first,s,-500),0);
 assert.equal(wasm.oe_engine_release(first),0);assert.equal(wasm.oe_engine_release(first),0);
 assert.equal(wasm.oe_session_reset(first,s,0),9);
 for(const [fn,args] of [['inputs',[0,error]],['inputs_from_reserved',[0n,0,error]],['advance',[0,0]],['snapshot',[0,0]],['pause',[0,0]],['resume',[0]],['result',[0]]]) assert.equal(wasm['oe_session_'+fn](first,s,...args),9);
 assert.equal(wasm.oe_map_retain(first,map),9);assert.equal(wasm.oe_map_release(first,map),9);
 assert.equal(wasm.oe_map_describe(first,map,out),9);assert.equal(wasm.oe_engine_capabilities(first,out),9);
 assert.equal(wasm.oe_buffer_reserve(first,1,1n,out),9);
 assert.equal(wasm.oe_engine_release(other),0);
 const pages=[];let growthObserved=false;
 for(let cycle=0;cycle<50;cycle++) {
  const e=engine();assert.equal(wasm.oe_engine_release(first),9);
  const large=cycle%2===1;
  const mapText=large ? text+'\n'+'0,0,1,1,0\n'.repeat(9999) : text;
  assert.equal(prepare(e,reserve(e,mapText)),0);const m=result();
  assert.equal(wasm.oe_map_retain(e,m),0);
  assert.equal(wasm.oe_map_describe(e,m,out),0);const d=Number(result());
  const sessions=[];
  for(let n=0;n<4;n++) {const before=memory.buffer;sessions.push(session(e,m,large?4*1024*1024:128));if(before!==memory.buffer){growthObserved=true;assert.equal(before.byteLength,0)}}
  assert.equal(view().getUint32(d+16,true),large?10000:1);
  assert.equal(wasm.oe_map_release(e,m),0);assert.equal(wasm.oe_map_release(e,m),0);assert.equal(wasm.oe_map_release(e,m),0);
  assert.equal(wasm.oe_map_describe(e,m,out),9);
  for(const h of sessions)for(let reset=0;reset<20;reset++)assert.equal(wasm.oe_session_reset(e,h,reset),0);
  assert.equal(wasm.oe_session_release(e,sessions[0]),0);assert.equal(wasm.oe_session_release(e,sessions[0]),0);
  assert.equal(wasm.oe_engine_release(e),0);assert.equal(wasm.oe_engine_release(e),0);
  pages.push(memory.buffer.byteLength/65536);
 }
 assert.ok(growthObserved,'matrix must force WASM growth');
 assert.equal(pages.at(-1),pages.at(-5),'linear memory high water must plateau');
 const preparedABI=testPreparedABI(wasm);
 const oomEngine=engine();const oomInput=reserve(oomEngine,text+'\n256,192,1000,2,0,L|456:192,2,300');assert.equal(prepare(oomEngine,oomInput,2),0);const oomMap=result();
 let allocationFailure=false;
 for(let n=0;n<5;n++) {
  header(3,32);u32(8,1);u64(16,64*1024*1024);const retained=result();
  const status=wasm.oe_session_create(oomEngine,oomMap,base,out,error);
  if(status===10){allocationFailure=true;assert.equal(result(),retained);break}
  assert.equal(status,0);
 }
 assert.ok(allocationFailure,'real WASM memory ceiling must return OUT_OF_MEMORY');
 // Fill the remaining pages, then exercise failure in full M1 candidate creation.
 let exhausted=false;
 for(let index=0;index<80;index++){
  header(3,32);u32(8,1);u64(16,1024*1024);
  const status=wasm.oe_session_create(oomEngine,oomMap,base,out,error);
  if(status===10){exhausted=true;break}assert.equal(status,0);
 }
 assert.ok(exhausted);
 const preparedRetained=result();
 assert.equal(prepare(oomEngine,oomInput,2),10);
 assert.equal(result(),preparedRetained);
 assert.equal(wasm.oe_map_describe(oomEngine,oomMap,out),0);
 assert.equal(wasm.oe_engine_release(oomEngine),0);
 const engines=[];
 for(let n=0;n<256;n++)engines.push(engine());
 header(1,16);u32(8,1);const retained=result();assert.equal(wasm.oe_engine_create(base,out,error),4);assert.equal(result(),retained);
 for(const e of engines)assert.equal(wasm.oe_engine_release(e),0);
 testGameplayABI(wasm,native.gameplay);
 testDrawABI(wasm, native.circle_draw);
 testSceneABI(wasm, native.scene_draw, native.scene_resources);
 console.log(`ABI v2: 50 lifecycle cycles, four shared sessions, 4000 resets; WASM high water ${pages.at(-1)} pages.`);
 return {preparedABI,preparedAllocationFailure:true,acceptance:['A24','A25'],oracle:'local-contract-tests',cycles:50,sessionsPerMap:4,resets:4000,growthObserved,allocationFailure,highWaterPages:memory.buffer.byteLength/65536,steadyStatePages:pages.at(-1)};
}
