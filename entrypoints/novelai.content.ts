import { browser } from 'wxt/browser';
import { createSiteHandler } from '../src/platform/novelai/handler';
import { LiveReadOnlyAdapter } from '../src/platform/novelai/live';
import { PROTOCOL } from '../src/platform/novelai/protocol';

export default defineContentScript({
  matches: ['https://novelai.net/image', 'https://novelai.net/image?*', 'https://novelai.net/image/*'],
  world: 'ISOLATED',
  main() {
    const handler = createSiteHandler(new LiveReadOnlyAdapter(document), {
      extensionId: browser.runtime.id, panelUrl: browser.runtime.getURL('/sidepanel.html'),
      documentId: crypto.randomUUID(), isTopFrame: window === window.top,
      url: () => location.href, title: () => document.title, now: Date.now, ticket: () => crypto.randomUUID(),
      schedule: (callback, ms) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); },
    });
    browser.runtime.onMessage.addListener((request: unknown, sender, sendResponse) => {
      if (!request || typeof request !== 'object' || !('protocol' in request) || request.protocol !== PROTOCOL) return false;
      void handler(request, sender).then(sendResponse);
      return true;
    });
  },
});
