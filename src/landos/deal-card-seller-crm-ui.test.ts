import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = fs.readFileSync(path.join(process.cwd(), 'web/src/components/DealCard.tsx'), 'utf8');

describe('Deal Card Seller & Comms CRM workspace', () => {
  it('keeps contacts complete and reversible', () => {
    for (const label of [
      'Full name',
      'Phone',
      'Email',
      'Mailing address',
      'Role',
      'Relationship to owner',
      'Decision authority',
      'Primary contact',
      'Preferred contact method',
      'Notes',
    ]) {
      expect(SRC, `missing contact field ${label}`).toContain(label);
    }
    expect(SRC).toMatch(/apiPatch\(`\/api\/landos\/deal-cards\/\$\{dealId\}\/people\/\$\{editing\}`/);
    expect(SRC).toMatch(/apiDelete\(`\/api\/landos\/deal-cards\/\$\{dealId\}\/people\/\$\{person\.id\}`/);
    expect(SRC).toMatch(/Remove \$\{person\.name \|\| 'this contact'\} from this Deal Card/);
    expect(SRC).toContain('Government owner of record');
    expect(SRC).toContain('Confirm this contact’s relationship and signing authority before contracting.');
  });

  it('supports rich task entry, completion, edit, and deletion', () => {
    for (const field of ['Title', 'Due date', 'Assigned owner', 'Priority', 'Reminder']) {
      expect(SRC, `missing task field ${field}`).toContain(field);
    }
    expect(SRC).toMatch(/next-actions\/\$\{editingId\}/);
    expect(SRC).toMatch(/\{ status \}/);
    expect(SRC).toMatch(/status: 'completed' \| 'open'/);
    expect(SRC).toMatch(/apiDelete\(`\/api\/landos\/property-cards\/\$\{propertyCardId\}\/next-actions\/\$\{task\.id\}`/);
  });

  it('supports communication actions and all safe close paths', () => {
    for (const kind of ['Call', 'Text', 'Email', 'Note', 'Transcript']) {
      expect(SRC, `missing communication kind ${kind}`).toContain(`>${kind}<`);
    }
    expect(SRC).toContain('Edit communication');
    expect(SRC).toMatch(/acquisition\/comm\/\$\{encodeURIComponent\(communicationIdentifier\(entry\)\)\}/);
    expect(SRC).toMatch(/apiDelete\(`\/api\/landos\/deal-cards\/\$\{dealCardId\}\/acquisition\/comm\/\$\{encodeURIComponent\(id\)\}`/);
    expect(SRC).toContain("if (event.key !== 'Escape') return");
    expect(SRC).toContain('if (event.target === event.currentTarget) requestClose()');
    expect(SRC).toContain('Discard this unsaved communication?');
    expect(SRC).toContain('aria-label="Close communication dialog"');
    expect(SRC).toMatch(/type="button" onClick=\{requestClose\}[^>]*>Cancel<\/button>/);
  });

  it('keeps Seller score pending and shows every missing seller input', () => {
    expect(SRC).toMatch(/hasSellerEvidence && sellerScore \? sellerScore\.value : 'Pending'/);
    expect(SRC).toContain('Property intake or generic notes do not count as seller motivation.');
    for (const label of [
      'Contact',
      'Asking price',
      'Motivation',
      'Timeline',
      'Responsiveness',
      'Authority',
      'Flexibility',
      'Cooperation',
    ]) {
      expect(SRC, `missing seller checklist item ${label}`).toMatch(
        new RegExp(`label: '${label}'`),
      );
    }
  });

  it('uses responsive, wrapping layouts for previously clipped CRM content', () => {
    expect(SRC).toMatch(/data-testid="seller-crm-workspace" class="min-w-0 space-y-3"/);
    expect(SRC).toMatch(/Discovery-call questions[\s\S]{0,500}break-words/);
    expect(SRC).toMatch(/Seller notes & negotiation context[\s\S]{0,250}whitespace-pre-wrap break-words/);
    expect(SRC).toMatch(/Contacts & decision-makers[\s\S]{0,2000}flex[^"]*flex-wrap/);
  });
});
