import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WindowsCredentialVault, type DpapiBridge } from './windows-credential-vault.js';

function fakeBridge(available = true): DpapiBridge {
  return {
    async available() { return available; },
    async protect(value) { return Buffer.from(`protected:${value}`, 'utf8').toString('base64'); },
    async unprotect(ciphertext) { return Buffer.from(ciphertext, 'base64').toString('utf8').replace(/^protected:/, ''); },
  };
}

function fixturePath(): string { return path.join('C:\\tmp', `landos-vault-${crypto.randomUUID()}.json`); }

describe('WindowsCredentialVault (unit)', () => {
  it('persists ciphertext and safe metadata but never plaintext', async () => {
    const file = fixturePath();
    const vault = new WindowsCredentialVault(fakeBridge(), file, () => '2026-07-13T00:00:00.000Z');
    const stored = await vault.store({ scope: 'government/monroe-assessor', username: 'public-research', password: 'not-in-json', emailReference: 'alias/records' });
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('not-in-json');
    expect(vault.listMetadata()).toEqual([expect.objectContaining({ credentialHandle: stored.credentialHandle, scope: 'government/monroe-assessor', username: 'public-research', emailReference: 'alias/records' })]);
    expect(await vault.retrieve(stored.credentialHandle)).toMatchObject({ value: 'not-in-json', metadata: { credentialHandle: stored.credentialHandle } });
  });

  it('rotates and deletes only the selected opaque handle', async () => {
    const vault = new WindowsCredentialVault(fakeBridge(), fixturePath());
    const first = await vault.store({ scope: 'government/a', username: 'a', password: 'first' });
    const second = await vault.store({ scope: 'government/b', username: 'b', password: 'second' });
    await vault.rotate({ credentialHandle: first.credentialHandle, password: 'rotated' });
    expect((await vault.retrieve(first.credentialHandle)).value).toBe('rotated');
    expect(await vault.delete(first.credentialHandle)).toBe(true);
    expect((await vault.retrieve(second.credentialHandle)).value).toBe('second');
  });

  it('fails closed when DPAPI is unavailable', async () => {
    const vault = new WindowsCredentialVault(fakeBridge(false), fixturePath());
    await expect(vault.store({ scope: 'government/a', username: 'a', password: 'never-persisted' })).rejects.toThrow(/unavailable/i);
    expect(vault.listMetadata()).toEqual([]);
  });
});
