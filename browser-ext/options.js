const epEl = document.getElementById('endpoint');
const akEl = document.getElementById('apiKey');
const saveBtn = document.getElementById('save');
const clearBtn = document.getElementById('clear');
const statusEl = document.getElementById('status');

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = ok ? 'ok' : 'bad';
}

async function load() {
  const stored = await chrome.storage.local.get(['endpoint', 'apiKey']);
  if (stored.endpoint) epEl.value = stored.endpoint;
  if (stored.apiKey)   akEl.value = stored.apiKey;
}

async function save() {
  const endpoint = epEl.value.trim().replace(/\/$/, '');
  const apiKey   = akEl.value.trim();
  if (!endpoint || !apiKey) {
    setStatus('Both fields are required.', false);
    return;
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(endpoint)) {
    setStatus('Endpoint must be 127.0.0.1 or localhost (with optional port).', false);
    return;
  }
  setStatus('Testing…', true);
  try {
    const res = await fetch(`${endpoint}/v1/info`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (res.status === 401) {
      setStatus('Authentication failed — check the API key.', false);
      return;
    }
    if (!res.ok) {
      setStatus(`HTTP ${res.status} — endpoint reachable but PAiA returned an error.`, false);
      return;
    }
    const info = await res.json();
    await chrome.storage.local.set({ endpoint, apiKey });
    setStatus(`Paired with PAiA v${info.version || '?'}.`, true);
  } catch (err) {
    setStatus(`Cannot reach PAiA: ${err.message ?? String(err)}. Is the app running?`, false);
  }
}

async function clearAll() {
  await chrome.storage.local.remove(['endpoint', 'apiKey', 'threadId']);
  epEl.value = '';
  akEl.value = '';
  setStatus('Cleared.', true);
}

saveBtn.addEventListener('click', () => void save());
clearBtn.addEventListener('click', () => void clearAll());
void load();
