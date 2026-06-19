# LandOS Durable Decisions

These are durable defaults until Tyler changes them.

| Decision | Rationale |
|----------|-----------|
| LandOS Main orchestrates. | It is the top-level executive assistant and routing layer. |
| Departments are internal apps. | Each department is a sub-system inside LandOS. |
| Duke is one department only. | Duke does not become the whole app. |
| Retrieval lanes return found/not_found/data_gap/etc. | Honest status is better than false certainty. |
| LandOS helps Tyler decide but does not make the final decision. | Tyler remains the operator and owner. |
| Property verification rules reject coordinates/geocoder/proximity identity. | Exact parcel identity must stay exact. |
| LandPortal is a data source, not truth. | Source labels and confidence matter. |
| Assessor and official record are highest-confidence for official property facts. | Official records outrank convenient lookup. |
| Redfin/Zillow sold context is area-level market context and should continue when LandPortal fails. | Market context should not be blocked by one source. |
| Paid comp credits require explicit approval. | Cost control stays explicit. |
| LandOS structure has four categories: department legs, shared surfaces, shared records, interface layers. | Not every concept is a department; War Room/Deal Cards/Voice are not legs. |
| The structure layer references existing department-registry.ts IDs, never duplicates them. | Avoid competing registries and ID churn. |
| Market Research is a separate leg from Due Diligence + Research. | Property-level DD and market-level research are different lanes. |
| CRM/Acquisition/GHL is one planned shell leg with a future integration contract; GHL is not connected. | Replaceable CRM leg, never LandOS foundation; no fake sync. |
| Voice is an interface layer over Command and War Room, not a department. | Voice is I/O, not business logic. |
| Mark/ClaudeClaw's existing War Room page and cards are canonical and preserved. | War Room work is additive routing only, never a redesign. |
| Large property reports/media/transcripts/datasets stay out of repo and laptop; storage uses adapters. | Laptop is the control center, not the warehouse. |

