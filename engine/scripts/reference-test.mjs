import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { root } from './toolchain.mjs';
import { referenceFixtures } from './fixtures.mjs';
import { firstDifference } from './trace-diff.mjs';
const dotnet=process.env.DOTNET_BIN || 'dotnet';
execFileSync(process.execPath,[resolve(root,'scripts/test.mjs')],{stdio:'inherit'});
execFileSync(process.execPath,[resolve(root,'scripts/verify-sources.mjs'),'--require-checkouts'],{stdio:'inherit'});
execFileSync(dotnet,['restore',resolve(root,'reference-host/ReferenceHost.csproj'),'--locked-mode'],{stdio:'inherit'});
execFileSync(dotnet,['build',resolve(root,'reference-host/ReferenceHost.csproj'),'--no-restore','-p:RunAnalyzers=false'],{stdio:'inherit'});
const dir=resolve(root,'artifacts/reference'); mkdirSync(dir,{recursive:true});
const fixtures=referenceFixtures();
const paths=fixtures.map(f=>{const p=resolve(dir,f.id+'.osu');writeFileSync(p,f.text);return p});
const output=execFileSync(dotnet,[resolve(root,'reference-host/bin/Debug/net10.0/ReferenceHost.dll'),...paths],{encoding:'utf8',maxBuffer:64*1024*1024});
const observations=output.split('\n').filter(l=>l.startsWith('{')).map(JSON.parse);
if(observations.length!==fixtures.length) throw Error('Missing upstream observations');
const point = ({source_id,...p}) => ({...p,sample_set:({0:'normal',1:'normal',2:'soft',3:'drum'})[p.sample_set] ?? String(p.sample_set)});
const records=[];
for(let i=0;i<fixtures.length;i++) {
 const f=fixtures[i], upstream=observations[i];
 if(upstream.sha256!==createHash('sha256').update(f.text).digest('hex'))throw Error('Fixture hash mismatch');
 const local=JSON.parse(execFileSync(resolve(root,'artifacts/decode-native'),[paths[i]],{encoding:'utf8'}));
 const o=upstream.observation;
 if(local.error.status!==f.expectedStatus)throw Error('Local expected status mismatch: '+f.id);
 let difference=null, classification='upstream-observed-exact';
 // Explicit supported-version policy differs from upstream's permissive header registry.
 if(f.id.startsWith('unsupported-')) classification='documented-version-policy';
 else if(f.id==='unknown-object') classification='documented-ruleset-object-policy';
 else if(f.id==='missing-header') classification='documented-header-policy';
 else if(local.error.status!=='OK' && o.accepted && o.line_errors?.length) {
  classification='documented-transactional-error-policy';
  if(local.error.status!==f.expectedStatus) difference={expected:f.expectedStatus,actual:local.error.status};
 }
 else if(!o.accepted || local.error.status!=='OK') {
  if(o.accepted !== (local.error.status==='OK')) difference={upstream:o,local:local.error};
  classification='upstream-rejection-observed-local-typed-error';
 } else {
  const {sample_set,sample_volume,...general}=local.general;
  const control_points=Object.fromEntries(Object.entries(local.control_points).map(([k,v])=>[k,v.map(point)]));
  const projected={accepted:true,format_version:local.format_version,difficulty:local.difficulty,stack_leniency:local.stack_leniency,metadata:local.metadata,general,breaks:local.breaks,objects:local.objects.map(({time_ms,x,y,new_combo,combo_offset})=>({time_ms,x,y,new_combo,combo_offset})),control_points};
  const {line_errors,...expected}=o;
  projected.queries=local.queries.map(({time_ms,...q})=>({time_ms,...Object.fromEntries(Object.entries(q).map(([k,p])=>[k,point(p)]))}));
  difference=firstDifference(expected,projected);
 }
 records.push({fixture:f.id,sha256:upstream.sha256,acceptance:f.acceptance,oracle:classification,observationSha256:createHash('sha256').update(JSON.stringify(upstream)).digest('hex'),queryCount:o.queries?.length??0,lineErrors:o.line_errors??[],difference,sourceCommit:upstream.source_commit,frameworkCommit:upstream.framework_commit});
 writeFileSync(resolve(dir,f.id+'.json'),JSON.stringify(upstream,null,2)+'\n');
}
const lockHash=createHash('sha256').update(readFileSync(resolve(root,'reference-host/packages.lock.json'))).digest('hex');
const foundation=JSON.parse(readFileSync(resolve(root,'artifacts/acceptance.json'),'utf8'));
const report={schemaVersion:1,lockHash,foundation,comparison:'native/WASM exact traces and pinned upstream M0 projection including queries',records};
writeFileSync(resolve(dir,'report.json'),JSON.stringify(report,null,2)+'\n');
const failures=records.filter(r=>r.difference);
console.log(JSON.stringify(failures,null,2));
console.log(`${records.length} pinned H01/H02 observations; ${failures.length} unexplained differences.`);
if(failures.length)process.exitCode=1;
