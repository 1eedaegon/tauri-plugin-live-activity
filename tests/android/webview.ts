// Drives only the local, debug-enabled Tauri demo through its UI action handlers.
// First forward the demo's webview_devtools_remote_<pid> socket to localhost:9222.
import { list, member, record, text } from '../support.ts';

const actions: Readonly<Record<string, string>> = {
  inspect: `JSON.stringify({message: document.querySelector('#message').textContent, permissions: document.querySelector('#permissions').textContent, records: document.querySelector('#records').textContent, report: document.querySelector('#self-test-report').textContent, reportPath: document.querySelector('#report-path').textContent})`,
  start: `document.querySelector('#start').click(); 'start clicked'`,
  permission: `document.querySelector('#permission').click(); 'permission clicked'`,
  selftest: `document.querySelector('#run-self-test').click(); 'self-test clicked'`,
  refresh: `document.querySelector('#refresh').click(); 'refresh clicked'`,
  strictfallback: `(async()=>JSON.stringify(await window.__TAURI_INTERNALS__.invoke('plugin:live-activity|start', {input: {activityKey:'strict-fallback-check',schemaVersion:1,template:'progress',fallback:'none',snapshot:{revision:0,title:'Strict fallback test',status:'Checking support',progress:0.5}}}).then(record=>({record})).catch(error=>({error}))))()`,
  end: `document.querySelector('#end').click(); 'end clicked'`,
  snack: `document.querySelector('#mode-snack').click(); document.querySelector('#start').click(); 'Mochi snack started'`,
  nap: `document.querySelector('#mode-nap').click(); document.querySelector('#start').click(); 'Mochi nap started'`,
  advance: `document.querySelector('#update').click(); 'Mochi activity updated'`,
};
const expression = actions[process.argv[2] ?? 'inspect'];
if (expression === undefined) throw new Error('Unknown demo UI action');
const targets = list(await (await fetch('http://127.0.0.1:9222/json')).json(), "the WebView's targets").map(item => record(item, 'a target of the WebView'));
const target = targets.find(item => item.type === 'page' && URL.canParse(text(item.url)) && new URL(text(item.url)).origin === 'http://tauri.localhost');
if (!target) throw new Error('The local Tauri demo WebView was not found');
const socket = new WebSocket(text(target.webSocketDebuggerUrl, "the address of the WebView's socket"));
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const response = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Demo UI evaluation timed out')), 10000);
  socket.addEventListener('message', (event: MessageEvent<string>) => {
    const data: unknown = JSON.parse(event.data);
    if (member(data, 'id') === 1) { clearTimeout(timeout); resolve(data); }
  });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
socket.close();
// A reply has an error or a result: one with neither is no reply of the debugger, and reading it fails.
if (member(response, 'error') || record(member(response, 'result'), "the debugger's result").exceptionDetails) throw new Error('Demo UI evaluation failed');
console.log(record(member(response, 'result', 'result'), 'what the evaluation gave').value);
