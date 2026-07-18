// Phase 1 tombstone. LandPortal API/MCP access is permanently disabled.
// The approved integration is src/landos/landportal-browser.ts through the
// authenticated browser session. This process performs no secret reads and no
// network calls if an obsolete launcher invokes it.
process.stderr.write('[landportal-mcp] disabled: authenticated browser workflow only\n');
process.exitCode = 78;
