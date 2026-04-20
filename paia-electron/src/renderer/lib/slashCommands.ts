// Slash command registry. Triggered when the input starts with `/`.
//
// Each command takes the user's raw input (everything after the command
// name) and returns either a rewritten prompt (which is then sent as a
// normal message) or null to signal an action that the UI handled itself.

import type { SlashCommand } from '../../shared/types';

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'summarize',
    description: 'Summarize the given text in 3–5 bullet points.',
    rewrite: (input) => `Summarize the following in 3–5 concise bullet points:\n\n${input}`,
  },
  {
    name: 'translate',
    description: 'Translate text. Use: /translate <target> | <text>',
    rewrite: (input) => {
      const [target, ...rest] = input.split('|');
      const text = rest.join('|').trim();
      if (!target || !text) return `Translate to English:\n\n${input}`;
      return `Translate the following text to ${target.trim()}. Output only the translation:\n\n${text}`;
    },
  },
  {
    name: 'explain',
    description: 'Explain like I\'m smart but unfamiliar with the topic.',
    rewrite: (input) =>
      `Explain the following clearly to someone smart but unfamiliar with the topic. Use analogies where helpful:\n\n${input}`,
  },
  {
    name: 'fix',
    description: 'Fix grammar and spelling without changing meaning.',
    rewrite: (input) =>
      `Fix the spelling and grammar of the following text. Preserve the original meaning and tone. Output only the corrected text:\n\n${input}`,
  },
  {
    name: 'shorten',
    description: 'Make the text shorter without losing meaning.',
    rewrite: (input) => `Rewrite the following to be shorter while preserving meaning:\n\n${input}`,
  },
  {
    name: 'expand',
    description: 'Expand the text with more detail and structure.',
    rewrite: (input) => `Expand the following with more detail, examples, and structure:\n\n${input}`,
  },
  {
    name: 'code',
    description: 'Generate code from a natural-language description.',
    rewrite: (input) =>
      `Write code for the following request. Use Markdown code fences with the correct language tag. Brief explanation after the code only if needed:\n\n${input}`,
  },
  {
    name: 'tone',
    description: 'Rewrite in a different tone. Use: /tone <tone> | <text>',
    rewrite: (input) => {
      const [tone, ...rest] = input.split('|');
      const text = rest.join('|').trim();
      if (!tone || !text) return `Rewrite the following in a more polished tone:\n\n${input}`;
      return `Rewrite the following text in a ${tone.trim()} tone. Output only the rewritten text:\n\n${text}`;
    },
  },
  // ── meta commands (handled by the UI, not the LLM) ─────────────
  {
    name: 'clear',
    description: 'Clear the current conversation.',
    rewrite: () => null,
  },
  {
    name: 'new',
    description: 'Start a new conversation.',
    rewrite: () => null,
  },
  {
    name: 'screen',
    description: 'Capture the screen and OCR it.',
    rewrite: () => null,
  },
  {
    name: 'region',
    description: 'Drag a box to capture and OCR a screen region.',
    rewrite: () => null,
  },
  {
    name: 'search',
    description: 'Search the web (privacy-redacted) and ask about the results.',
    rewrite: () => null,
  },
  {
    name: 'image',
    description: 'Paste an image from your clipboard and ask about it.',
    rewrite: () => null,
  },
  // ── agentic commands (handled by the UI, not the LLM) ───────────
  {
    name: 'agent',
    description: 'Start an autonomous agent run: /agent <goal>',
    rewrite: () => null,
  },
  {
    name: 'research',
    description: 'Run Deep Research on a question: /research <question>',
    rewrite: () => null,
  },
  {
    name: 'canvas',
    description: 'Open the Canvas (artifacts) side panel.',
    rewrite: () => null,
  },
  {
    name: 'remember',
    description: 'Save a durable memory: /remember <fact>',
    rewrite: () => null,
  },
  {
    name: 'recall',
    description: 'Search long-term memory: /recall <query>',
    rewrite: () => null,
  },

  // ── Expression-format scaffolds (discoverability for math/mermaid/chem) ──
  // These show the user *how* to prompt for a given format so they know
  // PAiA supports it. They rewrite into a primed instruction that keeps
  // the model inside the desired output channel.
  {
    name: 'math',
    description: 'Ask for an answer rendered with LaTeX math. /math <question>',
    rewrite: (input) =>
      `Answer using LaTeX math. Put inline formulas in $...$ and display equations in $$...$$. Show each derivation step on its own line.\n\nQuestion: ${input}`,
  },
  {
    name: 'mermaid',
    description: 'Ask for the answer as a Mermaid diagram. /mermaid <description>',
    rewrite: (input) =>
      `Respond with a single Mermaid diagram in a \`\`\`mermaid fenced block that addresses the request below. Add a one-paragraph caption after the block only if essential.\n\nRequest: ${input}`,
  },
  {
    name: 'chem',
    description: 'Draw a molecule from its SMILES / common name. /chem <name or SMILES>',
    rewrite: (input) =>
      `Draw the molecule described below. If a SMILES string is given, render it directly in a \`\`\`smiles fenced block. If a common name is given, give the SMILES, then render. Add a one-line note about key functional groups.\n\n${input}`,
  },
  {
    name: 'whiteboard',
    description: 'Open a new whiteboard artifact in the Canvas.',
    rewrite: () => null,
  },
  {
    name: 'persona',
    description: 'Open the persona picker (or switch: /persona <id>).',
    rewrite: () => null,
  },
  {
    name: 'learned',
    description: 'Show what PAiA has learned about you recently.',
    rewrite: () => null,
  },
  {
    name: 'export',
    description: 'Export the current conversation as Markdown.',
    rewrite: () => null,
  },
  {
    name: 'shortcuts',
    description: 'Show the keyboard-shortcut cheat sheet.',
    rewrite: () => null,
  },
];

export function findCommand(name: string): SlashCommand | null {
  return SLASH_COMMANDS.find((c) => c.name === name) ?? null;
}

/**
 * Splits a leading slash command off the input. Returns the command name
 * and the remainder, or null if the input isn't a slash command.
 */
export function parseSlashCommand(text: string): { command: string; rest: string } | null {
  if (!text.startsWith('/')) return null;
  const space = text.indexOf(' ');
  if (space < 0) return { command: text.slice(1), rest: '' };
  return {
    command: text.slice(1, space),
    rest: text.slice(space + 1),
  };
}
