# V1.3 validation report

**Date:** 24 September 2026  
**Status:** Local validation passed. Live Connecteam account acceptance remains outstanding.

## Completed checks

- Production build: **PASS**, Next.js 15.5.24. Compilation, type/lint phase, page generation, optimization, and build tracing completed successfully. The final build contains the page and all three API routes.
- Automated logic suite: **27 passed, 0 failed** using Node’s test runner.
- Production-route checks: **PASS**, executed against the compiled Next.js server with test-only upstream responses.
- Browser checks: **PASS** for the workflows below, exercised in the Codex in-app browser against that production server. No captured browser console errors.

### Logic and API routes

Checked nested creation; blank and invalid coordinates; duplicate brand names; invalid group IDs; preservation of direct users, descriptions, GPS, geofence, code, and custom-field values; switching from inherited to custom settings; valid inheritance payloads; read-only previews; stale-preview rejection; edits occurring after initial preflight; per-record partial failures; readback mismatches; adding a brand to an existing parent; rejection of standalone-parent conversion; expired previews; malformed group responses; repeated-page/offset detection; upstream validation bodies/request IDs; single- and multi-select employee updates; required fields; missing dropdown settings; schedule-only permissions; and dropdown-option readback verification.

The production-route suite also confirms that legacy proxy writes return 405, unpreviewed actions return 400, stale replays return 409, and the real response error body survives to the UI.

### Browser workflows

1. Load an account and view the number of available smart groups.
2. Search a brand’s smart groups, select a checkbox, and add a second brand.
3. Preview exact door → brand → group relationships, then create and verify the nested structure.
4. Manage an existing door and select an already-assigned sub-job (not only a flagged record).
5. Preview an added group while keeping directly assigned users, then apply and verify.
6. Add a new brand to an existing parent, preview, apply, and verify.
7. Select an unassigned sub-job and inspect the inheritance warning/preview.
8. Preview an employee’s additional door value while keeping its existing value, then apply and verify.
9. Confirm an empty smart-group response disables creation.
10. Confirm a smart-group permission failure displays its error and request ID.
11. Confirm a failed repair displays the validation body and request ID without claiming success.
12. Add a new dropdown value and verify it appears in the refreshed list.
13. Disconnect/reconnect and confirm the primary door workflow opens.
14. Inspect layout at the in-app browser’s available width.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm run test:server
# In a second terminal, against the fresh test server:
node tests/routes.mjs
```

The test server intercepts Connecteam calls and accepts only fictional `test-*` keys. Normal `pnpm start` uses the real upstream service. Restart the test server between repeat route tests to reset its in-memory fixtures.

An additional Playwright browser script is included for use in unrestricted local/CI environments. Automated Chromium launch was blocked by macOS sandbox permissions here; that script is **not counted as an automated pass**. Equivalent core interactions were exercised through the in-app browser as listed above. No dedicated mobile-device or cross-browser certification is claimed.

## Remaining acceptance and limits

No real account credential was provided. No live Connecteam data was read or changed, and account-specific permissions, field values, and write behavior remain unverified. Before broad use, connect a test account or use one explicitly chosen test door, confirm the groups load, preview a small change, apply it, and inspect the verified result and Connecteam UI.

The API does not document transactional bulk repairs or conditional writes. The app compares fresh data before each write, but cannot eliminate the interval between read and write. Multi-record work stops on failure without rolling back previous successes. Unknown or saved-but-unverified outcomes require inspection before retrying. Hosting time limits also apply; use small batches initially.

**V1.2 remains unapproved. V1.3 is a locally validated replacement for controlled live-account acceptance, not a claim of full production-account validation.**
