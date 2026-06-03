// Hardware probe — runs once per session at boot, cached to disk.
//
// What we capture:
//   - RAM total + free (os.totalmem / os.freemem)
//   - CPU model + thread count
//   - GPU name + VRAM (best-effort, platform-specific, short timeout)
//   - Computed tier — drives the Model Store's recommended-for-you list
//
// We never block on the GPU probe. If it hangs or errors we just mark
// gpu: null and pick the tier from RAM alone. Apple Silicon reports
// vendor='apple' with no separate VRAM (unified memory) — the picker
// reads totalRamGb in that case.

import { app } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exec } from 'child_process';
import { logger } from './logger';
import type { GpuInfo, GpuVendor, HardwareInfo, HardwareTier, ModelRecommendation } from '../shared/types';

export type { GpuInfo, GpuVendor, HardwareInfo, HardwareTier, ModelRecommendation };

const CACHE_VERSION = 1;
let cache: { version: number; info: HardwareInfo } | null = null;
// Coalesce concurrent probe() calls onto a single in-flight Promise so
// the GPU detection doesn't run twice when (e.g.) Settings + Onboarding
// both probe at boot.
let probing: Promise<HardwareInfo> | null = null;

function cachePath(): string {
  return path.join(app.getPath('userData'), 'hardware.json');
}

function loadCache(): HardwareInfo | null {
  if (cache && cache.version === CACHE_VERSION) return cache.info;
  try {
    const raw = fs.readFileSync(cachePath(), 'utf-8');
    const parsed = JSON.parse(raw) as { version: number; info: HardwareInfo };
    if (parsed.version === CACHE_VERSION && parsed.info) {
      cache = parsed;
      return parsed.info;
    }
  } catch {
    /* no cache yet */
  }
  return null;
}

function saveCache(info: HardwareInfo): void {
  cache = { version: CACHE_VERSION, info };
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    fs.writeFileSync(cachePath(), JSON.stringify(cache, null, 2));
  } catch (err) {
    logger.warn('hardware: cache write failed', err);
  }
}

function execWithTimeout(cmd: string, timeoutMs = 4000): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = exec(cmd, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      if (err) return reject(err);
      resolve(stdout);
    });
    // exec's `timeout` option fires SIGTERM; on Windows we also need a
    // manual kill in case the child is wedged in a UAC prompt. Cleared
    // on completion so the timer doesn't hold a reference to the dead
    // child.
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, timeoutMs + 500);
  });
}

function classifyVendor(name: string): GpuVendor {
  const n = name.toLowerCase();
  if (n.includes('nvidia') || n.includes('rtx') || n.includes('gtx') || n.includes('geforce') || n.includes('quadro') || n.includes('tesla')) return 'nvidia';
  if (n.includes('radeon') || n.includes('amd') || n.includes('rx ')) return 'amd';
  if (n.includes('apple') || n.includes('m1') || n.includes('m2') || n.includes('m3') || n.includes('m4')) return 'apple';
  if (n.includes('intel') || n.includes('iris') || n.includes('hd graphics') || n.includes('uhd')) return 'intel';
  return 'unknown';
}

async function probeGpuWindows(): Promise<GpuInfo | null> {
  // PowerShell Get-CimInstance returns AdapterRAM in bytes. Bytes maxes
  // at 4 GB for 32-bit fields — for cards with >4 GB we fall back to
  // nvidia-smi if it's available. Otherwise we report the field value.
  try {
    const out = await execWithTimeout(
      'powershell.exe -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress"',
      6000,
    );
    const parsed = JSON.parse(out.trim()) as { Name?: string; AdapterRAM?: number };
    if (!parsed || !parsed.Name) return null;
    const name = parsed.Name;
    let vramGb: number | undefined = parsed.AdapterRAM ? Math.round(parsed.AdapterRAM / (1024 ** 3)) : undefined;
    // For NVIDIA, prefer nvidia-smi (handles >4 GB cards correctly).
    const vendor = classifyVendor(name);
    if (vendor === 'nvidia') {
      try {
        const smi = await execWithTimeout('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', 3000);
        const mib = parseInt(smi.trim().split('\n')[0], 10);
        if (!isNaN(mib) && mib > 0) vramGb = Math.round(mib / 1024);
      } catch {
        /* fall back to AdapterRAM field above */
      }
    }
    return { name, vramGb, vendor };
  } catch (err) {
    logger.warn('hardware: Windows GPU probe failed', err);
    return null;
  }
}

async function probeGpuMacOS(): Promise<GpuInfo | null> {
  // On Apple Silicon there's no separate VRAM — unified memory. We just
  // record the chip name and let the tier picker read totalRamGb.
  try {
    const out = await execWithTimeout('system_profiler SPDisplaysDataType -json', 6000);
    const data = JSON.parse(out) as { SPDisplaysDataType?: Array<{ sppci_model?: string; spdisplays_vram?: string; spdisplays_vendor?: string }> };
    const items = data.SPDisplaysDataType ?? [];
    if (items.length === 0) return null;
    const first = items[0];
    const name = first.sppci_model ?? 'Unknown GPU';
    const vendor = classifyVendor(name);
    // spdisplays_vram looks like "16384 MB" on discrete; absent on Apple
    // Silicon's integrated GPU.
    let vramGb: number | undefined;
    const vramStr = first.spdisplays_vram;
    if (vramStr) {
      const m = vramStr.match(/(\d+)\s*MB/i);
      if (m) vramGb = Math.round(parseInt(m[1], 10) / 1024);
      else {
        const g = vramStr.match(/(\d+)\s*GB/i);
        if (g) vramGb = parseInt(g[1], 10);
      }
    }
    return { name, vramGb, vendor };
  } catch (err) {
    logger.warn('hardware: macOS GPU probe failed', err);
    return null;
  }
}

async function probeGpuLinux(): Promise<GpuInfo | null> {
  // Prefer nvidia-smi when present (gives exact VRAM). Otherwise lspci
  // gives a name but no VRAM — still useful for tier classification.
  try {
    const smi = await execWithTimeout('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', 3000);
    const line = smi.trim().split('\n')[0];
    const [name, mibStr] = line.split(',').map((s) => s.trim());
    const mib = parseInt(mibStr, 10);
    return {
      name,
      vramGb: !isNaN(mib) ? Math.round(mib / 1024) : undefined,
      vendor: 'nvidia',
    };
  } catch {
    /* fall through to lspci */
  }
  try {
    const lspci = await execWithTimeout("lspci | grep -iE 'vga|3d|display' | head -1", 3000);
    const line = lspci.trim();
    if (!line) return null;
    // Line looks like "01:00.0 VGA compatible controller: NVIDIA Corporation Device …"
    const colonIdx = line.indexOf(':');
    const name = colonIdx > 0 ? line.slice(colonIdx + 1).trim().split(':').slice(1).join(':').trim() : line;
    return { name: name || line, vendor: classifyVendor(name || line) };
  } catch (err) {
    logger.warn('hardware: Linux GPU probe failed', err);
    return null;
  }
}

function pickTier(totalRamGb: number, gpu: GpuInfo | null): HardwareTier {
  // Tier breakpoints, intentionally honest:
  //   moe-class:  needs ≥48 GB RAM AND (16+ GB VRAM OR Apple Silicon ≥48 GB unified)
  //   strong:     ≥32 GB RAM AND (8+ GB VRAM OR Apple Silicon ≥32 GB unified)
  //   comfortable: ≥16 GB RAM, GPU optional
  //   lightweight: everything else
  const isApple = gpu?.vendor === 'apple';
  const vram = gpu?.vramGb ?? (isApple ? totalRamGb : 0);

  if (totalRamGb >= 48 && vram >= 16) return 'moe-class';
  if (totalRamGb >= 32 && vram >= 8) return 'strong';
  if (totalRamGb >= 16) return 'comfortable';
  return 'lightweight';
}

/**
 * Probes the machine and returns hardware info. The first call per
 * session does the real work; subsequent calls return the cache.
 * Pass force=true to invalidate the cache (e.g. after the user reports
 * RAM that doesn't match).
 */
export async function probe(force = false): Promise<HardwareInfo> {
  if (!force) {
    const cached = loadCache();
    if (cached) return cached;
    // A concurrent caller may already be probing; piggyback on it.
    if (probing) return probing;
  }

  probing = (async (): Promise<HardwareInfo> => {
    try {
      return await doProbe();
    } finally {
      probing = null;
    }
  })();
  return probing;
}

async function doProbe(): Promise<HardwareInfo> {
  const platform = process.platform;
  const arch = process.arch;
  const cpus = os.cpus();
  const cpuModel = cpus[0]?.model ?? 'Unknown CPU';
  const cpuThreads = cpus.length;
  const totalRamGb = Math.round(os.totalmem() / (1024 ** 3));
  const availableRamGb = Math.round(os.freemem() / (1024 ** 3));

  let gpu: GpuInfo | null = null;
  try {
    if (platform === 'win32') gpu = await probeGpuWindows();
    else if (platform === 'darwin') gpu = await probeGpuMacOS();
    else if (platform === 'linux') gpu = await probeGpuLinux();
  } catch (err) {
    logger.warn('hardware: GPU probe threw', err);
    gpu = null;
  }

  const tier = pickTier(totalRamGb, gpu);
  const info: HardwareInfo = {
    platform,
    arch,
    cpuModel,
    cpuThreads,
    totalRamGb,
    availableRamGb,
    gpu,
    tier,
    detectedAt: Date.now(),
  };
  saveCache(info);
  logger.info(`hardware: detected tier=${tier} ram=${totalRamGb}GB cpu=${cpuThreads}t gpu=${gpu?.name ?? 'none'}${gpu?.vramGb ? ` (${gpu.vramGb}GB)` : ''}`);
  return info;
}

// Recommended models per tier. Names match Ollama's registry exactly so
// the picker can hand them straight to `ollama pull`.
const RECS: Record<HardwareTier, ModelRecommendation[]> = {
  lightweight: [
    { ollamaName: 'llama3.2:3b', displayName: 'Llama 3.2 3B', paramsB: 3, contextK: 128, approxSizeGb: 2.0, bestFor: ['general chat', 'quick replies'], warnLargeDownload: false },
    { ollamaName: 'qwen2.5:3b',   displayName: 'Qwen 2.5 3B',  paramsB: 3, contextK: 128, approxSizeGb: 2.0, bestFor: ['multilingual', 'coding basics'], warnLargeDownload: false },
    { ollamaName: 'phi3.5:3.8b',  displayName: 'Phi 3.5 3.8B', paramsB: 3.8, contextK: 128, approxSizeGb: 2.2, bestFor: ['reasoning under tight RAM'], warnLargeDownload: false },
  ],
  comfortable: [
    { ollamaName: 'qwen2.5:14b',     displayName: 'Qwen 2.5 14B',     paramsB: 14, contextK: 128, approxSizeGb: 9.0, bestFor: ['professional answers', 'coding', 'best balance'], warnLargeDownload: false },
    { ollamaName: 'llama3.1:8b',     displayName: 'Llama 3.1 8B',     paramsB: 8,  contextK: 128, approxSizeGb: 4.7, bestFor: ['general purpose', 'tool use'], warnLargeDownload: false },
    { ollamaName: 'deepseek-coder-v2:16b', displayName: 'DeepSeek Coder v2 16B', paramsB: 16, contextK: 128, approxSizeGb: 8.9, bestFor: ['coding heavy'], warnLargeDownload: false },
    { ollamaName: 'gemma2:9b',       displayName: 'Gemma 2 9B',       paramsB: 9,  contextK: 8,   approxSizeGb: 5.4, bestFor: ['writing', 'low VRAM'], warnLargeDownload: false },
  ],
  strong: [
    { ollamaName: 'qwen2.5:32b',     displayName: 'Qwen 2.5 32B',     paramsB: 32, contextK: 128, approxSizeGb: 19,  bestFor: ['near-frontier reasoning', 'professional work'], warnLargeDownload: true },
    { ollamaName: 'llama3.3:70b',    displayName: 'Llama 3.3 70B (Q4)', paramsB: 70, contextK: 128, approxSizeGb: 42, bestFor: ['highest local quality'], warnLargeDownload: true },
    { ollamaName: 'qwen2.5-coder:32b', displayName: 'Qwen 2.5 Coder 32B', paramsB: 32, contextK: 128, approxSizeGb: 19, bestFor: ['serious coding'], warnLargeDownload: true },
  ],
  'moe-class': [
    { ollamaName: 'mixtral:8x7b',    displayName: 'Mixtral 8x7B',     paramsB: 47, contextK: 32,  approxSizeGb: 26, bestFor: ['speed/quality tradeoff via MoE'], warnLargeDownload: true },
    { ollamaName: 'mixtral:8x22b',   displayName: 'Mixtral 8x22B',    paramsB: 141, contextK: 64, approxSizeGb: 80, bestFor: ['top-tier local quality'], warnLargeDownload: true },
    { ollamaName: 'deepseek-v3:671b-distill-qwen-32b', displayName: 'DeepSeek-V3 distill 32B', paramsB: 32, contextK: 128, approxSizeGb: 19, bestFor: ['reasoning over MoE distillation'], warnLargeDownload: true },
  ],
};

export function recommendationsFor(tier: HardwareTier): ModelRecommendation[] {
  return RECS[tier];
}

/**
 * Returns the recommended models for the user's current hardware tier,
 * with the first item flagged as the default for new installs.
 */
export async function defaultsForHardware(): Promise<{ tier: HardwareTier; recommendations: ModelRecommendation[] }> {
  const hw = await probe();
  return { tier: hw.tier, recommendations: RECS[hw.tier] };
}
