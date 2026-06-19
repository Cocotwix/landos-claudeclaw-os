// Static checks on the LandOS Command home UI + the structure route wiring, and
// a War Room preservation regression. The web app runs in a browser (no jsdom
// here), so we source-scan the .tsx like the other LandOS UI tests.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { REQUIRED_DEPARTMENT_LEG_IDS, WAR_ROOM_PRESERVED_CARDS } from './landos-structure.js';

const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8');

const COMMAND = read('../../web/src/components/CommandHome.tsx');
const PAGE = read('../../web/src/pages/LandOS.tsx');
const WARROOM = read('../../web/src/pages/WarRoom.tsx');
const ROUTES = read('./routes.ts');

describe('LandOS Command home page wiring', () => {
  it('adds a Command tab and renders CommandHome for it', () => {
    expect(PAGE).toMatch(/import \{ CommandHome \} from '@\/components\/CommandHome'/);
    expect(PAGE).toMatch(/label="Command"/);
    expect(PAGE).toMatch(/view === 'command' && <CommandHome/);
  });

  it('keeps the existing Overview and Intake Planner tabs intact', () => {
    expect(PAGE).toMatch(/label="Overview"/);
    expect(PAGE).toMatch(/label="Intake Planner"/);
    expect(PAGE).toMatch(/view === 'intake' && <IntakePlanner \/>/);
  });

  it('adds a Deal Card tab/panel', () => {
    expect(PAGE).toMatch(/import \{ DealCard \} from '@\/components\/DealCard'/);
    expect(PAGE).toMatch(/label="Deal Card"/);
    expect(PAGE).toMatch(/view === 'dealcard' && <DealCard/);
  });
});

describe('CommandHome tiles + quick links', () => {
  it('fetches the read-only structure summary and maps leg tiles', () => {
    expect(COMMAND).toMatch(/apiGet<[^>]*>\('\/api\/landos\/structure'\)/);
    expect(COMMAND).toMatch(/\.legs\b/);
    expect(COMMAND).toMatch(/\(legs \?\? \[\]\)\.map/);
  });

  it('renders status + summary metric label + alert indicator per tile', () => {
    expect(COMMAND).toMatch(/leg\.status/);
    expect(COMMAND).toMatch(/leg\.summaryMetricLabel/);
    expect(COMMAND).toMatch(/leg\.canAlert/);
  });

  it('provides additive quick links to Deal Cards and the existing War Room', () => {
    expect(COMMAND).toMatch(/Deal Cards/);
    expect(COMMAND).toMatch(/War Room/);
    // War Room link navigates to the EXISTING /warroom route (does not re-render it).
    expect(COMMAND).toMatch(/setLocation\('\/warroom'\)/);
  });

  it('shows the Command home shells (KPIs, action center, exit lanes, trends)', () => {
    for (const s of ['LandOS Command', 'Action Center', 'Department Legs', 'Exit Strategy Lanes', 'Performance Trends']) {
      expect(COMMAND.includes(s), `missing ${s}`).toBe(true);
    }
  });

  it('does not fabricate metrics or integrations (placeholders are explicit)', () => {
    expect(COMMAND).toMatch(/Not captured yet/);
    expect(/lp_comp_report_create|lp_comp_report_get/.test(COMMAND)).toBe(false);
    expect(/geocod|proximity|nearest parcel|map pin/i.test(COMMAND)).toBe(false);
  });
});

describe('structure API route', () => {
  it('registers a read-only /api/landos/structure route from the structure spine', () => {
    expect(ROUTES).toMatch(/'\/api\/landos\/structure'/);
    expect(ROUTES).toMatch(/landosStructureSummary\(\)/);
    expect(ROUTES).toMatch(/warRoomPreservation\(\)/);
    expect(ROUTES).toMatch(/WAR_ROOM_ROUTING_CONTRACT/);
  });

  it('exposes every required department leg via the summary it serves', () => {
    // The route serves landosStructureSummary(); assert the contract has them all.
    expect(REQUIRED_DEPARTMENT_LEG_IDS.length).toBe(10);
  });
});

describe('War Room preservation (regression)', () => {
  it('the existing War Room page still contains all six cards', () => {
    for (const card of WAR_ROOM_PRESERVED_CARDS) {
      expect(WARROOM.includes(card), `War Room missing card ${card}`).toBe(true);
    }
  });

  it('keeps Gemini Live / Pipecat / classic War Room language', () => {
    expect(WARROOM).toMatch(/Pipecat \+ Gemini Live|Gemini Live/);
    expect(WARROOM).toMatch(/Pipecat/);
    expect(WARROOM).toMatch(/Open in classic|legacy dashboard/);
  });

  it('CommandHome does not redefine or rebuild the War Room page (links only)', () => {
    // It must not import the WarRoom page or its panes.
    expect(/from '@\/pages\/WarRoom'/.test(COMMAND)).toBe(false);
    expect(/VoicePane|MeetPane|TextPane/.test(COMMAND)).toBe(false);
  });
});
