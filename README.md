# Connecteam Operations Manager — V1.5

A standalone Next.js application for creating and managing doors, brand sub-jobs, and assignments to Connecteam smart groups. A new job can batch one eligibility group per brand. Operators can still select an existing smart group or create a single one in the same preview and apply.

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
2. Add brand sub-jobs and select smart groups using searchable checkbox lists. A brand can instead inherit the parent’s groups. Use **Create smart group** on any group list to add a named group without leaving the form.
3. **Preview complete setup.** The server validates current group IDs, new group and segment names, dropdown filters, target instances, names, coordinates, and duplicate doors. The preview names each door → brand → smart-group relationship and lists groups that will be created.
4. **Create complete setup.** New segments and smart groups are created and read back first. The nested job request then assigns the new group IDs together with any existing groups. The app reads the job back to verify the settings.
5. **Manage brands** on any existing door lets you repair assignments or add a brand to a parent that already supports sub-jobs. Those group lists can create a smart group in the same preview.

At least one brand is required for a new door because Connecteam does not allow converting a standalone job into a parent with sub-jobs later. A parent containing sub-jobs cannot be updated as one object; this app updates its sub-jobs individually. Parent renaming and arbitrary metadata editing are not included.

## Job and brand eligibility

On **Create door setup**, choose a multi-select job dropdown and a different multi-select brand dropdown. Preview creates a job tag when needed, one smart group for the job, and one smart group for every brand. Each brand group uses Connecteam’s `filters.operator: "and"` with the job tag and that brand’s tag. Connecteam then keeps a person on the brand only while both tags match.

People already in any checked job group, or already holding any checked job tag, qualify for the job. They qualify for a brand when they already hold that brand’s tag. The intersection is tagged during apply, so one person can land on several brands and several jobs. The manual **Create smart group** control is still there for a single group. Extra groups selected by hand are alternatives on that sub-job, not a second AND.

This release does not schedule shifts and does not delete smart groups.

## Creating a smart group

On a door, brand, or repair group list, open **Create smart group**. Enter a unique name, pick an existing segment or enter a new segment name and color, and optionally add dropdown-field filters. Add the group to the list and leave it checked, alongside any existing groups. Preview, then apply.

The apply creates the segment (if needed) and the smart group, reads them back, and only then writes the door or brand assignment with the new group ID. The new group is added to the picker immediately, including when you refresh. A name conflict, invalid segment, or invalid dropdown option fails in preview, or on apply with the Connecteam request ID, before the job write. If the group is created and a later job write fails, the group is kept; select it as an existing group to retry. Membership filters are sent as `filters.dropdownFilters[].fieldId`. An empty filter list still creates the named group. The group read model does not return filters, so readback confirms the id, name, and segment.

An empty smart-group list is a normal account state: the app shows **Create smart group** and does not call the list unavailable. A permission or API-key failure is the case that blocks creation, and that message includes the Connecteam request ID.

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

The local production build and automated logic tests passed. **Live account access and writes have not been tested** because no account key was supplied. V1.5 is ready for controlled account acceptance testing, not a claim that every live account configuration is verified.

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
