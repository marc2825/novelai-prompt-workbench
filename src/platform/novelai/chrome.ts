import { browser } from 'wxt/browser';
import { SiteClient } from './client';

export function createChromeSiteClient(): SiteClient {
  return new SiteClient({
    // Tab IDs require no tabs/host permission. Static content scripts answer only
    // on the declared NovelAI image paths; no arbitrary tab URL/title is read.
    async listTabIds() { return (await browser.tabs.query({ currentWindow: true })).flatMap(tab => typeof tab.id === 'number' ? [tab.id] : []); },
    send(tabId, request) { return browser.tabs.sendMessage(tabId, request, { frameId: 0 }); },
  });
}
