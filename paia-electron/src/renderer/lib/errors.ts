// Translate raw error strings from main-process pipelines into friendly,
// actionable messages the user can read without knowing what "ECONNREFUSED"
// means. Keep the table small; only add entries for errors that are
// actually reachable in normal use.

export interface FriendlyError {
  title: string;
  hint?: string;
}

export function friendlyError(raw: string | undefined | null): FriendlyError {
  const s = (raw ?? '').toString();
  const lower = s.toLowerCase();

  // Ollama not running
  if (lower.includes('econnrefused') && lower.includes('11434')) {
    return {
      title: 'Ollama isn\'t running',
      hint: 'Start Ollama (ollama serve) or install it from https://ollama.com. PAiA needs it for local models.',
    };
  }
  if (lower.includes('econnrefused')) {
    return {
      title: 'Couldn\'t connect',
      hint: 'The service at that address isn\'t reachable. Check it\'s running and the URL is correct.',
    };
  }

  // Network / timeouts
  if (lower.includes('timeout') || lower.includes('aborterror') || lower.includes('the operation was aborted')) {
    return {
      title: 'Request timed out',
      hint: 'The model or service took too long to respond. Try again, or switch to a faster model.',
    };
  }
  if (lower.includes('enotfound') || lower.includes('getaddrinfo')) {
    return {
      title: 'DNS lookup failed',
      hint: 'Check your internet connection, or verify the service URL is spelled correctly.',
    };
  }

  // Auth
  if (lower.includes('http 401') || lower.includes('status 401') || lower.includes('unauthorized')) {
    return {
      title: 'API key rejected',
      hint: 'The provider returned 401. Double-check the key in Settings → Models. Expired? Regenerate it.',
    };
  }
  if (lower.includes('http 403') || lower.includes('forbidden')) {
    return {
      title: 'Access denied',
      hint: 'The provider returned 403 — the key is valid but lacks permission for this model/endpoint.',
    };
  }
  if (lower.includes('http 429') || lower.includes('rate limit')) {
    return {
      title: 'Rate limited',
      hint: 'The provider is throttling you. Wait a minute or switch to a local model.',
    };
  }
  if (/http 5\d\d/.test(lower)) {
    return {
      title: 'Provider is having problems',
      hint: 'The provider returned a 5xx error. Usually temporary — retry in a moment.',
    };
  }

  // PAiA's own guardrails
  if (lower.includes('cloud provider') && lower.includes('disabled')) {
    return {
      title: 'Cloud models are off',
      hint: 'Enable "Allow cloud models" in Settings → General to use this provider.',
    };
  }
  if (lower.includes('classroom policy')) {
    return {
      title: 'Blocked by classroom policy',
      hint: 'The teacher has restricted cloud providers in this session.',
    };
  }
  if (lower.includes('requires paia pro')) {
    return {
      title: 'Pro feature',
      hint: 'This feature is gated behind a license. Start a trial or activate a license in Settings → License.',
    };
  }
  if (lower.includes('ollama embeddings failed')) {
    return {
      title: 'Embedding model missing',
      hint: 'Run `ollama pull nomic-embed-text` (or your configured embedding model) so PAiA can search documents.',
    };
  }

  // Fallback — return the raw string but marked as unknown.
  return { title: s || 'Something went wrong' };
}
