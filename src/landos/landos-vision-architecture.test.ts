// Architecture-drift guard for the LandOS Vision & Architecture alignment
// (docs/LANDOS_VISION_AND_ARCHITECTURE.md). The web app runs in a browser (no
// jsdom here), so — like property-board-ui.test.ts — these are static checks on
// the source: the Vision doc exists, the department navigation model is present
// and complete, existing surfaces are mapped into the right departments, the
// Property Board stays acquisitions pipeline that opens the Deal Card, shell
// departments render, and the APN-conflict hard stop is untouched.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

function read(rel: string): string {
  return fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');
}

const VISION = read('../../docs/LANDOS_VISION_AND_ARCHITECTURE.md');
const DEPARTMENTS = read('../../web/src/lib/departments.ts');
const ROUTES = read('../../web/src/lib/routes.ts');
const APP = read('../../web/src/App.tsx');
const DEPARTMENT_PAGE = read('../../web/src/pages/Department.tsx');
const MISSION = read('../../web/src/pages/MissionControl.tsx');
const BOARD = read('../../web/src/pages/PropertyBoard.tsx');
const RESOLUTION_ENGINE = read('./property-resolution-engine.ts');

// The eleven business departments in the Vision, by nav slug + label.
const DEPARTMENT_SLUGS = [
  'acquisitions',
  'crm',
  'marketing',
  'market-research',
  'competitor-intelligence',
  'strategy-training',
  'dispositions',
  'transaction-coordination',
  'finance',
  'ai-research',
  'operations',
];

const DEPARTMENT_LABELS = [
  'Acquisitions', 'CRM', 'Marketing', 'Market Research', 'Competitor Intelligence',
  'Strategy & Training', 'Dispositions', 'Transaction Coordination', 'Finance',
  'AI Research', 'Operations',
];

describe('Vision & Architecture document', () => {
  it('exists and is versioned v1.2', () => {
    expect(VISION).toContain('# LandOS Vision & Architecture v1.2');
  });

  it('captures the core product model — a business operating system, not a tool grid', () => {
    expect(VISION).toContain('AI operating system for running a modern land investment company');
    expect(VISION).toContain('LandOS improves the operator’s judgment.');
    expect(VISION).toContain('Not a random grid of AI tools.');
  });

  it('describes the executive layer and every required structural section', () => {
    for (const heading of [
      '## Purpose', '## Vision', '## Executive Layer', '### Jarvis / Command',
      '## Departments', '## Deal Card', '## Property Board', '## Mission Control',
      '## Provider Architecture', '## Final Product Standard',
    ]) {
      expect(VISION, `missing section ${heading}`).toContain(heading);
    }
  });

  it('names every business department', () => {
    for (const label of DEPARTMENT_LABELS) {
      expect(VISION, `Vision missing department ${label}`).toContain(`### ${label}`);
    }
  });
});

describe('Department navigation model', () => {
  it('defines every business department slug and label', () => {
    for (const slug of DEPARTMENT_SLUGS) {
      expect(DEPARTMENTS, `missing slug ${slug}`).toContain(`slug: '${slug}'`);
    }
    for (const label of DEPARTMENT_LABELS) {
      expect(DEPARTMENTS, `missing label ${label}`).toContain(`label: '${label}'`);
    }
  });

  it('keeps the Property Board and Deal Card under Acquisitions', () => {
    // Both surfaces are declared in departments.ts on the acquisitions entry.
    expect(DEPARTMENTS).toMatch(/slug: 'acquisitions'/);
    expect(DEPARTMENTS).toContain("href: '/board'");
    expect(DEPARTMENTS).toContain("href: '/landos?view=dealcard'");
  });

  it('maps Market Intelligence into Market Research', () => {
    expect(DEPARTMENTS).toContain("href: '/market'");
  });

  it('exposes the model router + a visible AI Tech Stack under AI Research', () => {
    expect(DEPARTMENTS).toContain("href: '/landos?view=router'");
    expect(DEPARTMENTS).toMatch(/techStack:/);
  });

  it('marks unbuilt departments as clean shells, not fake-operational', () => {
    // CRM, Marketing, Competitor Intelligence, Dispositions, Transaction
    // Coordination are shells.
    expect(DEPARTMENTS).toMatch(/slug: 'crm',[\s\S]*?status: 'shell'/);
    expect(DEPARTMENTS).toMatch(/slug: 'competitor-intelligence',[\s\S]*?status: 'shell'/);
  });
});

describe('Sidebar / router structure reflects the architecture', () => {
  it('groups navigation into Company, Departments, and System', () => {
    expect(ROUTES).toContain("'company' | 'departments' | 'system'");
    expect(ROUTES).toContain("company:     'Company'");
    expect(ROUTES).toContain("departments: 'Departments'");
    expect(ROUTES).toContain("system:      'System'");
  });

  it('derives department nav from the single department model (no drift)', () => {
    expect(ROUTES).toContain("import { DEPARTMENTS } from './departments'");
    expect(ROUTES).toMatch(/DEPARTMENTS\.map\(\(d\) => \(\{[\s\S]*?path: `\/dept\/\$\{d\.slug\}`/);
  });

  it('keeps Mission Control as the executive default and surfaces Jarvis', () => {
    expect(ROUTES).toContain("export const DEFAULT_ROUTE = '/mission'");
    expect(ROUTES).toContain("label: 'Jarvis'");
  });

  it('routes every department through the Department workspace page', () => {
    expect(APP).toContain('/dept/:slug');
    expect(APP).toContain('<Department slug={params.slug} />');
  });
});

describe('Department workspace page', () => {
  it('renders purpose, records, capabilities, and backing workspaces', () => {
    expect(DEPARTMENT_PAGE).toContain('getDepartment');
    expect(DEPARTMENT_PAGE).toContain('Business records');
    expect(DEPARTMENT_PAGE).toContain('Capabilities');
    expect(DEPARTMENT_PAGE).toContain('Workspaces');
  });

  it('renders a clean shell note for departments that are not built yet', () => {
    expect(DEPARTMENT_PAGE).toContain('not built out yet');
  });

  it('renders the AI Tech Stack table', () => {
    expect(DEPARTMENT_PAGE).toContain('AI Tech Stack');
  });
});

describe('Mission Control is the executive dashboard', () => {
  it('leads with an executive overview, not a bare task launcher', () => {
    expect(MISSION).toContain('ExecutiveOverview');
    expect(MISSION).toContain('what needs attention');
    // Department health is surfaced from the department model.
    expect(MISSION).toContain("from '@/lib/departments'");
  });

  it('preserves the task delegation board', () => {
    expect(MISSION).toContain('Task delegation');
    expect(MISSION).toContain('AgentColumn');
  });
});

describe('Property Board stays acquisitions pipeline and opens the Deal Card', () => {
  it('still opens the canonical Deal Card via /landos?deal=', () => {
    expect(BOARD).toMatch(/\/landos\?deal=\$\{[^}]+\}/);
    expect(BOARD).toMatch(/function openDealCard/);
  });

  it('does not rebuild a competing property intelligence surface', () => {
    expect(/OperatorInspectionBrief/.test(BOARD)).toBe(false);
    expect(/Comparable Intelligence/.test(BOARD)).toBe(false);
  });
});

describe('Existing APN-conflict hard stop remains intact', () => {
  it('still exports the wrong-parcel hard-stop detector', () => {
    expect(RESOLUTION_ENGINE).toContain('export function detectApnConflict');
    expect(RESOLUTION_ENGINE).toContain('wrong-parcel hard-stop');
  });
});
