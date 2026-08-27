import bs58 from "bs58";

export interface InjectedSolana {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: { toBase58?: () => string; toString: () => string };
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString: () => string } }>;
  disconnect?: () => Promise<void>;
  signMessage: (msg: Uint8Array, enc?: string) => Promise<{ signature: Uint8Array } | Uint8Array>;
}

function asProvider(v: unknown): InjectedSolana | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Partial<InjectedSolana>;
  if (typeof p.connect !== "function" || typeof p.signMessage !== "function") return null;
  return p as InjectedSolana;
}

export function getInjectedWallet(): InjectedSolana | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { solana?: unknown; solflare?: unknown; phantom?: { solana?: unknown } };
  return (
    asProvider(w.solana) ||
    asProvider(w.solflare) ||
    asProvider(w.phantom?.solana)
  );
}

export function pubkeyOf(provider: InjectedSolana): string {
  const k = provider.publicKey;
  if (!k) return "";
  return typeof k.toBase58 === "function" ? k.toBase58() : k.toString();
}

export async function signOperatorMessage(provider: InjectedSolana, message: string): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  const raw = await provider.signMessage(bytes, "utf8");
  const sig = raw && typeof raw === "object" && "signature" in raw ? raw.signature : (raw as Uint8Array);
  return bs58.encode(sig);
}
