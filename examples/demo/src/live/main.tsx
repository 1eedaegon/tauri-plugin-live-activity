// The live-editing page's entry, which Vite serves (vite.config.ts); the demo's own page is build.ts's. A load ends
// what an earlier load left running before the card starts (live-page.ts says why).
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { endLayout, listLayout } from 'tauri-plugin-live-activity';
import { endLeftovers, errorText } from '../live-page.ts';
import { LiveCard } from './LiveCard.tsx';

const root = document.getElementById('root');
if (root) {
  const leftovers = await endLeftovers({ listLayout, endLayout }).then(() => undefined, errorText);
  createRoot(root).render(
    <StrictMode>
      <LiveCard leftovers={leftovers} />
    </StrictMode>,
  );
}
