# `PaymentSplitter.sol`

Pull-payment vault. Approved depositors credit per-address balances;
recipients claim individually. The single ETH-distribution primitive used by
both `GachaPack` (pack revenue) and `Marketplace` (sale proceeds + royalties).

- **Inherits:** `ReentrancyGuard`, `AccessControl` (OpenZeppelin v5)
- **Solidity:** `0.8.24`
- **Lines:** 104

---

## 1. Purpose & scope

- Eliminate push-style ETH distribution from the system. Neither GachaPack
  nor Marketplace ever loops over recipients sending ETH — they call
  `deposit(receivers, amounts)` once per transaction, and recipients pull
  individually.
- Provide a single source of truth for "what ETH does the protocol owe and
  to whom".
- Defend against reentrancy and out-of-gas failures in the recipient set: a
  hostile or expensive contract among the recipients can only hurt itself
  (`claim` sends to `msg.sender` only).

**Not responsible for:** computing splits (callers do that), holding card or
listing state, or pushing ETH anywhere automatically.

---

## 2. State

### 2.1 Roles

| Slot              | Type     | Notes |
|-------------------|----------|-------|
| `DEPOSITOR_ROLE`  | `bytes32 constant` | `keccak256("DEPOSITOR_ROLE")` — granted to GachaPack + Marketplace |
| `DEFAULT_ADMIN_ROLE` | inherited | Set in constructor; can grant/revoke |

### 2.2 Storage

| Slot       | Type                          | Notes |
|------------|-------------------------------|-------|
| `balances` | `mapping(address => uint256)` public | Claimable ETH per address |

---

## 3. External / public API

### `deposit(address[] receivers, uint256[] amounts) payable` — `onlyRole(DEPOSITOR_ROLE)`

Credit `amounts[i]` to `receivers[i]`. Strictly enforces:

```
receivers.length > 0                          → EmptyReceivers
receivers.length == amounts.length            → ArrayLengthMismatch
Σ amounts == msg.value                        → ValueMismatch
```

After validation: `balances[receivers[i]] += amounts[i]` for each `i`. Emits
`Deposited(msg.sender, receivers, amounts)`.

**No reentrancy guard** — the function makes no external calls. The only
state mutation is to `balances`. Adding a guard would cost gas with zero
benefit.

**No zero-address check** — see [audit L-01](../audit.md). Currently both
callers source receivers from configured state, so the path is not
adversarially reachable, but defence-in-depth is recommended.

**Same recipient twice in the same call:** balances correctly accumulate
(the `+=` runs twice). Useful and documented behaviour.

### `claim() nonReentrant`

Withdraw the caller's entire credited balance.

```
1. CHECK  amount = balances[msg.sender]; revert NothingToClaim if zero
2. EFFECT balances[msg.sender] = 0                     ← CEI
3. INTER  (bool ok,) = msg.sender.call{value: amount}("")
4. CHECK  revert TransferFailed if !ok
5. Emit Claimed(msg.sender, amount)
```

**Two-layer safety:** CEI + `nonReentrant`. A reentrant `claim()` call hits
the guard, but even without it the zeroed balance would make the nested
call revert at the `NothingToClaim` check.

**Gas forwarded:** all (`.call{value:}("")`). A pathological recipient that
burns all gas in `receive()` can only DoS *its own* claim, since `claim`
sends to `msg.sender` only.

### `claimable(address recipient) view → uint256`

Trivial wrapper around `balances`. Provided so the frontend can read without
needing the storage-layout knowledge.

### `supportsInterface(bytes4)` view → `bool`

Standard AccessControl interface ID detection.

---

## 4. Events

| Event | Indexed | Notes |
|---|---|---|
| `Deposited(depositor, receivers, amounts)` | `depositor` | Frontend / indexer uses this to compute pending balances |
| `Claimed(recipient, amount)` | `recipient` | Drives the "claim succeeded" UI toast |

---

## 5. Errors

| Error | Trigger |
|---|---|
| `ArrayLengthMismatch()` | `receivers.length != amounts.length` |
| `ValueMismatch(uint256 sent, uint256 required)` | `Σ amounts != msg.value` |
| `NothingToClaim()` | `balances[msg.sender] == 0` |
| `TransferFailed()` | low-level `call` to recipient returned `false` |
| `EmptyReceivers()` | `receivers.length == 0` |

---

## 6. Invariants & threat model

| Invariant | Enforced by |
|---|---|
| `address(splitter).balance == Σ balances[*]` (modulo forced ETH — see L-06) | Every `deposit` requires `Σ amounts == msg.value`; `claim` sends exactly `balances[msg.sender]` and zeros it. **Verified by Foundry invariant `invariant_balanceSumEqualsContractBalance` over 256 × 15 random handler calls.** |
| `balances[address(this)]` is meaningless (the contract is never a recipient) | By convention; not enforced — admin trusted not to grant `DEPOSITOR_ROLE` to a contract that would credit itself |
| Recipients can only claim their own balance | `claim` reads `balances[msg.sender]`; `msg.sender` cannot be forged |
| `deposit` cannot inflate the credited total beyond `msg.value` | `ValueMismatch` check |
| Reentrant `claim` cannot drain more than the caller's balance | CEI (`balance = 0` before call) + `nonReentrant` |

**Trusts:**
- `DEPOSITOR_ROLE` holders to pass honest `(receivers, amounts)` tuples
  summing to `msg.value`. Both production depositors do; the splitter's own
  `ValueMismatch` check is the backstop against accounting drift.
- Admin to grant `DEPOSITOR_ROLE` only to vetted contracts.

**Does not trust:** recipients' `receive()` callbacks — `claim` is
self-only and CEI-ordered.

---

## 7. Gas profile

| Operation                          | Gas    |
|------------------------------------|--------|
| `deposit` (1 receiver)             | ~38 k  |
| `deposit` (6 receivers)            | ~80 k  |
| `claim` (warm)                     | ~21 k  |
| `claim` (cold)                     | ~30 k  |

The deposit cost is linear in receiver count. With at most 6 recipients per
Marketplace sale and 2 per pack open, the worst case is ~80 k.

---

## 8. Known limitations

- **L-01**: no `address(0)` rejection in `deposit`. A misconfigured caller
  could credit ETH to the zero address permanently.
- **L-02**: constructor does not zero-check `admin`. With `admin == 0`, no
  role can ever be granted.
- **L-06**: no admin sweep for forced ETH (SELFDESTRUCT / coinbase). Small
  wei amounts can drift unaccounted-for.

See [`docs/audit.md`](../audit.md) for full discussion.
