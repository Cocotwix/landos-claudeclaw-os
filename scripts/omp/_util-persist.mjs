// Persist the Fairview utility availability research as OBSERVATIONS.
//
// Nothing derived is stored: the six-dimension read, the evidence levels, the
// lead relevance gate and the confirmation package are all recomputed on every
// request by `projectUtilityAvailability`.
import { persistUtilityAvailabilityRecord } from '../../dist/landos/utility-service-screen-capability.js';
import { readResolverSubject } from '../../dist/landos/universal-property-resolution.js';

const DEAL = 89;
const subject = readResolverSubject(DEAL);
if (!subject) throw new Error('deal 89 has no resolved subject');
console.log('subject', subject.propertyCardId, subject.apn, subject.acres);

const RETRIEVED = '2026-08-23T15:57:05.473Z';
const SHOT = (kind) => `C:\\Users\\tbutt\\claudeclaw-os\\store\\browser-shots\\deal89_utility_${kind}.png`;

const WADC_GIS = {
  label: 'Water Authority of Dickson County published GIS — Hosted/Fairview_Water_Mains layer 127',
  url: 'https://esriapps1.esriwadc.com/arcgis/rest/services/Hosted/Fairview_Water_Mains/FeatureServer/127',
  screenshotPath: SHOT('water'),
  retrievedAt: RETRIEVED,
};
const WADC_SEWER_GIS = {
  label: 'Water Authority of Dickson County published GIS — Hosted/Sewer_Pipe_Viewer layer 138',
  url: 'https://esriapps1.esriwadc.com/arcgis/rest/services/Hosted/Sewer_Pipe_Viewer/FeatureServer/138',
  screenshotPath: SHOT('sewer'),
  retrievedAt: RETRIEVED,
};
const CITY_GUIDE = {
  label: 'City of Fairview Utilities Quick Guide (official municipal source)',
  url: 'https://www.fairview-tn.org/depts-services/utilities-quick-guide/',
  retrievedAt: RETRIEVED,
};
const WADC_AREA = {
  label: 'Water Authority of Dickson County published GIS — Hosted/WADC_Service_Area layer 5 (Fairview service area, 106.76 sq mi)',
  url: 'https://esriapps1.esriwadc.com/arcgis/rest/services/Hosted/WADC_Service_Area/FeatureServer/5',
  retrievedAt: RETRIEVED,
};
const TDEC = {
  label: 'TDEC Public Water System Service Areas — PWSID TN0000191, WATER AUTH OF DICKSON COUNTY',
  url: 'https://services5.arcgis.com/bPacKTm9cauMXVfn/arcgis/rest/services/Service_Line_Inventory_PWS_Service_Area/FeatureServer/0',
  retrievedAt: RETRIEVED,
};
const COUNTY_PARCELS = {
  label: 'Williamson County GIS parcel layer, cross-referenced with WADC utility geometry',
  url: 'https://services8.arcgis.com/hkhKI6Qq7rjvBjZU/arcgis/rest/services/Parcels/FeatureServer/0',
  retrievedAt: RETRIEVED,
};

const CONTACT = {
  name: 'Water Authority of Dickson County',
  department: 'Engineering Department / Water & Sewer Availability',
  phone: '(615) 441-4188',
  email: 'info@wadc.us',
  formUrl: 'https://wadc.us/start-stop-or-reconnect-service/',
  websiteUrl: 'https://wadc.us/engineering/',
};

const PROVIDER = {
  name: 'Water Authority of Dickson County',
  providerType: 'regional water and wastewater authority',
  basisIsUtilityRecord: true,
  source: CITY_GUIDE,
};

const record = {
  version: 1,
  depth: 'DEEP_DEVELOPMENT',
  researchedAt: RETRIEVED,

  water: {
    provider: PROVIDER,
    territory: { state: 'inside', source: TDEC },
    corridor: {
      relationship: 'ADJACENT',
      layerName: 'Fairview_Water_Mains (WADC hosted layer 127)',
      mainSizeInches: 6,
      pressureZone: 'WADC Fairview hydrant zone 4 (DISTR 2 symbol group)',
      hydrantsObserved: true,
      source: WADC_GIS,
    },
    contact: CONTACT,
  },

  sewer: {
    provider: PROVIDER,
    territory: { state: 'inside', source: WADC_AREA },
    corridor: {
      relationship: 'ADJACENT',
      layerName: 'Sewer_Pipe_Viewer (WADC hosted layer 138)',
      mainSizeInches: 8,
      lineType: 'gravity',
      liftStationObserved: false,
      source: WADC_SEWER_GIS,
    },
    contact: CONTACT,
  },

  contextLeads: [
    {
      kind: 'subject_road_corridor',
      label: 'Kingwood Boulevard, the road the subject is addressed on',
      sharesSubjectRoad: true,
      adjoinsSubject: true,
      sharesImmediateStreetNetwork: true,
    },
    {
      kind: 'adjoining_residential_neighborhood',
      label: 'The established Kingwood Boulevard / Kingwood Court neighbourhood',
      sharesSubjectRoad: true,
      adjoinsSubject: false,
      sharesImmediateStreetNetwork: true,
      developedLotCount: 24,
    },
    {
      kind: 'connected_new_development',
      label: 'Meritage Homes Cedarcrest Lane subdivision, under construction on the subject\u2019s north and west boundary',
      sharesSubjectRoad: false,
      adjoinsSubject: true,
      sharesImmediateStreetNetwork: true,
    },
    {
      // Deliberately recorded so the refusal is visible: the Fairview Boulevard
      // (SR-100) retail strip is closer in a straight line than parts of the
      // Kingwood neighbourhood, and is served from a different corridor.
      kind: 'same_road_commercial',
      label: 'The Fairview Boulevard / SR-100 retail strip west of the subject',
      sharesSubjectRoad: false,
      adjoinsSubject: false,
      sharesImmediateStreetNetwork: false,
      straightLineFeet: 2600,
    },
  ],

  neighborhoodPattern: {
    lead: {
      kind: 'adjoining_residential_neighborhood',
      label: 'The established Kingwood Boulevard / Kingwood Court neighbourhood',
      sharesSubjectRoad: true,
      adjoinsSubject: false,
      sharesImmediateStreetNetwork: true,
      developedLotCount: 24,
    },
    water: 'public_water',
    wastewater: 'public_sewer',
    basis: 'WADC’s own water main and sewer pipe geometry measured against every developed lot on the subject road — each within 69 ft of a 6-inch water main, and each within 46 ft of a WADC LOW-PRESSURE sewer line of 1.5 to 3 inches rather than a gravity main',
    source: COUNTY_PARCELS,
  },

  developmentTraces: [
    {
      kind: 'water',
      trace: {
        projectName: 'Meritage Homes Cedarcrest Lane subdivision',
        developer: 'Meritage Homes of TN Inc',
        waterSource: 'Water Authority of Dickson County',
        waterExtension: '6-inch ductile iron main constructed 2025, extended east through the subdivision',
        mainSizeInches: 6,
        connectionPoint: 'the extended main terminates approximately 13 ft from the subject\u2019s north boundary, with WADC hydrant F-04-595 at the same distance',
        runsAlongSubjectCorridor: true,
        source: WADC_GIS,
      },
    },
    {
      kind: 'sewer',
      trace: {
        projectName: 'Meritage Homes Cedarcrest Lane subdivision',
        developer: 'Meritage Homes of TN Inc',
        sewerRouting: '8-inch gravity collection installed 2024, a 245 ft segment of it in public right-of-way along the subject\u2019s north boundary',
        forceMain: '4-inch force main serving the same development',
        mainSizeInches: 8,
        connectionPoint: 'the 8-inch gravity line runs approximately 41 ft from the subject\u2019s north boundary',
        runsAlongSubjectCorridor: true,
        source: WADC_SEWER_GIS,
      },
    },
  ],

  historicalPlans: [
    {
      projectName: 'the prior Kingwood development proposal for this site',
      kind: 'sewer',
      proposedInfrastructure: ['two pump stations', 'complete internal water and sewer infrastructure'],
      intendedToServe: 'the platted phases of the prior project on this parcel',
      constructionEvidenced: false,
      source: {
        label: 'Retained Fairview city minutes and prior-project record (LandOS recorded-document intelligence)',
      },
    },
  ],

  researchNotes: [
    'Provider: the City of Fairview\u2019s own Utilities Quick Guide lists Water Authority of Dickson County as the sole water and sewer provider for the city; the city supplies neither itself.',
    'Service territory: confirmed twice independently \u2014 TDEC\u2019s Public Water System Service Areas layer places the exact subject coordinate inside PWSID TN0000191 (WATER AUTH OF DICKSON COUNTY, 63,382 population served), and WADC\u2019s own service-area layer places it inside its FAIRVIEW area (106.76 sq mi, 678,098 ft of water main and 570,238 ft of sewer main).',
    'Subject-corridor GIS: the City of Fairview publishes no water or sewer layer, and Williamson County publishes none either \u2014 both were enumerated and neither carries one. The corridor question was answered instead from WADC\u2019s own published ArcGIS Server, which hosts Fairview_Water_Mains, Fairview_Hydrants and Sewer_Pipe_Viewer as public layers.',
    'Water geometry: no WADC water main intersects the subject parcel. The nearest is a 6-inch ductile iron main constructed 2025, approximately 13 ft from the parcel boundary inside the adjoining Meritage development, with WADC hydrant F-04-595 at the same distance. A separate 6-inch main follows Kingwood Boulevard itself, approximately 230 ft from the parcel boundary.',
    'Sewer geometry: no WADC sewer line intersects the subject parcel. The nearest is an 8-inch gravity line approximately 41 ft from the north boundary \u2014 a 245 ft segment installed 2024 in public right-of-way. 4-inch force mains and 1.5-to-3-inch low-pressure sewer run throughout the immediate area.',
    'Neighbourhood pattern: all 24 developed lots on the subject\u2019s own road are on WADC public water AND on WADC LOW-PRESSURE sewer, not gravity and not septic. The local wastewater method here is pressure sewer.',
    'That pattern reads directly onto the prior Kingwood proposal\u2019s two pump stations: pumping is how this area moves wastewater, so the site\u2019s own prior engineering is consistent with current local practice. It still establishes nothing about availability today.',
    'The Fairview Boulevard / SR-100 retail strip was deliberately NOT researched: it is roughly 2,600 ft away in a straight line but sits on a different corridor, so how it is served says nothing about the subject\u2019s frontage.',
    'WADC does not publish an engineering line map or an availability determination online; its Engineering Department maintains the system GIS internally and its published availability path is the Water/Sewer Availability request, which asks for exactly the address and parcel number LandOS holds.',
  ],
};

const id = persistUtilityAvailabilityRecord(subject.propertyCardId, record);
console.log('persisted activity row', id);
