import { useEffect, useRef, useState } from 'react';
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
  // Character prompt boxes and a synthetic generation status element (data-state / data-job-id).
  const [characters, setCharacters] = useState([1, 2].map(index => ({ positive: `site ${tabId} character ${index}`, negative: '' })));
  const [job, setJob] = useState<{ state: string; id: string }>({ state: 'idle', id: '' });
  const [hold, setHold] = useState(false);
  const [failNext, setFailNext] = useState(false);
  const [hideStatus, setHideStatus] = useState(false);
  const [statusKey, setStatusKey] = useState(0);
  const settle = useRef<(() => void) | null>(null);
  useEffect(() => { if (!hold && settle.current) { const finish = settle.current; settle.current = null; finish(); } }, [hold]);
  const generate = () => {
    const next = generated + 1;
    setGenerated(next);
    const id = `job-${tabId}-${next}`;
    const outcome = failNext ? 'failed' : 'succeeded';
    setJob({ state: 'generating', id });
    settle.current = () => setTimeout(() => setJob({ state: outcome, id }), 150);
    if (!hold) { const finish = settle.current; settle.current = null; finish(); }
  };
  const setCharacter = (index: number, key: 'positive' | 'negative', value: string) => { if (!reject) setCharacters(current => current.map((item, position) => position === index ? { ...item, [key]: value } : item)); };
  return <section className="panel stack" aria-label={`Mock site ${tabId}`}>
    <h2>React controlled mock {tabId}</h2>
    {!missing && <>
      <label>Mock Positive {tabId}<textarea key={replacement} data-workbench-fixture={`${tabId}-positive`} value={positive} disabled={disabled} onChange={event => { if (!reject) setPositive(event.target.value); }} /></label>
      <label>Mock Negative {tabId}<textarea data-workbench-fixture={`${tabId}-negative`} value={negative} onChange={event => { if (!reject) setNegative(event.target.value); }} /></label>
    </>}
    {!missing && characters.map((item, index) => <div className="columns" key={index}>
      <label>Mock Character {index + 1} Positive {tabId}<textarea data-workbench-fixture={`${tabId}-character-${index + 1}-positive`} value={item.positive} onChange={event => setCharacter(index, 'positive', event.target.value)} /></label>
      <label>Mock Character {index + 1} Negative {tabId}<textarea data-workbench-fixture={`${tabId}-character-${index + 1}-negative`} value={item.negative} onChange={event => setCharacter(index, 'negative', event.target.value)} /></label>
    </div>)}
    <output data-workbench-fixture={`${tabId}-model`} aria-label={`Mock model ${tabId}`}>NAI Diffusion V4.5 Full</output>
    {!hideStatus && <output key={statusKey} data-workbench-fixture={`${tabId}-generation`} data-state={job.state} data-job-id={job.id} aria-label={`Generation status ${tabId}`}>{job.state} {job.id}</output>}
    <div className="actions"><button onClick={() => setCharacters(current => [...current, { positive: `site ${tabId} character ${current.length + 1}`, negative: '' }])}>Add character {tabId}</button><button onClick={() => setCharacters(current => current.slice(0, -1))}>Remove character {tabId}</button>
      <label className="inline"><input type="checkbox" checked={hold} onChange={event => setHold(event.target.checked)} />Hold generation {tabId}</label><label className="inline"><input type="checkbox" checked={failNext} onChange={event => setFailNext(event.target.checked)} />Fail generations {tabId}</label>
      <label className="inline"><input type="checkbox" checked={hideStatus} onChange={event => setHideStatus(event.target.checked)} />Hide generation status {tabId}</label><button onClick={() => setStatusKey(statusKey + 1)}>Re-render status {tabId}</button></div>
    {duplicate && <textarea aria-label={`Duplicate ${tabId}`} data-workbench-fixture={`${tabId}-positive`} defaultValue="untouched duplicate" />}
    <output aria-label={`React state Positive ${tabId}`}>{positive}</output><output aria-label={`React state Negative ${tabId}`}>{negative}</output>
    <div className="actions"><label className="inline"><input type="checkbox" checked={reject} onChange={event => setReject(event.target.checked)} />Reject writes {tabId}</label><label className="inline"><input type="checkbox" checked={missing} onChange={event => setMissing(event.target.checked)} />Missing fields {tabId}</label><label className="inline"><input type="checkbox" checked={duplicate} onChange={event => setDuplicate(event.target.checked)} />Duplicate fields {tabId}</label><label className="inline"><input type="checkbox" checked={disabled} onChange={event => setDisabled(event.target.checked)} />Disabled field {tabId}</label></div>
    <div className="actions"><button onClick={() => setRender(render + 1)}>Force React render {tabId} ({render})</button><button onClick={() => setReplacement(replacement + 1)}>Replace field {tabId}</button><button onClick={() => { register(tabId); setReplacement(replacement + 1); }}>Reload document {tabId}</button><button onClick={() => { urls.set(tabId, 'https://novelai.net/stories'); }}>Navigate away {tabId}</button><button onClick={generate}>Generate {tabId} ({generated})</button></div>
  </section>;
}

for (const id of [101, 202] as const) register(id);
createRoot(document.getElementById('fixture-sites')!).render(<div className="stack" style={{ maxWidth: 760, margin: 'auto', padding: 16 }}><MockSite tabId={101} /><MockSite tabId={202} /></div>);
const client = new SiteClient({
  listTabIds: async () => [101, 202],
  async send(tabId, request) { const handler = handlers.get(tabId); if (!handler) throw new Error('No receiver'); return handler(request, sender); },
});
createRoot(document.getElementById('root')!).render(<App siteClient={client} />);
