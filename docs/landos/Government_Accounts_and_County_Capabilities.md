# Government Accounts and County Capabilities

## Scope and safety boundary

LandOS now has domain contracts for durable government/public-record account
metadata and county browser capabilities. They are provider-independent building
blocks; they do not themselves create an account or start a browser on page load.

Automatic registration is permitted only for a free official-government or
government-authorized public-record site, for public property research, when:

- no payment method, paid trial, sensitive identity check, or CAPTCHA is required;
- phone verification is either absent or uses an approved company-controlled number;
- registration terms are ordinary technical terms rather than material or unknown obligations;
- the intended automation is permitted and mandatory fields can be answered truthfully;
- a verified, receivable LandOS-controlled email identity is supplied; and
- an approved credential vault is available.

Any failed condition blocks only that source. The account record retains a safe
reason and whether human action is required. “Managed email identity unavailable.”
and “Approved credential storage unavailable.” are stable machine/operator
blockers. LandOS never invents an address.

## Secret handling

ManagedEmailIdentityProvider, CredentialVault, and VerificationMailbox are
injection boundaries. Real email addresses, generated passwords, email
verification links/codes, cookies, bearer tokens, and authenticated browser state
remain transient. SQLite stores only an email-alias reference, opaque credential
handle, safe session state, timestamps, status, and redacted failure metadata.
Navigation recipes reject secret-bearing fields and credential/session query
parameters.

LandOS now uses a local current-user Windows DPAPI vault. Its encrypted file contains ciphertext and safe lifecycle metadata only; the DPAPI helper receives a secret only through standard input. The current environment still has no approved receivable managed mailbox or verification-mailbox adapter, so registration is precisely blocked by managed-email verification. Fixture tests prove policy and vault behavior; no government account was created.

## Account lifecycle

The manager supports registration pending, email verification pending, active,
session expired, recovery required, human action required, blocked, suspended,
and retired states. It reuses active accounts, records successful logins without
storing session secrets, and keeps password-rotation and recovery metadata.
Verification retrieval is sender-domain scoped and bounded to 60 seconds.

## County Capability Registry

Each state/county record can retain official GIS, assessor, tax, recorder, and
planning/zoning URLs; platform family; implemented search methods; public/login
requirements; managed-account and CAPTCHA states; available layers; verified
timestamps; known failures; confidence; and evidence provenance.

Recognized classifications are ArcGIS, Schneider Beacon, qPublic, Vision
Government Solutions, Tyler Technologies, MapGeo, Patriot Properties, custom
county portals, and unknown. Classification is not a support claim. Every county
separately records observed-only, fixture-tested, live-tested, or unsupported.

## Recipe lifecycle

1. Discover a county source and save provenance.
2. Attempt public access first.
3. Use a current recipe only while it is within the configured verification age.
4. Publish a new recipe version only after a successful run validates at least
   one fact and captures evidence.
5. Supersede the previous version; preserve history.
6. Count bounded run failures. Mark a recipe stale after repeated failures or
   immediately when a structural site change is observed.
7. Clear failures only after a new successful verified run.

Recipes contain navigation intent and intake-field references, never literal
credentials. County evidence remains screening/research evidence until the parcel
resolution and Deal Card evidence-precedence rules accept the extracted fact.

