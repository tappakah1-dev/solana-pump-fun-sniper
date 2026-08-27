import bs58 from "bs58";

export interface InjectedSolana {
  isPhantom?: boolean;
  isSolflare?: boolean;
  isMetaMask?: boolean;
  publicKey?: { toBase58?: () => string; toString: () => string };
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toString: () => string } } | undefined>;
  disconnect?: () => Promise<void>;
  signMessage: (msg: Uint8Array, enc?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
}

function asProvider(v: unknown): InjectedSolana | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<InjectedSolana>;
  if (typeof p.connect !== "function" || typeof p.signMessage !== "function") return null;
  return p as InjectedSolana;
}

function sameProvider(a: InjectedSolana, b: InjectedSolana): boolean {
  return a === b;
}

/**
 * Prefer Phantom/Solflare's own injectors. Generic `window.solana` is often
 * MetaMask's Solana (coin type 501) and throws "Unable to find any account for 501".
 */
export function listInjectedWallets(): InjectedSolana[] {
  if (typeof window === "undefined") return [];
  const w = window as unknown as {
    solana?: unknown;
    solflare?: unknown;
    phantom?: { solana?: unknown };
    backpack?: { solana?: unknown };
  };
  const out: InjectedSolana[] = [];
  const add = (raw: unknown) => {
    const p = asProvider(raw);
    if (!p) return;
    if (p.isMetaMask && !p.isPhantom && !p.isSolflare) return;
    if (out.some((x) => sameProvider(x, p))) return;
    out.push(p);
  };
  add(w.phantom?.solana);
  add(w.solflare);
  add(w.backpack?.solana);
  const generic = asProvider(w.solana);
  if (generic && (generic.isPhantom || generic.isSolflare) && !generic.isMetaMask) {
    add(generic);
  }
  return out;
}

export function getInjectedWallet(): InjectedSolana | null {
  return listInjectedWallets()[0] ?? null;
}

export function pubkeyOf(provider: InjectedSolana): string {
  const k = provider.publicKey;
  if (!k) return "";
  return typeof k.toBase58 === "function" ? k.toBase58() : k.toString();
}

export async function connectInjected(provider: InjectedSolana): Promise<string> {
  const resp = await provider.connect({ onlyIfTrusted: false });
  const fromResp = resp?.publicKey ? String(resp.publicKey.toString()) : "";
  return fromResp || pubkeyOf(provider);
}

export function explainWalletError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? "wallet_connect_failed");
  if (/501/.test(msg) || /unable to find any account/i.test(msg)) {
    return "No Solana account in that wallet (501 = Solana). Open Phantom, switch network to Solana — not Ethereum. If MetaMask is installed, disable it on this tab or use Solflare.";
  }
  if (/rejected|denied|cancel/i.test(msg)) return "Wallet popup was rejected.";
  if (/not found|no provider|is not defined/i.test(msg)) {
    return "No Solana wallet found. Install Phantom or Solflare and unlock it.";
  }
  return msg.slice(0, 180);
}

export async function signOperatorMessage(provider: InjectedSolana, message: string): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  const raw = await provider.signMessage(bytes, "utf8");
  const sig = raw && typeof raw === "object" && "signature" in raw ? raw.signature : (raw as Uint8Array);
  return bs58.encode(sig);
}
