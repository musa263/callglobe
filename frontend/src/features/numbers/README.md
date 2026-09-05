# Web Numbers

`CallerIdMenu` selects an assigned caller ID. `VerifiedNumbersPanel` manages
verification actions. `RatesView` displays destination rates; `countries.js`
provides country metadata used by the dialer. These components cannot authorize
a number themselves; backend number routes enforce organization ownership.

Validate external versus extension mode, an empty number list, and long country
labels at mobile widths. Run frontend tests and build after changes.
