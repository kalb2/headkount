# V1.4 validation report

**Date:** 29 September 2026  
**Status:** Local validation passed for the smart-group create-and-assign path. Live Connecteam account acceptance remains outstanding.

## Completed checks

- Automated logic suite: **35 passed, 0 failed** using Node’s test runner. The new cases cover named groups with empty dropdown filters, `fieldId` filters on an existing segment, shared new segments, preview-time rejection of duplicate names, invalid segments, invalid options, and `customFieldId`, a `409` name conflict with its request ID, keeping a created group when the job write fails, refusing to assign an unverified group id, and preserving direct users, code, and custom fields on repair.
- Production build: **PASS**, Next.js 15.5.24.
- Production-route checks: **PASS** against the compiled server with test-only upstream responses, including create-and-assign and a repeated-name `409`.
- Browser checks: **PASS** via `tests/browser-smoke.mjs` on that server. The script still covers the V1.3 door, repair, employee, empty-group, and error flows, and now creates a segment plus a filtered smart group from the brand group list, previews it, applies it, and checks the verified result and request ID. The empty-group screen still says the account returned no smart groups and leaves preview disabled until a group is selected or created.

### Logic and API routes

Checked nested creation; blank and invalid coordinates; duplicate brand names; invalid group IDs; preservation of direct users, descriptions, GPS, geofence, code, and custom-field values; switching from inherited to custom settings; valid inheritance payloads; read-only previews; stale-preview rejection; edits occurring after initial preflight; per-record partial failures; readback mismatches; adding a brand to an existing parent; rejection of standalone-parent conversion; expired previews; malformed group responses; repeated-page/offset detection; upstream validation bodies/request IDs; single- and multi-select employee updates; required fields; missing dropdown settings; schedule-only permissions; dropdown-option readback verification; and smart-group/segment create-and-assign, including filter contracts and failed-write outcomes.

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
9. Confirm an empty smart-group response disables preview, then create a segment and a filtered smart group from the brand list, preview, apply, and verify.
10. Confirm a smart-group permission failure displays its error and request ID.
11. Confirm a failed repair displays the validation body and request ID without claiming success.
12. Add a new dropdown value and verify it appears in the refreshed list.
13. Disconnect/reconnect and confirm the primary door workflow opens.
14. Inspect layout at a 390px-wide viewport.

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

`tests/browser-smoke.mjs` passed against the test server with Playwright Chromium. It uses fictional data and intercepts Connecteam. No dedicated mobile-device or cross-browser certification is claimed.

```sh
npx playwright install chromium
pnpm run test:server
# In another terminal:
pnpm run test:browser
```

## Remaining acceptance and limits

No real account credential was provided. No live Connecteam data was read or changed, and account-specific permissions, field values, and write behavior remain unverified. Before broad use, connect a test account or use one explicitly chosen test door, confirm the groups load, preview a small change, apply it, and inspect the verified result and Connecteam UI.

The API does not document transactional bulk repairs or conditional writes. The app compares fresh data before each write, but cannot eliminate the interval between read and write. Multi-record work stops on failure without rolling back previous successes. Unknown or saved-but-unverified outcomes require inspection before retrying. Hosting time limits also apply; use small batches initially.

**V1.4 adds smart-group creation to the existing preview and apply path. It is a locally validated build for controlled live-account acceptance, not a claim of full production-account validation.**
