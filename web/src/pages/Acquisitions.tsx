import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { KanbanSquare, Plus, Library, FileText, MessagesSquare, HandCoins, ClipboardList, ArrowRight } from 'lucide-preact';
import { PageHeader, Tab } from '@/components/PageHeader';
import { PropertyBoard } from '@/pages/PropertyBoard';
import { Acquire } from '@/components/Acquire';
import { DealCard } from '@/components/DealCard';
import { dealWorkspaceHref, lastWorkspaceDealId } from '@/lib/workspace-v2-nav';

// The Acquisitions department workspace (LandOS Vision & Architecture). One
// cohesive department — pipeline, new lead, the deal library, and the Property
// Intelligence Report — instead of the old feature scatter across the LandOS
// spine (Acquire / Intake / Deal Card tabs). Business language, no backend/
// agent/parser clutter. It reuses the existing working surfaces directly:
// Pipeline = Property Board, Deal Library / Property Intelligence = Deal Card,
// New Lead = Acquire. Discovery / Offers / Reports are clean shells that point
// the operator at where that work lives on each Deal Card today.

type AcqSection = 'pipeline' | 'new' | 'library' | 'intel' | 'discovery' | 'offers' | 'reports';

const SECTIONS: Array<{ id: AcqSection; label: string; icon: typeof KanbanSquare }> = [
  { id: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
  { id: 'new', label: 'New Lead', icon: Plus },
  { id: 'library', label: 'Deal Library', icon: Library },
  { id: 'intel', label: 'Property Intelligence', icon: FileText },
  { id: 'discovery', label: 'Discovery', icon: MessagesSquare },
  { id: 'offers', label: 'Offers', icon: HandCoins },
  { id: 'reports', label: 'Reports', icon: ClipboardList },
];

export function Acquisitions() {
  const [, navigate] = useLocation();
  const [section, setSection] = useState<AcqSection>('pipeline');

  // Deep links: the old normal Deal Card route /dept/acquisitions?deal=<id>
  // now redirects to Acquisition Workspace V2 for the same record (replace, so
  // browser back does not loop); ?section=<id> opens a named section.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const deal = Number(q.get('deal'));
    if (Number.isInteger(deal) && deal > 0) { navigate(dealWorkspaceHref(deal), { replace: true }); return; }
    const s = q.get('section');
    if (s && SECTIONS.some((x) => x.id === s)) setSection(s as AcqSection);
  }, []);

  // Every entry path (pipeline card, library row, new lead completion) opens
  // the same record in Acquisition Workspace V2, preserving deal identity.
  function openDeal(id: number) {
    navigate(dealWorkspaceHref(id));
  }

  // Permanent Acquisition Workspace entry: return to the deal most recently
  // worked in V2 this session; with none selected yet, land on the pipeline to
  // pick an opportunity. Never opens V1 and never opens an empty workspace.
  function openWorkspace() {
    const last = lastWorkspaceDealId();
    if (last) navigate(dealWorkspaceHref(last));
    else setSection('pipeline');
  }

  return (
    <div class="flex flex-col h-full">
      <PageHeader
        title="Acquisitions"
        tabs={
          <>
            {SECTIONS.map((s) => (
              <Tab
                key={s.id}
                label={s.label}
                active={section === s.id}
                onClick={() => setSection(s.id)}
              />
            ))}
            <Tab
              key="workspace"
              label="Acquisition Workspace"
              active={false}
              onClick={openWorkspace}
            />
          </>
        }
      />

      {/* Pipeline — the Property Board. Clicking a property opens its Deal Card
          in the library (in-workspace), never a competing intelligence surface. */}
      {section === 'pipeline' && <PropertyBoard embedded onOpenDeal={openDeal} />}

      {/* New Lead — resolve a property and open its Deal Card. */}
      {section === 'new' && (
        <div class="flex-1 overflow-y-auto px-6 py-4">
          <Acquire entity="all" onOpenDealCard={openDeal} />
        </div>
      )}

      {/* Deal Library — the saved-deal list. Every row opens that record in
          Acquisition Workspace V2 via openDeal, identity preserved. */}
      {section === 'library' && (
        <DealCard entity="all" key="library-list" onOpenDeal={openDeal} />
      )}

      {/* Property Intelligence — lives inside each deal's V2 workspace. Open a
          property from the library to review its full report. */}
      {section === 'intel' && (
        <IntelIntro onOpenLibrary={() => setSection('library')} />
      )}

      {section === 'discovery' && (
        <SectionShell
          title="Discovery"
          body="Seller Intelligence for each deal — motivation, call prep, discovery notes, follow-up drafts, and communication history — lives in Deal Activity in the Acquisition Workspace. Open a property to work its discovery."
          cta="Open Deal Library"
          onClick={() => setSection('library')}
        />
      )}
      {section === 'offers' && (
        <SectionShell
          title="Offers"
          body="Offer readiness and Deal Brain strategy live on Overview; the acquisition range, valuation, and supporting comps live in Property & Market. LandOS organizes the inputs; the offer decision stays yours."
          cta="Open Deal Library"
          onClick={() => setSection('library')}
        />
      )}
      {section === 'reports' && (
        <SectionShell
          title="Reports"
          body="Recorded documents and official-source links live in Property & Market. Open an Acquisition Workspace to review the retained evidence for that property."
          cta="Open Deal Library"
          onClick={() => setSection('library')}
        />
      )}
    </div>
  );
}

function IntelIntro({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  return (
    <div class="flex-1 overflow-y-auto px-6 py-6">
      <div class="max-w-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 space-y-3">
        <div class="flex items-center gap-2">
          <FileText size={18} class="text-[var(--color-text-muted)]" />
          <span class="text-[15px] font-semibold text-[var(--color-text)]">Property Intelligence Report</span>
        </div>
        <p class="text-[13px] text-[var(--color-text-muted)] leading-relaxed">
          Each Deal Card is a living Property Intelligence Report for one property: hero visual,
          executive summary, key facts with sources, what the facts mean together, risks and
          unknowns, market and strategy snapshots, and the seller picture — one complete read of
          the opportunity. Open a property from the Deal Library to review its report.
        </p>
        <button
          type="button"
          onClick={onOpenLibrary}
          class="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12.5px] font-medium bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
        >
          Open Deal Library <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function SectionShell({ title, body, cta, onClick }: { title: string; body: string; cta: string; onClick: () => void }) {
  return (
    <div class="flex-1 overflow-y-auto px-6 py-6">
      <div class="max-w-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 space-y-3">
        <div class="text-[15px] font-semibold text-[var(--color-text)]">{title}</div>
        <p class="text-[13px] text-[var(--color-text-muted)] leading-relaxed">{body}</p>
        <button
          type="button"
          onClick={onClick}
          class="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-[12.5px] font-medium border border-[var(--color-border)] hover:bg-[var(--color-elevated)]"
        >
          {cta} <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
