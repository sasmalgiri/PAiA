# Third-party notices

PAiA includes the following open-source software components. Each is
governed by its own license, included below or referenced from its
project page. We are grateful to the maintainers of these projects.

## Runtime dependencies

| Package | License | Purpose |
|---|---|---|
| [electron](https://github.com/electron/electron) | MIT | Desktop runtime |
| [react](https://github.com/facebook/react) | MIT | UI library |
| [react-dom](https://github.com/facebook/react) | MIT | UI library |
| [sql.js](https://github.com/sql-js/sql.js) | MIT | SQLite via WebAssembly |
| [@huggingface/transformers](https://github.com/huggingface/transformers.js) | Apache-2.0 | Whisper STT |
| [tesseract.js](https://github.com/naptha/tesseract.js) | Apache-2.0 | OCR |
| [marked](https://github.com/markedjs/marked) | MIT | Markdown parsing |
| [marked-highlight](https://github.com/markedjs/marked-highlight) | MIT | Markdown code highlight integration |
| [highlight.js](https://github.com/highlightjs/highlight.js) | BSD-3-Clause | Syntax highlighting |
| [pdfjs-dist](https://github.com/mozilla/pdf.js) | Apache-2.0 | PDF text extraction |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | MCP client |
| [electron-log](https://github.com/megahertz/electron-log) | MIT | Logging |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT | Auto-update |
| [@sentry/electron](https://github.com/getsentry/sentry-electron) | MIT | Crash reporting |

## Build dependencies

| Package | License | Purpose |
|---|---|---|
| [esbuild](https://github.com/evanw/esbuild) | MIT | Renderer bundler |
| [electron-builder](https://github.com/electron-userland/electron-builder) | MIT | Installer packaging |
| [typescript](https://github.com/microsoft/TypeScript) | Apache-2.0 | Type checking |
| [vitest](https://github.com/vitest-dev/vitest) | MIT | Unit tests |
| [sharp](https://github.com/lovell/sharp) | Apache-2.0 | Icon rasterization |
| [png2icons](https://github.com/idesis-gmbh/png2icons) | MIT | ICO/ICNS generation |

## External services and models

PAiA does not bundle these but may download them on user request:

| Component | License / terms | When |
|---|---|---|
| [Ollama](https://ollama.com) | MIT | User installs separately |
| [Whisper models from Hugging Face](https://huggingface.co/Xenova) | MIT (model weights) | First use of Whisper STT |
| [Tesseract language data](https://github.com/tesseract-ocr/tessdata) | Apache-2.0 | First use of OCR |
| [Piper TTS](https://github.com/rhasspy/piper) | MIT | First use of Piper TTS engine |
| [Piper voice models](https://huggingface.co/rhasspy/piper-voices) | Various open licenses | First use of each voice |

## Optional integrations

The following are NOT bundled but can be installed by users:

| Component | License | Notes |
|---|---|---|
| [Picovoice Porcupine](https://picovoice.ai) | Commercial (free for personal use) | Wake word detection — requires user-supplied access key |

## Full license texts

The full text of each license is available in `node_modules/<package>/LICENSE`
in the unpacked installer, or on the GitHub page of each project.

If you believe a license is missing or incorrectly attributed,
please email hello@paia.app and we will correct it.
