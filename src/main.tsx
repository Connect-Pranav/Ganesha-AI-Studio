import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StudioProvider } from './services/StudioContext';
import './styles.css';
import './shadcn.css';
import { startAutoUpdate } from './services/autoUpdate';
import { startPremiumFx } from './services/premiumFx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StudioProvider>
      <App />
    </StudioProvider>
  </StrictMode>,
);

// Installable app (PWA): register the service worker on the deployed site only.
if ('serviceWorker' in navigator && window.location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service worker not registered:', e));
  });
}

startAutoUpdate();
startPremiumFx();
