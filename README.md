# Connecteam Operations Manager — V1.6

A standalone Next.js app for creating Connecteam Jobs and Sub-jobs, building the required Smart Groups, and assigning employee eligibility in one guided workflow.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fkalb2%2Fheadkount)

## What it does

The primary workflow is a four-step wizard:

1. **Job** — enter the Job details, address/coordinates, Job Schedulers, and Time Clocks.
2. **Sub-jobs** — choose the brand/sub-job options for that Job.
3. **Employees** — choose who can work the Job. Existing Brand eligibility determines which Sub-jobs each person qualifies for.
4. **Review** — review the Job, Sub-jobs, Smart Groups, User Detail changes, employee assignments, and qualification structure before creating anything.

Headkount creates or reuses the required Smart Groups and verifies the resulting Connecteam records after writes.

Each brand Smart Group uses Connecteam’s `filters.operator: "and"` with the Job dropdown tag and that brand’s tag. A person lands on a Sub-job only when both values are on their user record, so one employee can match several brands under the same Job and several Jobs at once.

When you add or repair a Sub-job later, you can still pick an existing Smart Group or use **Create smart group** in the same preview and apply. New groups are merged into the picker after a successful apply. An empty Smart Group list is a normal account state, not an error; only a 401/403 access failure blocks creation.

This release does not schedule shifts and does not delete Smart Groups.

## Customize labels for each client

Use the **Labels** button in the app to change the client-facing terminology without changing Connecteam data or automation logic.

The defaults are:

- Job / Jobs
- Sub-job / Sub-jobs
- Brand / Brands
- Employee / Employees

For example, one client can use **Location / Locations**, **Department / Departments**, or **Team Member / Team Members** while the underlying Connecteam API behavior remains unchanged.

Label preferences are stored in that browser using local storage. Resetting the browser/site storage restores the defaults.

Smart Group names are **not** rewritten by these UI labels. Generated Smart Group names continue to use the actual selected Connecteam User Detail names so the preview matches what is created in Connecteam.

## Deploy your own copy

Click **Deploy with Vercel** at the top of this README. Vercel will clone the repository into the GitHub account you choose and create a separate deployment owned by that client/account.

No Connecteam API key environment variable is required. The operator enters the API key in the app, and the key remains in browser session storage until they disconnect or close the session.

For production use, deploy only to a trusted HTTPS host and restrict access to the people who should be able to make changes in Connecteam. This app does not provide its own operator authentication layer.

## Run locally

Use Node.js 20 or newer:

```sh
npm install
npm test
npm run build
npm start
```

Then open `http://localhost:3000` and enter a Connecteam API key.

## Safety and validation

Preview reads current Connecteam data before a write. Apply revalidates the preview, performs the requested changes, and reads records back to verify the saved result.

See **VALIDATION.md** for validation behavior and **API-NOTES.md** for Connecteam API notes.

The local production build and automated logic tests exercise the merged workflow. **Live account access and writes have not been verified** against a real Connecteam account in this merge. Start with a small selection; Connecteam membership can lag after User Detail writes, and one eligibility tagging pass updates at most 100 people.

Connecteam does not document conditional writes or a multi-record transaction for these operations. A small race remains between the final read and the write, and earlier successful writes are not rolled back if a later write fails. A network interruption or hosting timeout may leave an unknown outcome. Refresh and inspect affected records before retrying.

Routes request a maximum duration of 300 seconds; the actual execution limit depends on the Vercel plan or other hosting provider.

## Optional browser regression suite

This uses fictional users and jobs, and intercepts all Connecteam traffic. It is never enabled by normal `npm start`.

```sh
npm run build
npx playwright install chromium
npm run test:server
# In another terminal:
npm run test:browser
```
