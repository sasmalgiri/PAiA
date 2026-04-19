// Loopback OAuth 2.0 helper.
//
// All connectors share this flow:
//   1. Start a short-lived HTTP server on 127.0.0.1:<random-port>.
//   2. Open the provider's authorize URL in the user's default browser,
//      passing redirect_uri=http://127.0.0.1:<port>/callback.
//   3. When the provider redirects back, exchange the code for tokens.
//   4. Shut the server down.
//
// We use PKCE where the provider supports it (Google, GitHub, Slack all
// support S256). Tokens land in sqlite via db.saveConnectorToken — the
// caller decides the key (connector id).

import * as http from 'http';
import * as crypto from 'crypto';
import { shell } from 'electron';
import { logger } from '../logger';

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra query params to tack onto the authorize URL. */
  extraAuthorizeParams?: Record<string, string>;
  /** Where to send the completed token exchange as form data vs JSON. */
  tokenFormat?: 'form' | 'json';
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scopes: string[];
  expiresAt?: number;
  raw: Record<string, unknown>;
}

const CALLBACK_PATH = '/paia/callback';

export async function runOAuthFlow(cfg: OAuthProviderConfig): Promise<TokenResponse> {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  const { port, codePromise, stop } = await startCallbackServer(state);

  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const authUrl = new URL(cfg.authorizeUrl);
  authUrl.searchParams.set('client_id', cfg.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', cfg.scopes.join(' '));
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  for (const [k, v] of Object.entries(cfg.extraAuthorizeParams ?? {})) {
    authUrl.searchParams.set(k, v);
  }

  logger.info('oauth: opening browser for', cfg.authorizeUrl);
  await shell.openExternal(authUrl.toString());

  let code: string;
  try {
    code = await codePromise;
  } finally {
    stop();
  }

  return exchangeCode(cfg, code, redirectUri, verifier);
}

async function exchangeCode(
  cfg: OAuthProviderConfig,
  code: string,
  redirectUri: string,
  verifier: string,
): Promise<TokenResponse> {
  const body: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: cfg.clientId,
    code_verifier: verifier,
  };
  if (cfg.clientSecret) body.client_secret = cfg.clientSecret;

  const format = cfg.tokenFormat ?? 'form';
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': format === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
      Accept: 'application/json',
    },
    body: format === 'form'
      ? new URLSearchParams(body).toString()
      : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token exchange failed: HTTP ${res.status} ${text}`);
  }
  const parsed = (await res.json()) as Record<string, unknown>;
  return parseTokenResponse(parsed, cfg.scopes);
}

export async function refresh(
  cfg: OAuthProviderConfig,
  refreshToken: string,
): Promise<TokenResponse> {
  const body: Record<string, string> = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: cfg.clientId,
  };
  if (cfg.clientSecret) body.client_secret = cfg.clientSecret;

  const format = cfg.tokenFormat ?? 'form';
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': format === 'form' ? 'application/x-www-form-urlencoded' : 'application/json',
      Accept: 'application/json',
    },
    body: format === 'form'
      ? new URLSearchParams(body).toString()
      : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token refresh failed: HTTP ${res.status} ${text}`);
  }
  const parsed = (await res.json()) as Record<string, unknown>;
  return parseTokenResponse(parsed, cfg.scopes);
}

function parseTokenResponse(body: Record<string, unknown>, requestedScopes: string[]): TokenResponse {
  const access = body.access_token;
  if (typeof access !== 'string') throw new Error('Token response missing access_token');
  const tokenType = typeof body.token_type === 'string' ? body.token_type : 'Bearer';
  const refresh = typeof body.refresh_token === 'string' ? body.refresh_token : undefined;
  const scopeStr = typeof body.scope === 'string' ? body.scope : '';
  const scopes = scopeStr ? scopeStr.split(/\s+/).filter(Boolean) : requestedScopes;
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : undefined;
  const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;
  return {
    accessToken: access,
    refreshToken: refresh,
    tokenType,
    scopes,
    expiresAt,
    raw: body,
  };
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface ServerHandles {
  port: number;
  codePromise: Promise<string>;
  stop: () => void;
}

function startCallbackServer(expectedState: string): Promise<ServerHandles> {
  return new Promise<ServerHandles>((resolve, reject) => {
    let resolveCode: (code: string) => void;
    let rejectCode: (err: Error) => void;
    const codePromise = new Promise<string>((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const url = new URL(req.url, `http://127.0.0.1`);
      if (url.pathname !== CALLBACK_PATH) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const err = url.searchParams.get('error');
      if (err) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain');
        res.end(`OAuth error: ${err}. You can close this tab.`);
        rejectCode(new Error(err));
        return;
      }
      const state = url.searchParams.get('state');
      if (state !== expectedState) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain');
        res.end('State mismatch. You can close this tab.');
        rejectCode(new Error('state mismatch'));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Missing code.');
        rejectCode(new Error('missing code'));
        return;
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html');
      res.end(`
        <!doctype html><html><body style="font: 14px system-ui; padding: 40px;">
          <h1>All set.</h1>
          <p>You can close this tab and return to PAiA.</p>
        </body></html>
      `);
      resolveCode(code);
    });

    server.on('error', reject);

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr !== 'object') {
        reject(new Error('Could not bind OAuth callback server'));
        return;
      }
      const port = addr.port;
      resolve({
        port,
        codePromise,
        stop: () => server.close(),
      });
    });

    // 5-minute global timeout so a forgotten tab doesn't hang the app.
    const timer = setTimeout(() => {
      server.close();
      rejectCode(new Error('OAuth flow timed out after 5 minutes'));
    }, 5 * 60 * 1000);
    codePromise.finally(() => clearTimeout(timer));
  });
}
