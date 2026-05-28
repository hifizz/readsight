import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './style.css';

const colorSchemeQuery = matchMedia('(prefers-color-scheme: dark)');
const applyColorScheme = (dark: boolean) => {
  document.documentElement.classList.toggle('dark', dark);
};
applyColorScheme(colorSchemeQuery.matches);
colorSchemeQuery.addEventListener('change', (e) => applyColorScheme(e.matches));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
