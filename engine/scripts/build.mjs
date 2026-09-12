import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, compile, verifyCompiler } from './toolchain.mjs';
verifyCompiler();
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
compile(['build','prepared_native','-o:speed','-out:artifacts/prepared-native']);
compile(['build', 'native', '-o:speed', '-out:artifacts/decode-native']);
compile(['build', 'wasm', '-target:js_wasm32', '-o:speed', '-out:artifacts/decode.wasm', '-extra-linker-flags:--export-memory --max-memory=268435456']);

// Link the C consumer into an Odin executable so the pinned runtime receives
// its normal startup. This also avoids the pinned compiler's Darwin shared
// library -init quoting defect without changing or bypassing the compiler.
execFileSync(process.env.CC || 'cc',['-std=c11','-Dmain=abi_c_probe','-c',resolve(root,'tests/abi.c'),'-o',resolve(root,'artifacts/abi-c-probe.o')],{stdio:'inherit'});
compile(['build','abi_native','-o:speed','-out:artifacts/abi-native']);

compile(['build', 'browser_wasm', '-target:js_wasm32', '-o:speed', '-out:artifacts/tapweave.wasm', '-extra-linker-flags:--export-memory --max-memory=268435456']);
