// PAiA popup — paired with the local API server on 127.0.0.1:<port>.
// Reads stored {endpoint, apiKey} from chrome.storage.local, sends the
// user's prompt to /v1/chat, and renders the streamed reply inline.

const statusEl   = document.getElementById('status');
const promptEl   = document.getElementById('prompt');
const sendBtn    = document.getElementById('send');
const responseEl = document.getElementById('response');
const unconf     = document.getElementById('unconfigured');
const composer   = document.getElementById('composer');
const optionsBtn = document.getElementById('open-options');

let cfg = null;
let threadId = null;

// Tell the background worker the popup is open so it can clear the badge.
chrome.runtime.sendMessage({ kind: 'popup-opened' }).catch(() => { /* ignore */ });

async function loadConfig() {
  const stored = await chrome.storage.local.get(['endpoint', 'apiKey', 'threadId']);
  if (!stored.endpoint || !stored.apiKey) return null;
  return {
    endpoint: stored.endpoint,
    apiKey: stored.apiKey,
    threadId: stored.threadId || null,
  };
}

async function pingServer(c) {
  try {
    const res = await fetch(`${c.endpoint}/v1/info`, {
      headers: { Authorization: `Bearer ${c.apiKey}` },
    });
    if (res.status === 200) return { ok: true, version: (await res.json()).version };
    if (res.status === 401) return { ok: false, reason: 'Bad API key' };
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: 'PAiA not reachable — start the app and turn on Settings → API server' };
  }
}

async function ensureThread(c) {
  if (c.threadId) return c.threadId;
  const res = await fetch(`${c.endpoint}/v1/threads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: `Browser ext · ${new Date().toLocaleDateString()}` }),
  });
  if (!res.ok) throw new Error(`Create thread failed: HTTP ${res.status}`);
  const data = await res.json();
  await chrome.storage.local.set({ threadId: data.id });
  c.threadId = data.id;
  return data.id;
}

async function send() {
  const text = promptEl.value.trim();
  if (!text || !cfg) return;
  sendBtn.disabled = true;
  responseEl.classList.remove('hidden');
  responseEl.textContent = '';
  try {
    const tid = await ensureThread(cfg);
    const res = await fetch(`${cfg.endpoint}/v1/chat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadId: tid, text }),
    });
    if (!res.ok || !res.body) {
      responseEl.textContent = `Error: HTTP ${res.status}`;
      return;
    }
    // Parse SSE stream.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of event.split('\n')) {
          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const parsed = JSON.parse(payload);
              if (parsed.token) {
                responseEl.textContent += parsed.token;
                responseEl.scrollTop = responseEl.scrollHeight;
              } else if (parsed.error) {
                responseEl.textContent += `\n[error] ${parsed.error}`;
              }
            } catch {
              responseEl.textContent += payload;
            }
          }
        }
      }
    }
  } catch (err) {
    responseEl.textContent = `Error: ${err.message ?? String(err)}`;
  } finally {
    sendBtn.disabled = false;
    promptEl.value = '';
  }
}

async function main() {
  cfg = await loadConfig();
  if (!cfg) {
    unconf.classList.remove('hidden');
    statusEl.textContent = 'unpaired';
    statusEl.classList.add('bad');
    return;
  }
  composer.classList.remove('hidden');

  const ping = await pingServer(cfg);
  if (ping.ok) {
    statusEl.textContent = `paired · v${ping.version}`;
    statusEl.classList.add('ok');
    sendBtn.disabled = false;
  } else {
    statusEl.textContent = ping.reason;
    statusEl.classList.add('bad');
  }

  // Prefill from context-menu invocation.
  const session = await chrome.storage.session.get('paiaPrefill');
  if (session.paiaPrefill) {
    promptEl.value = session.paiaPrefill;
    await chrome.storage.session.remove('paiaPrefill');
  }
  promptEl.focus();
}

sendBtn.addEventListener('click', () => void send());
promptEl.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    void send();
  }
});
optionsBtn?.addEventListener('click', () => chrome.runtime.openOptionsPage());

void main();
