# Vocivo Travel Data eSIM

## Provider decision

Use 1GLOBAL Connect as the primary integration candidate. Saily identifies 1GLOBAL as its network provider, and 1GLOBAL offers partner APIs for catalog, ordering, activation, eSIM delivery, balance, and top-up. Gigs is the fallback candidate when its commercial plan or target-country pricing is stronger.

## Commercial prerequisite

A real integration requires a signed reseller agreement, sandbox and production OAuth credentials, product catalogue access, wholesale pricing, supported-country terms, tax handling, refunds, customer support responsibilities, privacy review, and Apple/Google entitlement approval where native one-tap installation is used. None of these credentials should be stored in the mobile application.

## Vocivo implementation boundary

The Vercel control API should own provider authentication, catalogue normalization, idempotent orders, payments, entitlements, audit events, and webhook verification. The mobile app should only receive a normalized plan catalogue and the installation payload for an order owned by the signed-in user.

Required production endpoints:

- `GET /api/esim/plans?country=SA`
- `POST /api/esim/orders`
- `GET /api/esim/orders/:id`
- `POST /api/esim/orders/:id/topups`
- `POST /api/esim/webhook`

Do not expose an eSIM purchase button until sandbox ordering, payment reconciliation, duplicate-order protection, refunds, webhook replay protection, and installation on physical iOS and Android devices have passed.
