# Connecteam Operations Manager — V1.3

A standalone Next.js application for creating and managing doors, brand sub-jobs, and assignments to existing Connecteam smart groups.

## Start locally

Use Node.js 22 or newer. From this folder:

```sh
npm install
npm test
npm run build
npm start
```

Open http://localhost:3000 and enter your Connecteam API key. Alternatively, use `pnpm install --frozen-lockfile` with the included lockfile, followed by `pnpm test`, `pnpm build`, and `pnpm start`.

The key stays in browser session storage until you disconnect or close the session. Server routes forward it to `https://api.connecteam.com` using `X-API-KEY`. The project contains no live credentials. Run locally or deploy on a trusted HTTPS host with access restricted to your operators. The app does not provide its own operator login.

## Main workflow

1. **Doors & brands → Create door setup.** Enter the door name, description, optional address/coordinates, and destination schedule/time clock.
2. Add brand sub-jobs and select their existing smart groups using searchable checkbox lists. A brand can instead inherit the parent’s groups.
3. **Preview complete setup.** The server validates current group IDs, target instances, names, coordinates, and duplicate doors. The preview names each door → brand → smart-group relationship.
4. **Create complete setup.** One nested API request creates the structure; the app reads it back to verify the settings.
5. **Manage brands** on any existing door lets you repair assignments or add a brand to a parent that already supports sub-jobs.

At least one brand is required for a new door because Connecteam does not allow converting a standalone job into a parent with sub-jobs later. A parent containing sub-jobs cannot be updated as one object; this app updates its sub-jobs individually. Parent renaming and arbitrary metadata editing are not included.

Assigning several smart groups does not implement a Door AND Brand eligibility engine. Select existing groups appropriate to the door/brand combination. This release does not create smart groups or schedule shifts.

## Safe repairs

Every sub-job is selectable in the door manager and Audit & Repair. “Needs review” is a warning, never a selection restriction.

- **Add groups** preserves existing groups and directly assigned users.
- **Replace groups** preserves directly assigned users.
- **Inherit parent settings** also changes the effective description and location. The preview explicitly warns about this broader operation.

Preview fetches each individual sub-job and its parent. Apply validates the complete preview again, then re-fetches each target before its write. A detected concurrent edit blocks the operation. When leaving inheritance, the app copies the current parent’s description/location/geofence and assignments, then applies the requested group change. Existing code and custom-field values are preserved.

Repairs are sequential and stop at the first failure. Results distinguish verified, failed, saved-but-unverified, unknown, and not-attempted outcomes. A successful write is followed by a fresh read. Download the results before continuing if attention is needed. The app never automatically retries writes.

## Employee assignments

This secondary tool edits a chosen employee dropdown field. It reads fresh values, previews replacements for single-select fields, and preserves other selections for multi-select fields. User writes run individually (within the API’s 25-user request limit), with readback verification. Up to 100 users or sub-jobs can be reviewed per operation.

## Validation and limits

See **VALIDATION.md** for the checks performed and **API-NOTES.md** for the official documentation reviewed.

The local production build and automated logic tests passed. Browser workflows were exercised against test-only Connecteam responses through the real production routes. **Live account access and writes have not been tested** because no account key was supplied. V1.2 remains unapproved; V1.3 is ready for controlled account acceptance testing, not a claim that every live account configuration is verified.

Connecteam does not document conditional writes or a multi-record transaction for these operations. A small race remains between the final read and the write, and earlier successful writes are not rolled back if a later write fails. A network interruption or hosting timeout may leave an unknown outcome. Refresh and inspect affected records before retrying. Start with a small selection; long operations are subject to your hosting provider’s request-duration limit.

## Optional browser regression suite

This uses fictional users and jobs, and intercepts all Connecteam traffic. It is never enabled by normal `npm start`.

```sh
npm run build
npx playwright install chromium
npm run test:server
# In another terminal:
npm run test:browser
```

The standalone browser suite requires permission to launch Chromium. In the Codex sandbox, Chromium launch was blocked by macOS; equivalent workflows were checked using the Codex in-app browser. The script is included for subsequent local/CI execution and is not counted as an automated pass here.

## Deployment

Deploy the project root to Vercel using its Next.js preset, or run the production server on a trusted host. Do not use `test:server` for deployment. Routes request a maximum duration of 300 seconds; actual limits depend on the host/plan. No API key environment variable is required. No deletion operation is exposed, and the legacy proxy route is read-only.
