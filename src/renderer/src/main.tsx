import React from 'react';
import ReactDOM from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { App } from './App';

async function start() {
  if (import.meta.env.MODE === 'android') {
    const { installAndroidRuntime } = await import('./android-runtime');
    installAndroidRuntime();
  }
  const resize = () => document.documentElement.style.setProperty('--app-height', `${window.visualViewport?.height ?? window.innerHeight}px`);
  resize();
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('resize', resize);
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
}
void start();
