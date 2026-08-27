export interface AllowEntry {
  original: string;
  key: string;
  label?: string;
}

export function parseAddressFile(text: string): AllowEntry[] {
  const out: AllowEntry[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let original = trimmed;
    let label: string | undefined;
    const hash = trimmed.indexOf("#");
    if (hash > 0) {
      original = trimmed.slice(0, hash).trim();
      label = trimmed.slice(hash + 1).trim() || undefined;
    }
    const parts = original.split(/\s+/);
    const addr = parts[0] ?? "";
    if (parts.length > 1 && !label) label = parts.slice(1).join(" ");
    if (!addr) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ original: addr, key, label });
  }
  return out;
}

export class AllowList {
  entries: AllowEntry[] = [];

  constructor(text = "") {
    this.reload(text);
  }

  reload(text: string) {
    this.entries = parseAddressFile(text);
  }

  has(addr: string | undefined | null): boolean {
    if (!addr) return false;
    const key = addr.toLowerCase();
    return this.entries.some((e) => e.key === key);
  }

  get(addr: string): AllowEntry | undefined {
    const key = addr.toLowerCase();
    return this.entries.find((e) => e.key === key);
  }
}

export const EMPTY_ALLOW_TXT = `# Trusted DEV wallets — one Solana address per line.
# Optional label after a space or #.
`;

export const DEFAULT_ALLOW_TXT = `# Allow-list — one Solana address per line.
# This list IS the research. No LLM scoring. No meme-quality filter.
# Case-insensitive compare; original spelling is stored.

BizCreator1111111111111111111111111111111   # Biz-style launches
AlphaDev111111111111111111111111111111111   # second desk wallet
FlopCreator11111111111111111111111111111    # non-runner sims
RugCreator111111111111111111111111111111    # shakeout-death sims
DumpCreator11111111111111111111111111111    # second-dump sims
FadeCreator11111111111111111111111111111    # 20-50k death-zone sims
`;

export const DEFAULT_SMART_TXT = `# Optional labeled trader wallets.
# Used only as an exit HINT after we are in a position — never as an entry reason.

SmartSniper11111111111111111111111111111  # desk note: size-in / size-out
`;
