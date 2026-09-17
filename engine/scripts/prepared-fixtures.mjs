import {readFileSync} from 'node:fs';
import {root} from './toolchain.mjs';
import {resolve} from 'node:path';
export function preparedFixtures(){
 const result=[];
 const add=(id,objects,options={})=>result.push({id,text:`osu file format v${options.version??14}\n[General]\nMode:0\nStackLeniency:${options.leniency??0.7}\n[Difficulty]\nHPDrainRate:5\nCircleSize:${options.cs??5}\nOverallDifficulty:${options.od??5}\nApproachRate:${options.ar??5}\nSliderMultiplier:1.4\nSliderTickRate:${options.tickRate??1}\n[TimingPoints]\n${options.timing??'0,500,4,1,2,70,1,0'}\n[HitObjects]\n${objects}\n`});
 const circle=(time=1000,x=256,y=192,flags=1,sound=0,sample='0:0:0:0:')=>`${x},${y},${time},${flags},${sound},${sample}`;
 const slider=(path='L|456:192',spans=1,length=300,sound=0,extra='')=>`256,192,1000,2,${sound},${path},${spans},${length}${extra}`;
 add('circle',circle());
 add('sample-whitespace', circle(1000,256,192,53,2,'2: 3: 4: 50:'));
 add('path-whitespace', slider('L| 456: 192 ',2,300));
 add('node-whitespace', slider('L|456:192',3,300,14,',2| 4|8|0,1: 2|2: 3|3: 1|0:0,2: 3:ignored:ignored'));
 add('many-node-samples', slider('L|456:192',9000,1,0,','+Array(9001).fill('2').join('|')+','+Array(9001).fill('2:3').join('|')));
 result.push({id:'shared-map-data',text:'osu file format v14\n[General]\nAudioFilename: music\\track.mp3\nAudioLeadIn: 120\nPreviewTime: 300\nSampleSet: Soft\nSampleVolume: 45\nCountdown: 2\nCountdownOffset: 3\nSamplesMatchPlaybackRate: 1\nLetterboxInBreaks: 1\nEpilepsyWarning: 1\nWidescreenStoryboard: 1\nSpecialStyle: 1\n[Events]\n2,10,20\nBreak,40,90\n[TimingPoints]\n100,500,3,2,4,60,1,8\n200,-50,4,3,5,70,0,1\n[HitObjects]\n256,192,1000,53,14,2:3:4:50:custom.wav\n256,192,3000,8,14,5000,2:3:4:50:'});
 add('samples',circle(1000,256,192,1,14,'2:3:4:50:')+'\n'+circle(2000,256,192,5,2,'0:0:0:0:custom.wav'));
 add('spinner',`256,192,1000,8,14,5000,2:3:4:50:`);
 add('spinner-file',`256,192,1000,8,0,1000,0:0:0:0:spin.wav`);
 for(const [id,path] of Object.entries({linear:'L|456:192',bezier:'B|300:30|456:192',catmull:'C|300:30|456:192|500:100',perfect:'P|356:92|456:192',collinear:'P|356:192|456:192',invalid_arc:'P|356:92',mixed:'B|300:30|356:192|L|456:192|500:100',duplicate:'B|300:30|300:30|456:192',repeated:'B|300:30|300:30|300:30|456:192',zero:'L|256:192',spline:'B2|300:30|456:192|500:100'})){
  for(const version of [5,7,14,128]) add(`${id}-v${version}`,slider(path,3,300),{version});
 }
 for(const length of [0,1,40,500,100001,131072])add(`length-${length}`,slider('L|456:192',2,length));
 for(const spans of [1,2,4,8])add(`repeat-${spans}`,slider('B|300:30|456:192',spans,400));
 add('node-samples',slider('L|456:192',3,300,14,',2|4|8|0,1:2|2:3|3:1|0:0,2:3:5:30:ignored.wav'));
 add('zero-node-samples',slider('L|256:192',3,300,14,',2|4|8|0,1:2|2:3|3:1|0:0,2:3:5:30:ignored.wav'));
 add('sample-boundary',slider('L|456:192',2,280),{timing:'0,500,4,1,2,70,1,0\n1005,-100,4,2,3,80,0,0\n1006,-100,4,3,4,90,0,0\n2005,-100,4,1,5,60,0,0'});
 for(const beatLength of ['NaN','-25','-300','-0.01'])for(const version of [7,14])add(`timing-${beatLength}-${version}`,slider(),{version,timing:`0,500,4,1,2,70,1,0\n1000,${beatLength},4,2,3,90,0,0`});
 for(const version of [5,6,14]){
  add(`stack-circles-${version}`,[circle(),circle(1100),circle(1200),circle(1300,256,192,5),circle(1400)].join('\n'),{version});
  add(`stack-slider-end-${version}`,[slider('L|456:192',1,200),circle(1800,456),circle(1900,456),circle(2000,456)].join('\n'),{version});
  add(`stack-reverse-${version}`,[slider('L|456:192',2,200),circle(2500),circle(2600),'256,192,2650,8,0,2800,0:0:0:0:',circle(2900)].join('\n'),{version});
  add(`equal-time-${version}`,[circle(),slider(),circle(),circle(1000,256,192,37)].join('\n'),{version});
 }
 for(const cs of [0,3.7,10]) add(`difficulty-${cs}`,slider(),{cs,ar:cs,od:cs});
 const manifest=JSON.parse(readFileSync(resolve(root,'reference/source-manifest.json')));
 for(const source of manifest.files.filter(source=>source.path.endsWith('.osu'))){
  result.push({id:'upstream-'+source.path.split('/').at(-1).replace('.osu',''),text:readFileSync(resolve(root,'reference',source.local),'utf8'),source});
 }
 const sharedData=result.find(fixture=>fixture.id==='shared-map-data').text;
 const nodeObjects=result.find(fixture=>fixture.id==='node-samples').text.split('[HitObjects]\n')[1];
 // Distinct [Metadata] values so the ABI-level check verifies every kind-54
 // string span against the reference trace.
 const metadataSection='[Metadata]\nTitle: ABI Record Fields\nArtist: Test Artist\nCreator: Test Creator\nVersion: Field Coverage\n';
 result.push({id:'abi-record-fields',text:sharedData.replace('osu file format v14\n','osu file format v14\n'+metadataSection)+'\n'+nodeObjects});
 return result;
}
