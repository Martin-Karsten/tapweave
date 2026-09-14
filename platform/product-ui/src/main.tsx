import { render } from 'solid-js/web';
import { App } from './app';
import './style.css';

const root_element = document.getElementById('root');
if (root_element === null) {
  throw new Error('shell root element missing');
}

render(() => <App />, root_element);
