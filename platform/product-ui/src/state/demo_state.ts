import { createSignal } from 'solid-js';
import { player_session } from './session_state';

export type Demo_Request_State = 'idle' | 'loading' | 'failed';

const DEMO_ARCHIVE_URL = '/demo/tapweave-demo.osz';
const DEMO_ARCHIVE_FILENAME = 'tapweave-demo.osz';

const [demo_request, set_demo_request] = createSignal<Demo_Request_State>('idle');
const [demo_error, set_demo_error] = createSignal<string | null>(null);

export const demo_request_state = (): Demo_Request_State => demo_request();

export const demo_error_message = (): string | null => demo_error();

// Fetch the same-origin demo archive and load it through the transactional
// selection pipeline, exactly like a user import. A failed fetch never
// reaches load_files, so the valid selection survives; the retry re-fetches
// with cache: 'reload' so a stale cached response cannot shadow the archive.
// After a successful load the user presses Play explicitly, keeping the
// audio-start gesture in user hands.
export const request_demo = async (): Promise<void> => {
  if (demo_request() === 'loading') return;
  set_demo_request('loading');
  set_demo_error(null);
  try {
    const archive_response = await fetch(DEMO_ARCHIVE_URL, { cache: 'reload' });
    if (!archive_response.ok) {
      throw new Error(`Demo download failed (${archive_response.status}).`);
    }
    const archive_bytes = new Uint8Array(await archive_response.arrayBuffer());
    const archive_file = new File([archive_bytes], DEMO_ARCHIVE_FILENAME, { type: 'application/zip' });
    await player_session()?.add_files([archive_file]);
    set_demo_request('idle');
  } catch (error) {
    // Fetch rejections arrive as bare TypeErrors ("Failed to fetch"); the
    // product message names the action instead of the browser internals.
    const reason = error instanceof TypeError ? 'network' : String(error instanceof Error ? error.message : error);
    set_demo_error(`Demo download failed (${reason}).`);
    set_demo_request('failed');
  }
};
