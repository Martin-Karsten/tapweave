import { render } from 'solid-js/web';
import { Spike_App } from './app';

const root_element = document.getElementById('root');
if (root_element === null) {
  throw new Error('shell root element missing');
}

render(() => <Spike_App />, root_element);
