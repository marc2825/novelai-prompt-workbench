import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../src/ui/App';
import { TextareaAdapter } from '../../src/platform/novelai/dom';
import { SiteClient } from '../../src/platform/novelai/client';
import { createSiteHandler } from '../../src/platform/novelai/handler';
import { fixtureProfile } from '../../src/platform/novelai/testing';
import '../../entrypoints/sidepanel/style.css';

const sender = { id: 'fixture-extension', url: 'chrome-extension://fixture-extension/sidepanel.html' };
const handlers = new Map<number, ReturnType<typeof createSiteHandler>>();
const urls = new Map<number, string>();
function register(tabId: 101 | 202) {
  urls.set(tabId, `https://novelai.net/image#fixture-${tabId}`);
  handlers.set(tabId, createSiteHandler(new TextareaAdapter(document, fixtureProfile(tabId)), {
    extensionId: sender.id, panelUrl: sender.url, documentId: crypto.randomUUID(), isTopFrame: true,
    url: () => urls.get(tabId)!, title: () => `Controlled mock tab ${tabId}`, now: Date.now, ticket: () => crypto.randomUUID(),
  }));
}

function MockSite({ tabId }: { tabId: 101 | 202 }) {
  const [positive, setPositive] = useState(`site ${tabId} positive`);
  const [negative, setNegative] = useState(`site ${tabId} negative`);
  const [reject, setReject] = useState(false);
  const [missing, setMissing] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [replacement, setReplacement] = useState(0);
  const [render, setRender] = useState(0);
  const [generated, setGenerated] = useState(0);
  return <section className="panel stack" aria-label={`Mock site ${tabId}`}>
    <h2>React controlled mock {tabId}</h2>
    {!missing && <>
      <label>Mock Positive {tabId}<textarea key={replacement} data-workbench-fixture={`${tabId}-positive`} value={positive} disabled={disabled} onChange={event => { if (!reject) setPositive(event.target.value); }} /></label>
      <label>Mock Negative {tabId}<textarea data-workbench-fixture={`${tabId}-negative`} value={negative} onChange={event => { if (!reject) setNegative(event.target.value); }} /></label>
    </>}
    {duplicate && <textarea aria-label={`Duplicate ${tabId}`} data-workbench-fixture={`${tabId}-positive`} defaultValue="untouched duplicate" />}
    <output aria-label={`React state Positive ${tabId}`}>{positive}</output><output aria-label={`React state Negative ${tabId}`}>{negative}</output>
    <div className="actions"><label className="inline"><input type="checkbox" checked={reject} onChange={event => setReject(event.target.checked)} />Reject writes {tabId}</label><label className="inline"><input type="checkbox" checked={missing} onChange={event => setMissing(event.target.checked)} />Missing fields {tabId}</label><label className="inline"><input type="checkbox" checked={duplicate} onChange={event => setDuplicate(event.target.checked)} />Duplicate fields {tabId}</label><label className="inline"><input type="checkbox" checked={disabled} onChange={event => setDisabled(event.target.checked)} />Disabled field {tabId}</label></div>
    <div className="actions"><button onClick={() => setRender(render + 1)}>Force React render {tabId} ({render})</button><button onClick={() => setReplacement(replacement + 1)}>Replace field {tabId}</button><button onClick={() => { register(tabId); setReplacement(replacement + 1); }}>Reload document {tabId}</button><button onClick={() => { urls.set(tabId, 'https://novelai.net/stories'); }}>Navigate away {tabId}</button><button onClick={() => setGenerated(generated + 1)}>Generate {tabId} ({generated})</button></div>
  </section>;
}

for (const id of [101, 202] as const) register(id);
createRoot(document.getElementById('fixture-sites')!).render(<div className="stack" style={{ maxWidth: 760, margin: 'auto', padding: 16 }}><MockSite tabId={101} /><MockSite tabId={202} /></div>);
const client = new SiteClient({
  listTabIds: async () => [101, 202],
  async send(tabId, request) { const handler = handlers.get(tabId); if (!handler) throw new Error('No receiver'); return handler(request, sender); },
});
createRoot(document.getElementById('root')!).render(<App siteClient={client} />);
