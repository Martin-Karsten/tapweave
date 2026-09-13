import { createSignal, type Component } from 'solid-js';

interface Hmr_Counter_Props {
  step: number;
}

export const Hmr_Counter: Component<Hmr_Counter_Props> = (props) => {
  const [count, set_count] = createSignal(0);
  return (
    <div data-hmr-counter="alive">
      <p data-hmr-label="gate-counter">Solid counter (a2 gate)</p>
      <button type="button" onClick={() => set_count(count() + props.step)}>
        count is {count()}
      </button>
    </div>
  );
};
