// Drives only the local, debug-enabled Tauri demo through its visible controls.
// First forward the demo's webview_devtools_remote_<pid> socket to localhost:9222.
const actions = {
  inspect: `JSON.stringify({message: document.querySelector('#message').textContent, permissions: document.querySelector('#permissions').textContent, records: document.querySelector('#records').textContent, report: document.querySelector('#self-test-report').textContent, reportPath: document.querySelector('#report-path').textContent})`,
  start: `document.querySelector('#start').click(); 'start clicked'`,
  permission: `document.querySelector('#permission').click(); 'permission clicked'`,
  selftest: `document.querySelector('#run-self-test').click(); 'self-test clicked'`,
  refresh: `document.querySelector('#refresh').click(); 'refresh clicked'`,
  strictfallback: `(async()=>JSON.stringify(await window.__TAURI_INTERNALS__.invoke('plugin:live-activity|start', {input: {activityKey:'strict-fallback-check',schemaVersion:1,template:'progress',fallback:'none',snapshot:{revision:0,title:'Strict fallback test',status:'Checking support',progress:0.5}}}).then(record=>({record})).catch(error=>({error}))))()`,
  download: `document.querySelector('#title').value='Downloading files'; document.querySelector('#status').value='65 of 100 files'; document.querySelector('#progress').value='0.65'; document.querySelector('#template').value='progress'; document.querySelector('#start').click(); 'download started through demo UI'`,
  end: `document.querySelector('#end').click(); 'end clicked'`,
  snack: `document.querySelector('#mode-snack').click(); document.querySelector('#start').click(); 'Mochi snack started'`,
  nap: `document.querySelector('#mode-nap').click(); document.querySelector('#start').click(); 'Mochi nap started'`,
  advance: `document.querySelector('#update').click(); 'Mochi activity updated'`,
};
const expression = actions[process.argv[2] ?? 'inspect'];
if (expression === undefined) throw new Error('Unknown demo UI action');
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const target = targets.find(item => item.type === 'page' && item.url.startsWith('http://tauri.localhost'));
if (!target) throw new Error('The local Tauri demo WebView was not found');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const response = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Demo UI evaluation timed out')), 10000);
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    if (data.id === 1) { clearTimeout(timeout); resolve(data); }
  });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
socket.close();
if (response.error || response.result.exceptionDetails) throw new Error('Demo UI evaluation failed');
console.log(response.result.result.value);
