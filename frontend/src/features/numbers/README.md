# Web Numbers

`CallerIdMenu` selects an assigned caller ID. `VerifiedNumbersPanel` manages
verification actions. `RatesView` displays destination rates; `countries.js`
provides country metadata used by the dialer. These components cannot authorize
a number themselves; backend number routes enforce organization ownership.

Validate external versus extension mode, an empty number list, and long country
labels at mobile widths. Run frontend tests and build after changes.

Company administration is BYOC-first: `admin/numbers/NumbersPage` shows the
carrier form and previous company numbers, with an accessible removal modal.
`CarrierTrunksPanel` publishes the inventory and edits individual destinations.
Every saved DID is visible even when unassigned or pending activation. Password
fields are write-only; details show whether one is stored. Test with
`node scripts/test-carrier-admin.mjs` using the Playwright module and Vite on 5191.
