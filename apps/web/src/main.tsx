import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initI18n, savedLocale } from './lib/i18n';
import './design/fonts.css';
import './design/tokens.css';
import './design/base.css';

// Boots in the last chosen locale (else the browser's) until a signed-in user's `locale`
// setting takes over (see AppShell). A locale other than English is fetched before first paint.
await initI18n(savedLocale());

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element.');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
