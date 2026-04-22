// Helpers for grouping qualified model ids (`provider:model`) by provider
// in the `<select>` UI, and classifying whether a given id routes through
// a cloud provider.
//
// Keeping these pure + tiny so both the top-bar picker (Panel.tsx) and
// the default-model picker (Settings → Models) share the same behaviour.

import type { ProviderId } from '../../shared/types';

export interface PickerModel {
  /** Qualified id used in Settings.model — `openai:gpt-4o` or bare `llama3.2`. */
  id: string;
  /** What we render in the option row (no provider suffix — the optgroup carries that). */
  label: string;
}

interface ProviderGroupMeta {
  id: ProviderId;
  label: string;
  cloud: boolean;
}

const GROUPS: Record<ProviderId, ProviderGroupMeta> = {
  ollama:               { id: 'ollama',              label: 'Ollama (local)',        cloud: false },
  openai:               { id: 'openai',              label: 'OpenAI ☁',              cloud: true  },
  anthropic:            { id: 'anthropic',           label: 'Anthropic (Claude) ☁',  cloud: true  },
  'openai-compatible':  { id: 'openai-compatible',   label: 'OpenAI-compatible ☁',   cloud: true  },
};

const KNOWN_PROVIDERS: ProviderId[] = ['ollama', 'openai', 'anthropic', 'openai-compatible'];

/** Same parse rule as main/providers.ts parseQualified — bare ids default to ollama. */
export function parseQualified(qualified: string): { providerId: ProviderId; model: string } {
  for (const p of KNOWN_PROVIDERS) {
    const prefix = `${p}:`;
    if (qualified.startsWith(prefix)) return { providerId: p, model: qualified.slice(prefix.length) };
  }
  return { providerId: 'ollama', model: qualified };
}

export function isCloudModel(qualifiedId: string): boolean {
  return GROUPS[parseQualified(qualifiedId).providerId].cloud;
}

export function providerMeta(id: string): ProviderGroupMeta {
  return GROUPS[parseQualified(id).providerId];
}

export interface ModelGroup {
  providerId: ProviderId;
  label: string;
  cloud: boolean;
  models: PickerModel[];
}

/**
 * Group a flat list of qualified models into <optgroup>-friendly buckets.
 * Preserves the order models were encountered within each group. Local
 * (Ollama) is always first, cloud providers follow alphabetically.
 */
export function groupModels(list: { id: string; label?: string }[]): ModelGroup[] {
  const buckets = new Map<ProviderId, ModelGroup>();

  for (const entry of list) {
    const { providerId, model } = parseQualified(entry.id);
    const meta = GROUPS[providerId];
    const bucket = buckets.get(providerId) ?? {
      providerId,
      label: meta.label,
      cloud: meta.cloud,
      models: [],
    };
    // Avoid duplicates: some flows add bare ollama names alongside qualified ones.
    if (!bucket.models.some((m) => m.id === entry.id)) {
      bucket.models.push({ id: entry.id, label: entry.label ?? model });
    }
    buckets.set(providerId, bucket);
  }

  const ordered: ModelGroup[] = [];
  if (buckets.has('ollama')) ordered.push(buckets.get('ollama')!);
  const cloud = [...buckets.values()].filter((g) => g.cloud);
  cloud.sort((a, b) => a.label.localeCompare(b.label));
  ordered.push(...cloud);
  return ordered;
}
