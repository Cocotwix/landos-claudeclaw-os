# LandOS Phase 1 data separation and recovery

LandOS uses two physically separate storage profiles:

- `operating` (default): `store/landos.db` and the established operating artifact directories under `store/`.
- `qa`: `.runtime/landos/qa-data/landos-qa.db` and `.runtime/landos/qa-data/artifacts/`.

Set `LANDOS_STORAGE_MODE=qa` only for an isolated synthetic process. QA storage
accepts `TEST LEAD` opportunities only. A QA root inside the operating store is
rejected. The active profile is shown in Mission Control and returned by
`GET /api/landos/storage-profile`.

Do not relabel or move legacy cards merely because their names look like test
data. Older QA activity was mixed with operating records, and uncertain records
must remain preserved until the owner classifies them.

## Encrypted private backup

Run:

```powershell
npm run landos:data:backup
```

The command uses SQLite's online backup API, so WAL state is included safely.
It packages the database with operating visuals, documents, reports, and
training captures. The package is encrypted with AES-256-GCM. Its random key is
wrapped by Windows DPAPI for the current Windows user. The encrypted package,
wrapped key, and checksummed manifest default to the current user's private
Local AppData `LandOS/Backups` directory, outside the repository.

DPAPI recovery is tied to the Windows user profile. Protect that profile with
the owner's normal encrypted system backup; GitHub and `.env` do not restore
business data.

## Restore into a clean target

Restore never overwrites an existing path:

```powershell
npm run landos:data:restore -- "<backup>.tar.aesgcm" "C:\private\clean-landos-restore"
```

The restore verifies package and wrapped-key checksums, AES authentication,
SQLite `quick_check`, foreign keys, schema hash, every LandOS table row count,
and every artifact size and SHA-256 hash. Only after those checks pass should an
owner schedule a managed-runtime cutover. Never replace live storage while
LandOS is running.

## Recovery drill

```powershell
npm run landos:data:drill
```

The drill creates a fresh encrypted backup, restores it into a clean temporary
installation, verifies the complete manifest, writes a report under
`.runtime/landos/backup-restore-drill/`, and removes the temporary plaintext
copy. The encrypted private backup is retained.

