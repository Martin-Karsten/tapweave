import { fireEvent, render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { Hmr_Counter } from '../src/components/hmr_counter';

describe('Hmr_Counter (a3 gate)', () => {
  it('mounts and renders the initial count', () => {
    const { getByRole } = render(() => <Hmr_Counter step={1} />);
    expect(getByRole('button').textContent).toBe('count is 0');
  });

  it('increments through props-defined step on click', async () => {
    const { getByRole } = render(() => <Hmr_Counter step={2} />);
    const button = getByRole('button');
    fireEvent.click(button);
    await Promise.resolve();
    expect(button.textContent).toBe('count is 2');
    fireEvent.click(button);
    await Promise.resolve();
    expect(button.textContent).toBe('count is 4');
  });

  it('reflects the label attribute used by the HMR probe', () => {
    const { getByText } = render(() => <Hmr_Counter step={1} />);
    expect(getByText('Solid counter (a2 gate)').getAttribute('data-hmr-label')).toBe('gate-counter');
  });
});
