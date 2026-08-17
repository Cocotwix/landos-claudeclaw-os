import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function registry() {
  return JSON.parse(readFileSync(path.resolve('.landos/capabilities.json'), 'utf8')).capabilities;
}

function matches(pathname, family) {
  const escaped = family.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*');
  return new RegExp(`^${escaped}(?:/.*)?$`).test(pathname);
}

function protectedBy(capability, pathname) {
  return capability.sharedDependencyPaths.some((family) => matches(pathname, family));
}

test('development-control infrastructure is architecture-critical protected capability state', () => {
  const capability = registry().find((item) => item.id === 'development-control-spine');
  assert.ok(capability);
  assert.equal(capability.riskPolicy, 'architecture-critical');
  for (const pathname of [
    'scripts/control',
    'scripts/dev/task.mjs',
    'package.json',
    '.landos/CODING_SESSION_PROTOCOL.md',
    'docs/landos/development-control-spine.md',
  ]) assert.ok(capability.sharedDependencyPaths.includes(pathname), pathname);
  assert.ok(capability.verificationCommands.includes('npm run landos:control:test'));
  assert.ok(capability.verificationCommands.includes('npm run typecheck'));
});

test('live Control Spine package entrypoints and imported V2 UI families are discovered and protected', () => {
  const capabilities = registry();
  const control = capabilities.find((item) => item.id === 'development-control-spine');
  const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
  for (const scriptName of ['landos:task', 'landos:control']) {
    const entrypoint = packageJson.scripts[scriptName].match(/scripts\/[A-Za-z0-9_./-]+\.mjs/)?.[0];
    assert.ok(entrypoint, scriptName);
    assert.equal(protectedBy(control, entrypoint), true, `${scriptName}: ${entrypoint}`);
  }
  assert.equal(protectedBy(control, 'package.json'), true);

  const v2 = capabilities.find((item) => item.id === 'acquisition-workspace-v2-owner-family');
  const page = readFileSync(path.resolve('web/src/pages/AcquisitionWorkspaceV2.tsx'), 'utf8');
  const imported = [
    ...[...page.matchAll(/from ['"]\.\.\/components\/(AcquisitionWorkspaceV2[^'"]+)['"]/g)]
      .map((match) => `web/src/components/${match[1]}.tsx`),
    ...[...page.matchAll(/import ['"]\.\.\/styles\/(workspace-v2[^'"]+\.css)['"]/g)]
      .map((match) => `web/src/styles/${match[1]}`),
  ];
  assert.ok(imported.includes('web/src/styles/workspace-v2-lead-design.css'));
  for (const pathname of imported) assert.equal(protectedBy(v2, pathname), true, pathname);
});

test('the current AcquisitionWorkspaceV2 owner-visible component family and contracts remain protected', () => {
  const capabilities = new Map(registry().map((item) => [item.id, item]));
  const expected = {
    'acquisition-workspace-v2-property-intelligence': [
      'web/src/pages/AcquisitionWorkspaceV2.tsx',
      'web/src/components/AcquisitionWorkspaceV2PropertyIntelligence.tsx',
      'web/src/styles/workspace-v2-property-intelligence.css',
      'src/landos/property-intelligence-contract.ts',
    ],
    'acquisition-workspace-v2-comps-valuation': [
      'web/src/components/AcquisitionWorkspaceV2CompsValuation.tsx',
      'web/src/styles/workspace-v2-comps.css',
      'src/landos/acquisitions.ts',
    ],
    'acquisition-workspace-v2-land-use-gis': [
      'web/src/components/AcquisitionWorkspaceV2LandUse.tsx',
      'web/src/components/AcquisitionWorkspaceV2OfficialParcelGis.tsx',
      'src/landos/land-use.ts',
      'src/landos/official-parcel-gis.ts',
    ],
    'acquisition-workspace-v2-run-status': [
      'web/src/components/AcquisitionWorkspaceV2RunStatus.tsx',
      'src/landos/property-intelligence-orchestrator.ts',
    ],
    'acquisition-workspace-v2-maps-details': [
      'web/src/components/AcquisitionWorkspaceV2CompMap.tsx',
      'web/src/components/AcquisitionWorkspaceV2CompDetails.tsx',
      'web/src/components/AcquisitionWorkspaceV2CompPhotoGallery.tsx',
    ],
    'acquisition-workspace-v2-routes-contracts': [
      'web/src/App.tsx',
      'web/src/lib/routes.ts',
      'web/src/lib/workspace-v2-nav.ts',
      'src/landos/routes.ts',
      'src/landos/command-contract.ts',
    ],
  };
  for (const [id, paths] of Object.entries(expected)) {
    const capability = capabilities.get(id);
    assert.ok(capability, id);
    assert.equal(capability.riskPolicy, 'protected', id);
    assert.ok(capability.invariant, `${id} invariant`);
    assert.ok(capability.acceptancePolicy, `${id} acceptance policy`);
    assert.ok(capability.verificationCommands.length > 0, `${id} verification commands`);
    for (const pathname of paths) assert.ok(capability.sharedDependencyPaths.includes(pathname), `${id}: ${pathname}`);
  }
});
