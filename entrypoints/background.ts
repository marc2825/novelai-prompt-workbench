import { browser } from 'wxt/browser';

// Minimal MV3 service worker with a single job: make the toolbar button open the
// side panel (instead of a popup that closes as soon as the NovelAI page is clicked).
// It needs no permission beyond `sidePanel`, keeps no state, sends no messages,
// reads no tabs and makes no network requests. The panel works without it.
export default defineBackground(() => {
  const openPanelOnClick = () => { void browser.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true })?.catch(() => undefined); };
  browser.runtime.onInstalled.addListener(openPanelOnClick);
  browser.runtime.onStartup.addListener(openPanelOnClick);
  openPanelOnClick();
});
