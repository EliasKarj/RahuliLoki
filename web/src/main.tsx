import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { bridge } from './lib/desktop.ts';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

/**
 * Which shell this page is in, on the root element, before anything renders.
 *
 * The desktop window draws its own title bar, so the page has to leave room for it and give it
 * somewhere to be dragged by. That is layout, not behaviour, and CSS is where it belongs — but
 * CSS cannot ask whether the preload bridge exists. One attribute here answers it for the whole
 * stylesheet, and a browser tab, which has a title bar of its own, never sees the rule.
 */
if (bridge() !== null) document.documentElement.dataset.shell = 'desktop';

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
