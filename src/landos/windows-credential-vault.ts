/**
 * Local, current-user credential vault for LandOS.
 *
 * The vault record stores only DPAPI ciphertext plus safe lifecycle metadata in
 * .runtime/landos (ignored by Git). Secrets travel to the PowerShell helper via
 * stdin, never command arguments, logs, Deal Cards, browser recipes, or SQLite.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { redactAccountSecrets, type CredentialVault } from './government-account-manager.js';

export type VaultSecretKind = 'password' | 'session_cookie' | 'token';

export interface VaultMetadata {
  credentialHandle: string;
  scope: string;
  username: string;
  emailReference: string | null;
  kind: VaultSecretKind;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

interface VaultRecord extends VaultMetadata { ciphertext: string; }
interface VaultFile { version: 1; records: VaultRecord[]; }

export interface DpapiBridge {
  available(): Promise<boolean>;
  protect(value: string): Promise<string>;
  unprotect(ciphertext: string): Promise<string>;
}

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.resolve(thisDir, '../../.runtime/landos/credential-vault.v1.json');
const DEFAULT_HELPER = path.resolve(thisDir, '../../scripts/landos-dpapi-vault.ps1');

function isoNow(): string { return new Date().toISOString(); }
function clean(value: string | null | undefined): string { return String(value ?? '').trim(); }
function safeScope(value: string): string {
  const cleaned = clean(value);
  if (!cleaned || /password|passcode|otp|token|cookie|secret|bearer/i.test(cleaned)) throw new Error('Vault scope must be a safe non-secret reference.');
  return cleaned.slice(0, 240);
}
function safeError(error: unknown): Error { return new Error(redactAccountSecrets((error as Error)?.message || String(error)) || 'Credential vault unavailable.'); }

/** Windows DPAPI bridge. The helper is deliberately narrow and gets the secret over stdin. */
export class PowerShellDpapiBridge implements DpapiBridge {
  constructor(private readonly helperPath = DEFAULT_HELPER) {}

  async available(): Promise<boolean> {
    return process.platform === 'win32' && fs.existsSync(this.helperPath);
  }

  protect(value: string): Promise<string> { return this.run('protect', value); }
  unprotect(ciphertext: string): Promise<string> { return this.run('unprotect', ciphertext); }

  private async run(mode: 'protect' | 'unprotect', value: string): Promise<string> {
    if (!(await this.available())) throw new Error('Windows DPAPI is unavailable for this LandOS user.');
    return await new Promise<string>((resolve, reject) => {
      const child = spawn('powershell.exe', [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.helperPath, mode,
      ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', (error) => reject(safeError(error)));
      child.on('close', (code) => {
        if (code !== 0) return reject(safeError(new Error(stderr || `DPAPI helper exited ${code}.`)));
        try {
          const parsed = JSON.parse(stdout) as { value?: string };
          if (!parsed.value || typeof parsed.value !== 'string') throw new Error('DPAPI helper returned no value.');
          resolve(mode === 'unprotect' ? Buffer.from(parsed.value, 'base64').toString('utf8') : parsed.value);
        } catch (error) { reject(safeError(error)); }
      });
      child.stdin.end(JSON.stringify({ value }));
    });
  }
}

export class WindowsCredentialVault implements CredentialVault {
  constructor(
    private readonly bridge: DpapiBridge = new PowerShellDpapiBridge(),
    private readonly vaultPath = DEFAULT_FILE,
    private readonly now: () => string = isoNow,
  ) {}

  async isAvailable(): Promise<boolean> {
    try { return await this.bridge.available(); } catch { return false; }
  }

  async store(input: { scope: string; username: string; password: string; emailReference?: string | null }): Promise<{ credentialHandle: string }> {
    return await this.put({ ...input, kind: 'password' });
  }

  async put(input: { scope: string; username?: string; password: string; emailReference?: string | null; kind?: VaultSecretKind }): Promise<{ credentialHandle: string }> {
    if (!(await this.isAvailable())) throw new Error('Credential vault unavailable: Windows DPAPI cannot protect this record.');
    const password = String(input.password ?? '');
    if (!password) throw new Error('Credential vault will not store an empty secret.');
    const now = this.now();
    const handle = `landos-vault:${crypto.randomUUID()}`;
    const record: VaultRecord = {
      credentialHandle: handle,
      scope: safeScope(input.scope),
      username: clean(input.username),
      emailReference: clean(input.emailReference) || null,
      kind: input.kind ?? 'password',
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      ciphertext: await this.bridge.protect(password),
    };
    const state = this.read();
    state.records.push(record);
    this.write(state);
    return { credentialHandle: handle };
  }

  async retrieve(handle: string): Promise<{ value: string; metadata: VaultMetadata }> {
    const record = this.require(handle);
    if (!(await this.isAvailable())) throw new Error('Credential vault unavailable: DPAPI decryption is unavailable.');
    try {
      const value = await this.bridge.unprotect(record.ciphertext);
      const state = this.read();
      const current = state.records.find((entry) => entry.credentialHandle === handle)!;
      current.lastUsedAt = this.now();
      this.write(state);
      return { value, metadata: metadata(current) };
    } catch (error) { throw safeError(error); }
  }

  async rotate(input: { credentialHandle: string; password: string }): Promise<void> {
    const password = String(input.password ?? '');
    if (!password) throw new Error('Credential vault will not store an empty secret.');
    if (!(await this.isAvailable())) throw new Error('Credential vault unavailable: DPAPI encryption is unavailable.');
    const state = this.read();
    const record = state.records.find((entry) => entry.credentialHandle === input.credentialHandle);
    if (!record) throw new Error('Selected credential was not found.');
    record.ciphertext = await this.bridge.protect(password);
    record.updatedAt = this.now();
    this.write(state);
  }

  async delete(credentialHandle: string): Promise<boolean> {
    const state = this.read();
    const index = state.records.findIndex((entry) => entry.credentialHandle === credentialHandle);
    if (index < 0) return false;
    state.records.splice(index, 1);
    this.write(state);
    return true;
  }

  listMetadata(): VaultMetadata[] {
    return this.read().records.map(metadata).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private require(handle: string): VaultRecord {
    const record = this.read().records.find((entry) => entry.credentialHandle === handle);
    if (!record) throw new Error('Selected credential was not found.');
    return record;
  }

  private read(): VaultFile {
    if (!fs.existsSync(this.vaultPath)) return { version: 1, records: [] };
    try {
      const value = JSON.parse(fs.readFileSync(this.vaultPath, 'utf8')) as VaultFile;
      if (value.version !== 1 || !Array.isArray(value.records)) throw new Error('Unsupported vault record format.');
      return { version: 1, records: value.records.filter(validRecord) };
    } catch (error) { throw safeError(new Error(`Credential vault record cannot be read: ${(error as Error).message}`)); }
  }

  private write(state: VaultFile): void {
    fs.mkdirSync(path.dirname(this.vaultPath), { recursive: true });
    const temp = `${this.vaultPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.vaultPath);
  }
}

function metadata(record: VaultRecord): VaultMetadata {
  const { ciphertext: _ciphertext, ...safe } = record;
  return safe;
}
function validRecord(value: unknown): value is VaultRecord {
  const r = value as Partial<VaultRecord>;
  return !!r && typeof r.credentialHandle === 'string' && typeof r.scope === 'string'
    && typeof r.ciphertext === 'string' && typeof r.createdAt === 'string' && typeof r.updatedAt === 'string';
}
