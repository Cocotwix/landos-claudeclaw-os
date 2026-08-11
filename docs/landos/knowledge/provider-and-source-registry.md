# Provider and official-source registry

The provider registry records capability and evidence boundaries, not
credentials. Existing configured providers may be used only through their
current approved paths. Every provider run ends as results, no qualifying
results, blocked, timed out, unavailable, or skipped with a reason.

## Initial official source set

| Source | Use | Freshness rule | Important limitation |
|---|---|---|---|
| [Wayne County NY Real Property Tax Service](https://www.waynecountyny.gov/333/Real-Property-Tax-Service) | Assessment, tax maps, parcel viewer entry | Revalidate domain at least every 90 days and capture record year | Parcel lines and tax maps are not legal surveys. |
| [Wayne County NY GIS](https://www.waynecountyny.gov/813/Geographic-Information-Systems) | County GIS and parcel layers | Revalidate every 90 days and preserve layer metadata | Public layers can move or change. |
| [New York Statewide Parcel Map Program](https://gis.ny.gov/parcels) | State parcel discovery and annual standardized data | Revalidate every 180 days and record dataset vintage | County data may be fresher. |
| [NYSDEC Environmental Resource Mapper](https://dec.ny.gov/nature/animals-fish-plants/biodiversity-species-conservation/biodiversity-mapping/environmental-resource-mapper) | Wetlands and environmental screening | Revalidate every 90 days and record layer/source date | Informational maps do not establish wetland jurisdiction. |
| [FEMA National Flood Hazard Layer](https://www.fema.gov/flood-maps/national-flood-hazard-layer) | Flood zone, panel, and effective-map evidence | Revalidate every 90 days and capture effective date | Does not replace a floodplain administrator or survey determination. |
| [USDA NRCS Web Soil Survey](https://www.nrcs.usda.gov/resources/data-and-reports/web-soil-survey) | Soils and interpretations | Review annually and capture survey vintage | Onsite work may be required for septic or engineering conclusions. |
| [OpenStreetMap](https://www.openstreetmap.org) | Map and routing context | Review domain/endpoints every 180 days | Does not prove legal access, frontage, easements, or road maintenance. |

Search snippets are discovery only. Open and inspect the underlying source,
validate the final redirect domain, and map each material claim to its source.
The complete machine-readable records and allowlisted domains are in
`config/landos-knowledge/registries/county-gis-source-registry.json` and
`config/landos-research/source-policy.json`.

