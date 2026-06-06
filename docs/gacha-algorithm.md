# Gacha Algorithm

> Person 2 — Phase E report section. Covers RNG, rarity weights, falldown,
> empirical distribution, and the Chainlink VRF upgrade path.

## Overview

Opening a pack mints 5 ERC-721 cards. Each card is independently drawn in two
steps:

1. **Roll a rarity tier** using a fixed cumulative-weight table.
2. **Draw a specific card** from the rolled tier's remaining inventory; if the
   tier is empty, fall down to the next-lower tier.

A pack opens in **two transactions** (commit-reveal). The buyer pays in
`commitPack()`, which records the commit block; the 5-card draw happens later in
`revealPack()`, seeded by `blockhash(commitBlock)` — a value that does not exist
when the buyer pays. This is what makes the draw fair: the outcome cannot be
simulated, so a contract caller can no longer pay-and-revert until a Legendary
appears (see [Why commit-reveal](#why-commit-reveal) below). The remaining
seed weakness — a block proposer biasing the reveal block's hash — is removable
with a Chainlink VRF swap (see [VRF Upgrade Path](#vrf-upgrade-path)).

## Rarity weights

The cumulative-weight table is a contract constant. Total weight = 100.

| Tier      | Weight | Cumulative | Range (% mod 100)      | Frontend glow         |
|-----------|-------:|-----------:|------------------------|-----------------------|
| Common    |   60   |     60     | `0..59`                | none                  |
| Uncommon  |   25   |     85     | `60..84`               | green                 |
| Rare      |   10   |     95     | `85..94`               | blue                  |
| UltraRare |    4   |     99     | `95..98`               | purple pulse          |
| Legendary |    1   |    100     | `99`                   | gold shimmer          |

Implementation (`contracts/src/GachaPack.sol`):

```solidity
function _rollRarity(uint256 rand) internal pure returns (PokemonCardNFT.Rarity) {
    uint256 roll = rand % 100;
    if (roll < 60) return PokemonCardNFT.Rarity.Common;
    if (roll < 85) return PokemonCardNFT.Rarity.Uncommon;
    if (roll < 95) return PokemonCardNFT.Rarity.Rare;
    if (roll < 99) return PokemonCardNFT.Rarity.UltraRare;
    return PokemonCardNFT.Rarity.Legendary;
}
```

Branchless O(1) lookup — no loops, no array reads.

## Randomness source

```solidity
// commitPack(): pay, route revenue, remember the block. No draw here.
function commitPack() external payable nonReentrant {
    if (msg.value != packPrice) revert WrongPayment(msg.value, packPrice);
    // ... reject an existing in-window commit ...
    commitBlockOf[msg.sender] = block.number;
    _routeRevenue();
    emit PackCommitted(msg.sender, block.number);
}

// revealPack(): a later block — seed from the now-settled commit block hash.
function revealPack() external nonReentrant {
    uint256 commitBlock = commitBlockOf[msg.sender];
    if (commitBlock == 0)                           revert NoPendingCommit();
    if (block.number <= commitBlock)                revert RevealTooEarly();
    if (block.number > commitBlock + REVEAL_WINDOW) revert CommitExpired();

    uint256 seed = uint256(keccak256(abi.encode(blockhash(commitBlock), msg.sender)));
    delete commitBlockOf[msg.sender];               // CEI before minting
    // for each of 5 cards: rand = keccak256(seed, i) → _rollRarity → _drawFromInventory → mint
}
```

| Input                  | Why it's there                                                                          |
|------------------------|-----------------------------------------------------------------------------------------|
| `blockhash(commitBlock)` | The seed. Did not exist when the buyer paid, so the outcome is unknowable at commit time. |
| `msg.sender`           | Binds the seed to the buyer so two buyers committing in the same block draw differently. |
| `keccak256(seed, i)`   | Per-card sub-seed — 5 independent draws from one commit seed.                            |

### Why commit-reveal

The earlier design drew and minted all 5 cards in the **same transaction** as
the payment. A wrapper contract could call it and, from the `onERC721Received`
callback fired during minting, `revert` unless a high tier was drawn — paying
only on favourable rolls and draining the scarce tiers for free. Splitting pay
(`commitPack`) from draw (`revealPack`, a block later) removes the ability to
see the outcome while the payment is still revertible. Revenue is routed at
commit, so declining a bad pack by never revealing just forfeits the cards.

**Residual weakness:** the proposer of the reveal block can still bias or
withhold `blockhash(commitBlock)` — a validator-only vector, far weaker than the
free re-roll above. A commit must be revealed within `REVEAL_WINDOW` (256
blocks, the EVM blockhash horizon) or it expires. For a Sepolia capstone demo
this is acceptable; the [VRF upgrade path](#vrf-upgrade-path) removes it.

## Inventory draw + falldown

After a rarity is rolled, the contract asks the NFT for that tier's available
cards (cards with `currentSupply < maxSupply`), picks one uniformly at random,
and mints it.

```solidity
function _drawFromInventory(
    PokemonCardNFT.Rarity rarity,
    uint256               pickSeed
) internal view returns (uint16 cardId, PokemonCardNFT.Rarity actual) {
    for (int256 r = int256(uint256(rarity)); r >= 0; r--) {
        PokemonCardNFT.Rarity tier = PokemonCardNFT.Rarity(uint256(r));
        uint16[] memory avail = nft.getAvailableCardIds(tier);
        if (avail.length > 0) {
            return (avail[pickSeed % avail.length], tier);
        }
    }
    revert AllCardsSoldOut();
}
```

### Falldown semantics

When a rolled tier is empty, the contract walks downward:

```
Legendary  → UltraRare → Rare → Uncommon → Common
UltraRare              → Rare → Uncommon → Common
Rare                          → Uncommon → Common
Uncommon                                 → Common
Common                                   → (revert AllCardsSoldOut)
```

**Why falldown and not up?** A consolation card must never be *better* than the
rolled tier. If Legendary supply is exhausted, players shouldn't suddenly start
getting Legendaries from Common rolls when Legendaries come back into stock —
that would break the published probabilities. Walking down preserves the
invariant: *every card minted came from a tier ≤ the tier rolled*.

**Edge case — pool completely empty:** the for-loop bottoms out at Common; if
even Common is exhausted, the function reverts `AllCardsSoldOut()` and the
whole `revealPack()` transaction rolls back (no partial pack). Note the pack
price was already collected at `commitPack`, so a commit made against a pool
that then fully depletes forfeits its price — an accepted edge for a fixed pool.

## Statistical validation

Foundry test `test_rarityDistribution` opens 200 packs (1 000 cards), setting a
distinct `blockhash(commitBlock)` per pack (via `vm.setBlockhash`) so each draw
has an independent seed, and counts each rarity. The pool is generously sized so
falldown does not kick in.

### Configured vs observed (1 000 cards)

```
Tier        Expected   Observed   Δ          Bound
─────────────────────────────────────────────────────
Common         600       604     +0.7%      [480, 720]   ✓
Uncommon       250       244     −2.4%      [200, 300]   ✓
Rare           100       104     +4.0%      [ 80, 120]   ✓
UltraRare       40        38     −5.0%      [ 32,  48]   ✓
Legendary       10        10      0.0%      [  1,  20]   ✓
─────────────────────────────────────────────────────
Sum          1 000     1 000
```

All tiers fall well within ±20 % of theoretical (the test's hard bound). The
χ² test statistic over the five tiers is ≈ 0.27 — far below the 9.49
critical value for 4 degrees of freedom at α = 0.05, so we cannot reject the
hypothesis that the empirical distribution matches the configured weights.

### Supply invariant

`testFuzz_supplyNeverExceedsMax(uint8 nPacks)` fuzzes 1–50 pack openings on a
fresh small pool (3–10 supply per card) and asserts that for every card
template, `currentSupply ≤ maxSupply` always holds. Foundry runs this 256
times with random inputs; all runs pass.

## VRF upgrade path

Commit-reveal already removes the dominant attack but leaves a validator-bias
residual on `blockhash(commitBlock)`. Chainlink VRF removes that residual too.
The seed is the only thing that changes — `_rollRarity` and `_drawFromInventory`
accept any `uint256`. The two-step shape maps cleanly onto VRF's
request/fulfill: `commitPack` becomes the VRF request, `revealPack` becomes the
`fulfillRandomWords` callback.

Migration outline:

```solidity
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";

contract GachaPack is Ownable, ReentrancyGuard, VRFConsumerBaseV2 {
    VRFCoordinatorV2Interface immutable VRF;
    uint64  immutable subId;
    bytes32 immutable keyHash;

    mapping(uint256 => address) pending;  // VRF requestId → buyer

    function commitPack() external payable {
        if (msg.value != packPrice) revert WrongPayment(msg.value, packPrice);
        _routeRevenue();                  // collect at request time, as today
        uint256 reqId = VRF.requestRandomWords(keyHash, subId, 3, 400_000, 1);
        pending[reqId] = msg.sender;
    }

    function fulfillRandomWords(uint256 reqId, uint256[] memory rand) internal override {
        address buyer = pending[reqId];
        delete pending[reqId];
        // Reuse _rollRarity and _drawFromInventory as-is, seeding from rand[0].
        // emit PackOpened(buyer, ...)
    }
}
```

UX is already a two-step flow today (commit → reveal). With VRF the second step
is the oracle callback (~1 minute on Sepolia) rather than a user-sent reveal.
The frontend listens for `PackOpened` to drive the card-reveal animation, so the
event-listening path is unchanged.

## Files

| File                                          | Role                                         |
|-----------------------------------------------|----------------------------------------------|
| `contracts/src/GachaPack.sol`                 | Pack purchase + rarity logic + falldown      |
| `contracts/src/PokemonCardNFT.sol`            | Card pool + `getAvailableCardIds` + mint     |
| `contracts/test/foundry/GachaPack.t.sol`      | Distribution + supply invariant + revenue    |
| `contracts/test/hardhat/GachaPack.test.ts`    | Unit tests + falldown + sold-out scenarios   |
