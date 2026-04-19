// Typed accessor for the preload-exposed window.paia. Importing this
// instead of touching window.paia directly gives us autocomplete + a
// single place to mock during tests.

import type { PaiaApi } from '../../preload/preload';

declare global {
  interface Window {
    paia: PaiaApi;
  }
}

export const api: PaiaApi = window.paia;
