import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { EnvironmentManagedEmailProvider, ManagedIdentityRepository, managedIdentityStatus } from './managed-identity.js';

describe('managed LandOS identity (unit)', () => {
  it('creates a truthful blocked identity when no managed mailbox is configured', async () => {
    const repository = new ManagedIdentityRepository(new Database(':memory:'));
    const status = await managedIdentityStatus(repository, new EnvironmentManagedEmailProvider({}));
    expect(status.identity).toMatchObject({ identityId: 'landos-public-research', status: 'blocked', managedEmailAliasReference: null, managedPhoneReference: null });
    expect(status.managedEmail).toMatchObject({ available: false });
    expect(JSON.stringify(repository.listAudit(status.identity.identityId))).not.toMatch(/password|token|secret/i);
  });
  it('never treats example, unverified, or unreferenced email as a real mailbox', async () => {
    await expect(new EnvironmentManagedEmailProvider({ LANDOS_MANAGED_EMAIL: 'research@example.com', LANDOS_MANAGED_EMAIL_ALIAS_REFERENCE: 'alias/x', LANDOS_MANAGED_EMAIL_VERIFIED: 'true' }).resolve()).resolves.toBeNull();
    await expect(new EnvironmentManagedEmailProvider({ LANDOS_MANAGED_EMAIL: 'research@company.invalid', LANDOS_MANAGED_EMAIL_ALIAS_REFERENCE: 'alias/x', LANDOS_MANAGED_EMAIL_VERIFIED: 'false' }).resolve()).resolves.toBeNull();
  });
});
