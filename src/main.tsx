import { render } from 'preact';
import { App } from './app';
import { initTheme } from './lib/themes';
import './styles.css';

initTheme();

render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).catch((e) => console.warn('SW registration failed', e));
  });
}
