import assert from 'node:assert/strict';
import {readRecord} from '../abi/records.ts';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {root} from './toolchain.mjs';

const mapText = 'osu file format v14\n[Difficulty]\nHPDrainRate:0\nOverallDifficulty:5\nSliderMultiplier:1\nSliderTickRate:1\n[TimingPoints]\n0,1000\n[HitObjects]\n64,64,1000,1,0\n100,100,2000,2,0,L|200:100,1,100\n256,192,4000,8,0,6000\n320,192,7000,1,0\n';
const frames = [[1000,64,64,1],[1500,64,64,0],[2000,100,100,1],[2900,190,100,1],[3200,190,100,0],...Array.from({length:21},(_,frameIndex)=>[4000+frameIndex*50,...[[356,192],[256,292],[156,192],[256,92]][frameIndex%4],1]),[6500,320,192,0],[7000,320,192,1]];

export function testGameplayABI(wasm, nativeResult) {
  const mailbox = wasm.oe_abi_control(), output = mailbox + 256, error = mailbox + 320;
  const view = () => new DataView(wasm.memory.buffer);
  const integer = (offset, number) => view().setUint32(mailbox + offset, number, true);
  const wide = (offset, number) => view().setBigUint64(mailbox + offset, BigInt(number), true);
  const real = (offset, number) => view().setFloat64(mailbox + offset, number, true);
  const handle = () => view().getBigUint64(output, true);
  const record = (kind, size) => {
    new Uint8Array(wasm.memory.buffer, mailbox, 256).fill(0);
    integer(0, kind | 65536); integer(4, size);
  };
  const copySpan = () => new Uint8Array(wasm.memory.buffer, Number(handle()), view().getUint32(output + 8, true)).slice();
  const readSnapshot = () => readRecord(view(), Number(handle()), 19);
  record(1,16); integer(8,1);
  assert.equal(wasm.oe_engine_create(mailbox,output,error),0);
  const engine = handle();
  const reserve = bytes => {
    assert.equal(wasm.oe_buffer_reserve(engine,1,BigInt(bytes.length),output),0);
    const token = view().getBigUint64(output+16,true);
    new Uint8Array(wasm.memory.buffer,Number(handle()),bytes.length).set(bytes);
    return token;
  };
  const mapBytes = Buffer.from(mapText), mapToken = reserve(mapBytes);
  record(2,32); wide(8,mapToken); integer(20,mapBytes.length); integer(24,2);
  assert.equal(wasm.oe_map_prepare(engine,mailbox,output,error),0);
  const map = handle();
  const createSession = () => {
    record(18,40); integer(8,2); wide(16,65536); integer(32,64);
    assert.equal(wasm.oe_session_create(engine,map,mailbox,output,error),0);
    return handle();
  };
  const frameBytes = new Uint8Array(frames.length * 64), frameView = new DataView(frameBytes.buffer);
  frames.forEach(([time,x,y,actions],frameIndex) => {
    const offset = frameIndex * 64;
    frameView.setUint32(offset,23|65536,true); frameView.setUint32(offset+4,64,true);
    frameView.setBigUint64(offset+8,BigInt(frameIndex+1),true);
    for (const [fieldOffset,number] of [[16,time],[24,time],[32,x],[40,y]]) frameView.setFloat64(offset+fieldOffset,number,true);
    frameView.setUint32(offset+48,actions,true);
  });
  let exportedReplay;
  for (const cadence of [8000,1000/30,1000/60,1000/120,1000/144]) {
    const session = createSession(), token = reserve(frameBytes);
    assert.equal(wasm.oe_session_inputs_from_reserved(engine,session,token+1n,frames.length,error),1);
    assert.equal(wasm.oe_session_inputs_from_reserved(engine,session,token,frames.length,error),0);
    record(28,32); integer(8,0); integer(12,0xffffffff); integer(16,0); integer(20,0); wide(24,123);
    assert.equal(wasm.oe_session_bind_sample(engine,session,mailbox),0);
    const memoryBefore = wasm.memory.buffer;
    assert.equal(wasm.oe_session_advance(engine,session,1000,0),1);
    assert.equal(wasm.oe_session_snapshot(engine,session,100000,output),0);
    assert.equal(readSnapshot().committed_ms,0);
    assert.equal(wasm.oe_session_result(engine,session,output),2);
    for (let target=0;target<8000;target+=cadence) {
      assert.equal(wasm.oe_session_advance(engine,session,target,output),0);
      const snapshot = readSnapshot();
      assert.equal(wasm.oe_session_snapshot(engine,session,-123,output),0);
      assert.equal(readSnapshot().committed_ms,snapshot.committed_ms);
      assert.equal(readSnapshot().score,snapshot.score);
    }
    assert.equal(wasm.oe_session_advance(engine,session,8000,output),0);
    const snapshot = readSnapshot();
    assert.equal(snapshot.state,3); assert.equal(snapshot.score,1000050n);
    assert.equal(snapshot.judgements_count,18);
    assert.ok(snapshot.audio_count>0);
    const firstAudio=readRecord(view(),Number(handle())+snapshot.audio_offset,27);
    assert.equal(firstAudio.asset_id,123n);
    assert.equal(wasm.oe_session_bind_sample(engine,session,mailbox),2);
    assert.equal(wasm.memory.buffer,memoryBefore,'hot path grew WASM memory');
    assert.equal(wasm.oe_session_acknowledge(engine,session,snapshot.batch_token),0);
    assert.equal(wasm.oe_session_snapshot(engine,session,8000,output),0);
    assert.equal(readSnapshot().judgements_count,0); assert.equal(readSnapshot().audio_count,0);
    assert.equal(wasm.oe_session_result(engine,session,output),0);
    assert.deepEqual(Array.from(copySpan()),nativeResult,'production native/WASM final record');
    assert.equal(wasm.oe_session_replay_export(engine,session,output),0);
    exportedReplay=copySpan();
    assert.equal(wasm.oe_session_reset(engine,session,0),0);
    assert.equal(wasm.oe_session_acknowledge(engine,session,snapshot.batch_token),1);
    assert.equal(wasm.oe_session_pause(engine,session,500,output),0);
    assert.equal(readSnapshot().state,2);
    assert.equal(wasm.oe_session_advance(engine,session,600,output),2);
    record(22,40); real(8,500); real(16,100); real(24,1);
    assert.equal(wasm.oe_session_resume(engine,session,mailbox),0);
    assert.equal(wasm.oe_session_advance(engine,session,NaN,output),1);
    assert.equal(wasm.oe_session_advance(engine,session,499,output),7);
    assert.equal(wasm.oe_session_release(engine,session),0);
    assert.equal(wasm.oe_session_snapshot(engine,session,0,output),9);
  }
  const replaySession=createSession();
  const corruptReplay=exportedReplay.slice(); corruptReplay[200]^=1;
  const corruptToken=reserve(corruptReplay);
  assert.equal(wasm.oe_session_replay_load(engine,replaySession,corruptToken,corruptReplay.length),1);
  const replayToken=reserve(exportedReplay);
  assert.equal(wasm.oe_session_replay_load(engine,replaySession,replayToken,exportedReplay.length),0);
  assert.equal(wasm.oe_session_advance(engine,replaySession,8000,output),0);
  assert.equal(wasm.oe_session_result(engine,replaySession,output),0);
  assert.deepEqual(Array.from(copySpan()),nativeResult,'record/export/import final equality');
  assert.equal(wasm.oe_session_replay_seek(engine,replaySession,2500,output),0);
  assert.equal(readSnapshot().committed_ms,2500); assert.equal(readSnapshot().audio_count,0);
  assert.equal(wasm.oe_session_advance(engine,replaySession,8000,output),0);
  assert.equal(wasm.oe_session_result(engine,replaySession,output),0);
  assert.deepEqual(Array.from(copySpan()),nativeResult,'checkpoint resimulation final equality');
  assert.equal(wasm.oe_engine_release(engine),0);
  const report = {
    oracle:'local-contract-tests', upstreamVerified:false, fullAcceptance:false,
    acceptance:['A13','A14','A15','A16','A17','A18','A19','A20','A23','A24','A25'],
    sourceCommit:'3c1c96f742e7aae2ff67a7361e058fe91ca3b955',
    frameworkCommit:'f02756c5aa5032e6d04729922702b8d56c4bc2eb',
    mapSHA256:createHash('sha256').update(mapBytes).digest('hex'),
    inputSHA256:createHash('sha256').update(frameBytes).digest('hex'),
    finalRecordSHA256:createHash('sha256').update(Uint8Array.from(nativeResult)).digest('hex'),
    schedules:['direct','30Hz','60Hz','120Hz','144Hz'],
    checks:['native/WASM final bytes','snapshot non-mutation','pause/resume/reset','retained map lifetime','stale handles/tokens','output acknowledgement','sample availability','replay checksum rejection','record/export/import','initial checkpoint seek','no hot-path WASM growth'],
    reproduce:'ODIN_WASM_LD_DIR=/opt/homebrew/opt/lld@20/bin npm --prefix engine test'
  };
  writeFileSync(resolve(root,'artifacts/gameplay-acceptance.json'),JSON.stringify(report,null,2)+'\n');
  console.log('Production gameplay ABI: native/WASM final bytes, five cadences, audio ack, replay and pause/reset checks passed.');
}
