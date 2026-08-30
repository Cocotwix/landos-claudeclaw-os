# Browser QA — WS3 Durable Run Identity and Cancellation

- Date: 2026-08-30
- Runtime: managed LandOS PID 271180 for the cancellation journey; rebuilt runtime subsequently verified healthy
- Verdict: PASS

## Journey

1. Opened Deal 92 Overview in the real in-app browser and started **Read the property file**.
2. Confirmed the existing live progress UX: the launch control disabled, **Stop run** appeared, and the stage strip reported Preparing Property File with Property / Market / Deal planned.
3. Hard-refreshed while the run was active. The page rejoined the same durable run and displayed the same active stage and Stop control; no duplicate launch occurred.
4. Clicked **Stop run**. The operator surface immediately returned to the idle launch control and displayed **Stopped by Operator.**
5. Hard-refreshed again. Cancellation persisted and no stage remained running. Browser console errors: zero.
6. Queried the durable record read-only: status `cancelled`, `authoritative=0`, `cancel_requested=1`, terminal progress `cancelled`, every open stage settled, and the same runId retained.
7. Queried authoritative outputs by that runId: zero evidence rows and zero intelligence snapshots.
8. Opened Deal 89, which has a current completed read. Re-read completed as a no-op reuse, cleared the running UI honestly, and the identical current read remained after hard refresh.

## Evidence

- `.runtime/landos/qa/shared-foundation-ws3-cancelled-refresh.jpg`
- `.runtime/landos/qa/shared-foundation-ws3-completed-refresh.jpg`
- Focused tests: `intelligence-stack-run-store`, `shared-evidence-contract`, `intelligence-run-progress`, `property-intelligence-store`, `intelligence-stack` — 67/67 passed.

No paid API or data purchase was made. The cancelled run was stopped before specialist execution could publish.
