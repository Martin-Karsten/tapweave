import { For, Show, type JSX } from 'solid-js';
import { Generic_Select, type Song_Entry } from '../a1/generic_select.js';

// Deliberate diagnostics: items require { id: number }; these entries have none.
const misaligned_entries = [{ identifier: 1 }, { identifier: 2 }];

export function Expected_Props_Error(): { node: JSX.Element } {
  return {
    node: <Generic_Select items={misaligned_entries} label="misaligned" on_select={(entry) => entry.identifier} />,
  };
}

export function Expected_Control_Flow_Error(songs: Song_Entry[]) {
  // Deliberate diagnostics: `each` requires an array; number is not assignable.
  return <Show when={songs.length > 0}>{() => <For each={songs.length}>{() => 'x'}</For>}</Show>;
}
