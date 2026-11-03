import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/ui/App';
import './style.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');
const siteClient = location.protocol === 'chrome-extension:'
  ? (await import('../../src/platform/novelai/chrome')).createChromeSiteClient()
  : undefined;
createRoot(root).render(
  <React.StrictMode>
    <App siteClient={siteClient} />
  </React.StrictMode>,
);
