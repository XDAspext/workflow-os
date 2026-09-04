const WEAK_SECRETS = new Set([
  "",
  "change-me",
  "change-me-to-a-long-random-string",
  "dev-only-not-for-production",
  "secret",
  "password",
]);

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function databaseUrl(): string {
  return (
    envString("DATABASE_URL") ||
    envString("POSTGRES_URL") ||
    envString("POSTGRES_PRISMA_URL") ||
    "file:./data/workflow-os.db"
  );
}

export function isPostgresUrl(url = databaseUrl()): boolean {
  return /^(postgres|postgresql):\/\//i.test(url);
}

export function publicAppUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (isProduction()) {
    if (!raw) {
      throw new Error("APP_URL is required in production and must be the public https origin.");
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("APP_URL must be a valid absolute URL, for example https://flowforge.example.com");
    }
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      throw new Error("APP_URL must not be localhost in production. Use the public domain.");
    }
    return raw.replace(/\/$/, "");
  }
  return (raw || "http://localhost:3000").replace(/\/$/, "");
}

export function webhookUrl(token: string): string {
  return `${publicAppUrl()}/api/webhooks/${token}`;
}

export function seedOnBootEnabled(): boolean {
  if (isProduction()) return false;
  return process.env.SEED_ON_BOOT !== "false";
}

export function embeddedWorkerEnabled(): boolean {
  if (process.env.ENABLE_EMBEDDED_WORKER === "true") return true;
  if (process.env.DISABLE_EMBEDDED_WORKER === "true") return false;
  return !isProduction();
}

export function executeInlineOnEnqueue(): boolean {
  if (process.env.EXECUTE_INLINE === "true") return true;
  if (process.env.EXECUTE_INLINE === "false") return false;
  return !isProduction();
}

export function publicSignupEnabled(): boolean {
  if (process.env.ALLOW_SIGNUP === "true") return true;
  if (process.env.ALLOW_SIGNUP === "false") return false;
  return !isProduction();
}

const DEV_DEMO_EMAIL = "maya.chen@northstar.example";
const DEV_DEMO_PASSWORD = "workflow-os-demo";

export function getDemoEmail(): string | null {
  const fromEnv = process.env.DEMO_EMAIL?.trim().toLowerCase();
  if (fromEnv) return fromEnv;
  if (isProduction()) return null;
  return DEV_DEMO_EMAIL;
}

export function getDemoPassword(): string | null {
  const fromEnv = process.env.DEMO_PASSWORD;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (isProduction()) return null;
  return DEV_DEMO_PASSWORD;
}

export function requireDemoCredentials(): { email: string; password: string } {
  const email = process.env.DEMO_EMAIL?.trim().toLowerCase();
  const password = process.env.DEMO_PASSWORD;
  if (isProduction()) {
    if (!email || !password) {
      throw new Error("DEMO_EMAIL and DEMO_PASSWORD must be set to create the demo workspace.");
    }
    if (password.length < 10) {
      throw new Error("DEMO_PASSWORD must be at least 10 characters.");
    }
    return { email, password };
  }
  return {
    email: email || DEV_DEMO_EMAIL,
    password: password || DEV_DEMO_PASSWORD,
  };
}

export function databasePoolMax(): number {
  const n = Number(process.env.DATABASE_POOL_MAX ?? (isProduction() ? 8 : 4));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 32) : 8;
}

export function workerLockTimeoutMs(): number {
  const n = Number(process.env.WORKER_LOCK_MS ?? 5 * 60_000);
  return Number.isFinite(n) && n >= 10_000 ? n : 5 * 60_000;
}

export function workerConcurrency(): number {
  const n = Number(process.env.WORKER_CONCURRENCY ?? (isProduction() ? 4 : 2));
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 16) : 4;
}

export function workerSharedSecret(): string | null {
  return envString("WORKER_SECRET") || envString("CRON_SECRET") || null;
}

export function postgresSsl(url: string): boolean | { rejectUnauthorized: boolean } | undefined {
  if (process.env.DATABASE_SSL === "disable") return false;
  if (process.env.DATABASE_SSL === "require") {
    return { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" };
  }
  try {
    const parsed = new URL(url);
    const mode = parsed.searchParams.get("sslmode");
    if (mode === "disable") return false;
    if (mode === "no-verify") return { rejectUnauthorized: false };
    if (mode === "require") return { rejectUnauthorized: false };
    if (mode === "verify-full" || mode === "verify-ca") return { rejectUnauthorized: true };
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return false;
    return { rejectUnauthorized: false };
  } catch {
    return undefined;
  }
}

function isWeakSecret(value: string | undefined): boolean {
  if (!value) return true;
  if (WEAK_SECRETS.has(value)) return true;
  return value.length < 32;
}

export function authSecret(): string {
  const raw = process.env.AUTH_SECRET;
  if (isProduction() && isWeakSecret(raw)) {
    throw new Error(
      "AUTH_SECRET must be set to a strong random value in production (openssl rand -base64 48).",
    );
  }
  return raw || "dev-only-not-for-production";
}

export function encryptionKeyMaterial(): string {
  const raw = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (isProduction()) {
    if (!process.env.ENCRYPTION_KEY || isWeakSecret(process.env.ENCRYPTION_KEY)) {
      throw new Error(
        "ENCRYPTION_KEY must be set in production to 64 hex characters (openssl rand -hex 32).",
      );
    }
    return process.env.ENCRYPTION_KEY;
  }
  return raw || "dev-only-not-for-production";
}

export function blockchainEnabled(): boolean {
  return process.env.BLOCKCHAIN_ENABLED === "true";
}

export function blockchainMode(): "demo" | "mock" | "evm" {
  const raw = (process.env.BLOCKCHAIN_MODE ?? "demo").trim().toLowerCase();
  if (raw === "evm" || raw === "live" || raw === "real") return "evm";
  if (raw === "mock") return "mock";
  return "demo";
}

export function chainRpcUrl(): string | null {
  return process.env.CHAIN_RPC_URL?.trim() || null;
}

export function chainId(): string {
  return process.env.CHAIN_ID?.trim() || (blockchainMode() === "evm" ? "" : "demo");
}

export function chainContractAddress(): `0x${string}` | null {
  const raw = process.env.CHAIN_CONTRACT_ADDRESS?.trim();
  return raw && raw.startsWith("0x") ? (raw as `0x${string}`) : null;
}

export function chainPrivateKey(): `0x${string}` | null {
  const raw = process.env.CHAIN_PRIVATE_KEY?.trim();
  if (!raw) return null;
  const hex = raw.startsWith("0x") ? raw : `0x${raw}`;
  return hex as `0x${string}`;
}

export function chainExplorerUrl(): string | null {
  const raw = process.env.CHAIN_EXPLORER_URL?.trim();
  return raw ? raw.replace(/\/$/, "") : null;
}

export function verifyOnChainDefault(): boolean {
  return process.env.VERIFY_ON_CHAIN_DEFAULT === "true";
}

export function verifyTestRuns(): boolean {
  return process.env.VERIFY_TEST_RUNS === "true";
}

export function assertProductionConfig(): void {
  if (!isProduction()) return;
  authSecret();
  encryptionKeyMaterial();
  publicAppUrl();
  if (!isPostgresUrl()) {
    throw new Error("DATABASE_URL must be a PostgreSQL URL (postgres:// or postgresql://) in production.");
  }
  if (process.env.SEED_ON_BOOT === "true") {
    throw new Error("SEED_ON_BOOT must not be enabled in production. Run `npm run seed:demo` once instead.");
  }
  if (blockchainEnabled() && blockchainMode() === "evm") {
    if (!chainRpcUrl() || !chainId() || !chainContractAddress() || !chainPrivateKey()) {
      throw new Error(
        "Real EVM anchoring in production requires CHAIN_RPC_URL, CHAIN_ID, CHAIN_CONTRACT_ADDRESS, and CHAIN_PRIVATE_KEY.",
      );
    }
  }
}
