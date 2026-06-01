# Smart-Contract Reference Documentation

Per-contract technical reference for the four production contracts in this
project. Each document is meant to be read alongside the source and gives an
auditor or integrator everything they need without re-deriving from code.

| Contract | Lines | Doc |
|----------|------:|-----|
| `PokemonCardNFT` — ERC-721 + EIP-2981 + on-chain card pool          | 343 | [PokemonCardNFT.md](./PokemonCardNFT.md) |
| `GachaPack` — pay-to-open weighted-RNG pack of 5 cards              | 198 | [GachaPack.md](./GachaPack.md) |
| `Marketplace` — atomic NFT-for-ETH swap with royalty distribution   | 215 | [Marketplace.md](./Marketplace.md) |
| `PaymentSplitter` — pull-payment vault for all ETH distribution     | 104 | [PaymentSplitter.md](./PaymentSplitter.md) |

## How to read these docs

Each contract reference contains:

1. **Purpose & scope** — what the contract is and is *not* responsible for.
2. **State** — every storage slot, its type, and what it means.
3. **External / public API** — every entry point with auth gate and gas notes.
4. **Internal helpers worth understanding** — RNG, fallback logic, etc.
5. **Events** — emitted by which entry point, why.
6. **Errors** — full catalogue with trigger condition.
7. **Invariants & threat model** — what the contract guarantees and what it
   trusts.
8. **Gas profile** — costs of the headline operations.
9. **Known limitations** — cross-references into [`docs/audit.md`](../audit.md).

## Companion documents

- [`docs/audit.md`](../audit.md) — security audit with severity-classified
  findings, remediations, and conservation proofs.
- [`docs/architecture.md`](../architecture.md) — sale-flow diagrams, royalty
  math walkthrough, gas report, setup guide.
