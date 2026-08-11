import { describe, expect, it } from 'vitest';
import { assessOverviewFraming, OVERVIEW_CAPTURE_KEY, planOverviewCapture, selectOverviewVisual } from './landportal-overview-capture.js';
import { contextZoomOutSteps } from './parcel-visual-framing.js';

const good = { active_view: 'parcel_context', requested_view: 'parcel_context', boundary_visible: true, tiles_loaded: true, camera_scale: 'context', clipped: false, obstructions: [] as string[] };

describe('planOverviewCapture', () => {
  it('uses the stable Overview key', () => expect(OVERVIEW_CAPTURE_KEY).toBe('landportal_overview'));
  it('delegates zoom to the shared rule', () => expect(planOverviewCapture({ subjectAcres: 60 }).zoomOutSteps).toBe(contextZoomOutSteps(60)));
  it('names the supplied road and all required context', () => {
    const plan = planOverviewCapture({ subjectAcres: 60, roadName: 'Elk Lake Rd' });
    expect(plan.framingIntent).toContain('Elk Lake Rd');
    expect(plan.framingIntent.length).toBeGreaterThanOrEqual(60);
    expect(plan.mustShow).toHaveLength(4);
    expect(plan.requires).toEqual({ boundaryVisible: true, tilesLoaded: true, roadInFrame: true });
  });
});

describe('assessOverviewFraming', () => {
  it('accepts a clean parcel context frame', () => expect(assessOverviewFraming(good).accepted).toBe(true));
  it('rejects county and national frames', () => {
    expect(assessOverviewFraming({ ...good, camera_scale: 'county' }).accepted).toBe(false);
    expect(assessOverviewFraming({ ...good, camera_scale: 'national' }).accepted).toBe(false);
  });
  it('rejects missing boundaries', () => expect(assessOverviewFraming({ ...good, boundary_visible: false }).reason).toMatch(/boundary/i));
  it('rejects unloaded tiles', () => expect(assessOverviewFraming({ ...good, tiles_loaded: false }).reason).toMatch(/tiles/i));
  it('rejects clipping and obstructions', () => {
    expect(assessOverviewFraming({ ...good, clipped: true }).accepted).toBe(false);
    expect(assessOverviewFraming({ ...good, obstructions: ['sidebar'] }).reason).toMatch(/sidebar/i);
  });
  it('rejects default 3D active view', () => expect(assessOverviewFraming({ ...good, active_view: 'default_3d' }).accepted).toBe(false));
});

describe('selectOverviewVisual', () => {
  it('selects the valid frame regardless of input order', () => expect(selectOverviewVisual([{ ...good, active_view: 'default_3d' }, { ...good, id: 2 }]).artifact).toMatchObject({ id: 2 }));
  it('returns no invented Overview for an empty list', () => expect(selectOverviewVisual([])).toMatchObject({ artifact: null, accepted: false }));
});
