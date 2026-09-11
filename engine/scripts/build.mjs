import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, compile, verifyCompiler } from './toolchain.mjs';
verifyCompiler();
mkdirSync(resolve(root, 'artifacts'), { recursive: true });
compile(['build', 'native', '-o:speed', '-out:artifacts/decode-native']);
compile(['build', 'wasm', '-target:js_wasm32', '-o:speed', '-out:artifacts/decode.wasm', '-extra-linker-flags:--export-memory --max-memory=268435456']);
