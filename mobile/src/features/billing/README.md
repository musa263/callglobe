# Mobile Wallet

`screens/WalletScreen` displays account credit and top-up choices; rate fallback
metadata is in `data/fallbackRates.ts` and is not a settlement ledger. Backend
billing decides authoritative balance and allowed spending. Do not charge internal
extension calls merely because the wallet view has an estimated rate. Validate
empty/unavailable account data and run mobile typecheck.
