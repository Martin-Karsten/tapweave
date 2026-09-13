import { createMemo, createSignal, untrack } from 'solid-js';
import { createStore } from 'solid-js/store';
import { Generic_Select, type Song_Entry } from './generic_select.js';

const [hit_count, set_hit_count] = createSignal(0);
const doubled = createMemo(() => hit_count() * 2);

const [song_state, set_song_state] = createStore({ entries: [] as Song_Entry[], filter: '' });

export const increment = (step: number) => set_hit_count((current) => current + step);

export const apply_filter = (filter: string) => {
  set_song_state('filter', filter);
  set_song_state(
    'entries',
    untrack(() => song_state.entries).filter((entry) => entry.title.includes(filter)),
  );
};

export const derived_bindings = {
  doubled,
  filtered_count: () => song_state.entries.length,
  select_component: Generic_Select,
};

export const exercise_memo_typing = (): number => {
  const memo_chain = createMemo(() => `${doubled()} entries`);
  return memo_chain().length;
};
