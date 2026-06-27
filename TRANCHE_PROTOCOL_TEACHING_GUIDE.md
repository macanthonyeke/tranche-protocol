# Tranche Protocol Teaching Guide

Generated from the files in `src/`:

- `src/TrancheProtocol.sol`
- `src/interface/ITrancheProtocol.sol`
- `src/interface/ITokenMessenger.sol`

This guide does not modify protocol code. It is a study document for understanding, explaining, and rebuilding the protocol.

## 1. Protocol Map

### Contracts And Interfaces

| File | Item | Purpose |
| --- | --- | --- |
| `src/TrancheProtocol.sol` | `TrancheProtocol` | Main escrow protocol. It accepts USDC deposits, splits work into milestones, supports review windows, disputes, refunds, recipient releases, protocol fees, CCTP burns, recipient address updates, and frontend view helpers. |
| `src/interface/ITrancheProtocol.sol` | `ITrancheProtocol` | Shared type, event, and error interface for the protocol. It defines escrow states, milestone states, structs, events, and custom errors used by `TrancheProtocol`. |
| `src/interface/ITokenMessenger.sol` | `ITokenMessenger` | Minimal Circle CCTP V2 TokenMessenger interface. The protocol uses it to burn USDC on Arc and mint/forward USDC to destination domains. |

There are no custom libraries in `src/`. The implementation uses OpenZeppelin libraries and contracts:

- `AccessControl`: role-based permissions.
- `Pausable`: emergency pause for new deposits.
- `ReentrancyGuard`: protection for state-changing functions that move money or credit.
- `IERC20`: standard ERC-20 interface for USDC.
- `SafeERC20`: safer ERC-20 transfer wrappers.

### Inheritance

`TrancheProtocol` inherits:

```text
ITrancheProtocol
AccessControl
Pausable
ReentrancyGuard
```

The interface supplies protocol-specific types/events/errors. `AccessControl` supplies `onlyRole`, `DEFAULT_ADMIN_ROLE`, role grants, and `hasRole`. `Pausable` supplies `_pause`, `_unpause`, `paused`, and `whenNotPaused`. `ReentrancyGuard` supplies `nonReentrant`.

### External Integrations

The protocol integrates with:

- USDC: the escrow asset. Depositors transfer USDC into the contract; refunds and fees are paid in USDC.
- Circle CCTP V2 TokenMessenger: used through `depositForBurnWithHook`.
- Circle Forwarding Service: triggered by the `FORWARD_HOOK_DATA` value, allowing destination-chain mint execution to be relayed automatically.
- OpenZeppelin security/access-control modules.

### Dependency Map

```text
User / Depositor
  -> TrancheProtocol.deposit
  -> USDC.safeTransferFrom

Recipient
  -> claimDelivery
  -> updateReceivingAddress / updateSplitReceivingAddress

Depositor
  -> approveRelease
  -> raiseDispute
  -> refund/cancel/recovery flows

Arbiter
  -> resolveDispute

TrancheProtocol
  -> USDC.safeTransfer / approve raw call
  -> TokenMessenger.depositForBurnWithHook

Frontend / Indexer
  -> events
  -> getEscrowDetail / getProtocolConfig
```

### Contract Interaction Map

```text
deposit
  -> stores Escrow
  -> stores Milestone records
  -> stores optional SplitRecipient records
  -> snapshots fee bps, treasury, and CCTP forward fee
  -> pulls USDC from depositor

claimDelivery
  -> moves milestone PENDING -> IN_REVIEW
  -> starts review timer

approveRelease or release
  -> moves milestone IN_REVIEW -> RELEASED
  -> charges protocol fee
  -> burns net USDC through CCTP, either to one recipient or split recipients

raiseDispute
  -> moves milestone IN_REVIEW -> DISPUTED
  -> stores depositor evidence

resolveDispute / mutualSettle / resolveDisputeByTimeout
  -> divides milestone between recipient share and refund share
  -> pays fee on recipient share only
  -> sends recipient share by CCTP or refund credit, depending on path
  -> credits depositor refund share internally

refundAfterDeadline / mutualCancel / proposeMilestoneCancel
  -> moves unreleased funds to refund credit

withdrawRefund
  -> converts internal refund credit into actual USDC transfer
```

## 2. Architecture Overview

Tranche Protocol is a milestone escrow for USDC. A depositor locks a total amount into one escrow. That total is broken into ordered milestones. A recipient claims delivery for a milestone, which starts a review window. The depositor can approve, dispute, or do nothing. If the depositor does nothing until the review window expires, anyone can release the milestone.

The protocol is optimistic: once delivery is claimed, silence eventually becomes approval. This prevents a depositor from locking a recipient's completed work forever by disappearing. At the same time, the depositor can raise a dispute during the review window.

Money has two major destinations:

- Recipient release: the protocol charges a fee, then burns USDC through CCTP so the recipient receives USDC on the configured destination domain.
- Refund credit: the protocol records an internal balance for a refund owner. That owner later withdraws USDC on Arc.

The protocol supports optional split payouts. If splits exist, the recipient-side payout is divided by basis points among multiple `SplitRecipient` entries. Each split can have its own CCTP destination domain and mint recipient.

## 3. Core Lifecycle

### Happy Path

```text
Depositor calls deposit
  -> USDC moves into contract
  -> escrow becomes ACTIVE
  -> milestones start as PENDING

Recipient completes milestone 0
  -> calls claimDelivery
  -> milestone becomes IN_REVIEW

Depositor approves
  -> calls approveRelease
  -> milestone becomes RELEASED
  -> protocol fee goes to treasury
  -> remaining USDC burns through CCTP to recipient or split recipients

Repeat for next milestones
  -> when all milestones are RELEASED or REFUNDED
  -> escrow becomes COMPLETED
```

### Silent Approval Path

```text
Recipient calls claimDelivery
  -> milestone IN_REVIEW

Review window expires
  -> anyone calls release
  -> protocol uses escrow's snapshotted CCTP forward fee
  -> milestone RELEASED
  -> net funds sent through CCTP
```

### Dispute Path

```text
Recipient calls claimDelivery
Depositor calls raiseDispute during review window
  -> milestone DISPUTED
  -> dispute evidence stored

Possible endings:
  -> arbiter resolves with recipient bps
  -> both parties propose same mutual settlement bps
  -> arbiter is inactive for 14 days and anyone triggers 50/50 timeout settlement
```

### Refund Path

```text
Recipient never claims before deadline
  -> anyone calls refundAfterDeadline
  -> milestone REFUNDED
  -> amount credited to refundTo
  -> refund owner calls withdrawRefund
```

## 4. Roles And Governance

| Role | Who receives it in constructor | Powers |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | deployer | OpenZeppelin admin role. Can manage roles using inherited AccessControl functions. |
| `ARBITER_ROLE` | `_arbiter` | Can call `resolveDispute`. |
| `PAUSER_ROLE` | `_pauser` | Can pause and unpause. Pause blocks new deposits only, not release/refund paths. |
| `DOMAIN_MANAGER_ROLE` | `_domainManager` | Can add/remove supported CCTP destination domains. |
| `FEE_MANAGER_ROLE` | deployer | Can update protocol fee, treasury, and CCTP forward fee. |
| `RECOVERY_MANAGER_ROLE` | deployer | Can propose refund-credit recovery for locked/blacklisted wallets. |

Important design choice: removing a supported domain blocks new deposits and redirects, but does not block releases of already-created escrows. This avoids letting a domain manager strand funds after deposit.

## 5. Storage And Types

### Constants

| Name | Meaning | Why it exists |
| --- | --- | --- |
| `BPS_DENOMINATOR = 10_000` | 100% in basis points. | Fee and split math. |
| `MAX_PROTOCOL_FEE = 500` | 5%. | Prevents excessive fee manager changes. |
| `MAX_MILESTONES = 20` | Maximum milestones per escrow. | Prevents unbounded loops from gas-bricking settlement. |
| `MAX_SPLITS = 10` | Maximum split recipients. | Prevents unbounded split loops. |
| `MAX_CCTP_FORWARD_FEE = 100e6` | 100 USDC with 6 decimals. | Bounds forwarding fee configuration. |
| `FORWARD_HOOK_DATA` | Circle forwarding hook tag. | Tells Circle's forwarding service to auto-deliver. |
| `CCTP_MIN_FINALITY_THRESHOLD = 2000` | Standard/finalized CCTP transfer. | Avoids fast-transfer semantics. |
| `ARC_DOMAIN = 26` | Arc CCTP domain. | Same-chain transfers are treated as no-forwarding-fee. |
| `MIN_REVIEW_WINDOW = 1 days` | Shortest review period. | Prevents unfairly tiny review windows. |
| `MAX_REVIEW_WINDOW = 7 days` | Longest review period. | Prevents long recipient lockups after delivery. |
| `ARBITER_WINDOW = 14 days` | Dispute timeout. | Prevents unresolved disputes from stranding funds forever. |

### Immutable Variables

| Name | Meaning | Set by | Changes? |
| --- | --- | --- | --- |
| `usdc` | ERC-20 USDC token used by the protocol. | Constructor. | Never. |
| `tokenMessenger` | Circle CCTP V2 messenger. | Constructor. | Never. |

### Global State Variables

| Name | What it stores | Who changes it |
| --- | --- | --- |
| `escrowCount` | Last created escrow id. Escrow ids start at 1. | `deposit`. |
| `protocolTreasury` | Address receiving protocol fees. | Constructor, `setProtocolTreasury`. |
| `protocolFeeBps` | Current protocol fee in basis points. Default is 199, or 1.99%. | Constructor, `setProtocolFee`. |
| `supportedDomains` | CCTP destination allow-list. | Domain manager. |
| `cctpForwardFee` | Current admin-tracked forwarding fee floor. | Fee manager. |
| `escrows` | Escrow id to `Escrow` struct. | `deposit`, lifecycle functions, recipient address update functions. |
| `refundBalances` | Internal USDC credit owed to accounts. | Refund, dispute, cancel, recovery, withdraw functions. |
| `disputes` | Escrow id + milestone index to dispute data. | Dispute and resolution functions. |
| `milestones` | Escrow id + milestone index to milestone state. | Deposit and lifecycle functions. |
| `splits` | Escrow id to split recipients. | `deposit`, `updateSplitReceivingAddress`. |
| `settlementProposals` | Per-party mutual settlement offers. | `mutualSettle`. |
| `milestoneCancelProposals` | Per-party milestone cancel proposals. | `proposeMilestoneCancel`, `mutualCancel`. |
| `escrowFeeBps` | Per-escrow snapshot of protocol fee. | `deposit`. |
| `escrowTreasury` | Per-escrow snapshot of treasury. | `deposit`. |
| `pendingRefundRecovery` | Source wallet to proposed new owner for recovery. | Recovery functions. |

### Enums

`EscrowState`:

- `ACTIVE`: escrow can still process milestones.
- `COMPLETED`: all milestones are terminal (`RELEASED` or `REFUNDED`).
- `CANCELLED`: whole escrow was mutually cancelled.

`MilestoneState`:

- `PENDING`: recipient has not claimed delivery.
- `IN_REVIEW`: recipient claimed delivery; depositor review clock is running.
- `DISPUTED`: depositor objected during review window.
- `RELEASED`: recipient-side payout has been finalized.
- `REFUNDED`: depositor/refund side has been finalized.

### Structs

`Escrow` stores the business terms: depositor, recipient, refund address, total amount, destination domain, mint recipient, review window, cancel approvals, invoice metadata, deadline, milestone count, state, and the CCTP forward fee snapshot.

`Milestone` stores a milestone amount, delivery-claim timestamp, and state.

`DisputeData` stores dispute initiator, evidence, counter-evidence, resolution metadata, and recipient percentage awarded.

`SettlementProposal` stores whether a party has proposed a settlement and the proposed recipient bps.

`SplitRecipient` stores one recipient's CCTP mint address, destination domain, and basis-point share.

The view structs (`EscrowSummary`, `EscrowDetail`, `DashboardData`, `CallerRoles`, `ProtocolConfig`) exist to reduce frontend calls and package common UI data.

## 6. Events

Events are the off-chain truth trail. Indexers and frontends use them to display escrows, state transitions, disputes, fee collection, split settings, and recovery activity.

| Event | Emitted when |
| --- | --- |
| `EscrowCreated` | Deposit succeeds. |
| `DeliveryClaimed` | Recipient starts review for a milestone. |
| `MilestoneApproved` | Depositor approves release. |
| `MilestoneReleased` | Silent approval release executes. |
| `RefundedAfterDeadline` | Unclaimed milestone is refunded after deadline. |
| `DisputeRaised` | Depositor disputes claimed work. |
| `CounterEvidenceSubmitted` | Opposing party submits counter-evidence. |
| `EscrowReleased` / `EscrowRefunded` | Declared in the interface but not emitted by current implementation. They appear to be legacy interface events. |
| `EscrowRefundedViaMutualCancel` | Whole escrow mutual cancel executes. |
| `RefundWithdrawn` | Refund credit is withdrawn as USDC. |
| `SupportedDomainUpdated` | Domain allow-list changes. |
| `SplitsConfigured` | Escrow is created with splits. |
| `SplitConfigured` | One split recipient is stored. |
| `ProtocolFeeUpdated` | Global fee changes. |
| `ProtocolTreasuryUpdated` | Global treasury changes. |
| `ProtocolFeeCollected` | Fee is transferred to treasury. |
| `CctpForwardFeeUpdated` | Forwarding fee floor changes. |
| `ReceivingAddressUpdated` | single recipient redirects future payouts. |
| `SplitReceivingAddressUpdated` | split recipient redirects their own future payouts. |
| `EscrowTermsSnapshotted` | Deposit stores fee and treasury terms. |
| `RefundCreditTransferred` | Internal refund credit moves between owners. |
| `RefundCreditTransferProposed` | Recovery manager proposes a new owner for refund credit. |
| `DisputeResolved` | Arbiter resolves a dispute. |
| `DisputeTimedOutSettled` | 14-day arbiter timeout settles 50/50. |
| `PartialRefundCredited` | Dispute/settlement refunds part of a milestone. |
| `MutualSettlementProposed` | Depositor or recipient proposes dispute settlement bps. |
| `MutualSettlementExecuted` | Matching proposals execute. |
| `MilestoneCancelProposed` | One party proposes canceling one milestone. |
| `MilestoneCancelled` | Both parties agree to milestone cancel. |

## 7. Custom Errors

Custom errors are cheaper than revert strings and document invalid states.

| Error | Meaning / protection |
| --- | --- |
| `InvalidAmount` | Rejects zero escrow/milestone values. |
| `ZeroAddress` | Rejects zero address or zero encoded mint recipient. |
| `NoDeposit` | Escrow is not active where active state is required. |
| `NotEscrowOwner` | Caller is not depositor. |
| `NotEscrowOwnerOrRecipient` | Caller is neither party. |
| `InvalidState` | Milestone or escrow is not in the required state. |
| `ReviewWindowExpired` | Dispute attempted after review period. |
| `ReviewWindowNotExpired` | Silent release attempted too early. |
| `NoDispute` | Dispute-only function called without a dispute. |
| `EscrowDoesNotExist` | Escrow id was never created. |
| `ReviewWindowTooShort` / `ReviewWindowTooLong` | Enforces 1-7 day review window. |
| `NothingToWithdraw` | Prevents empty refund/recovery operations. |
| `NoInvoice` / `NoInvoiceURI` | Deposit must include invoice metadata. |
| `NoEvidence` / `NoEvidenceURI` / `NoDisputeReason` | Disputes and responses need usable evidence metadata. |
| `CannotRespondToOwnDispute` | Prevents same party from submitting counter-evidence to itself. |
| `CounterEvidenceAlreadySubmitted` | Counter-evidence can be submitted once. |
| `NoResolution` / `NoResolutionURI` | Arbiter resolution must include metadata. |
| `NoMilestones` | Escrow must have at least one milestone. |
| `MilestoneAmountMismatch` | Milestone amounts must sum to total deposit. |
| `InvalidMilestoneIndex` | Index out of range. |
| `PreviousMilestoneNotComplete` | Enforces sequential milestones. |
| `CannotCancelDuringDispute` | Whole-escrow cancel cannot bypass disputes. |
| `NotRecipient` | Caller is not authorized recipient/split recipient. |
| `DeadlineNotReached` / `DeadlinePassed` | Enforces deadline timing. |
| `UnsupportedDomain` | Destination is not allowed. |
| `FeeTooHigh` | Protocol fee above 5%. |
| `InvalidBps` / `BpsSumMismatch` | Basis-point values invalid. |
| `DeadlineRequired` / `DeadlineTooSoon` / `DeadlineTooFar` | Prevents bad escrow deadlines. |
| `InvalidRefundRecipient` | Bad recipient for refund withdrawal or transfer. |
| `NotInReview` | Function requires milestone to be `IN_REVIEW`. |
| `MaxFeeExceedsBurnAmount` | CCTP max fee must be below burn amount. |
| `ArbiterTimeoutNotReached` | 14-day timeout not elapsed. |
| `UsdcApproveFailed` | Raw USDC approval failed or returned false. |
| `MaxFeeBelowFloor` | Caller-supplied CCTP fee below escrow floor. |
| `DisputeAlreadyResolved` | Blocks evidence after resolution metadata exists. |
| `MutualSettlementAlreadyExecuted` | Mutual settlement called when no longer disputed. |
| `CctpForwardFeeTooHigh` | New global CCTP forward fee exceeds cap. |
| `MilestoneBelowForwardFee` | Cross-chain milestone would be too small to release. |
| `CctpForwardFeeNotSet` | Cross-chain release cannot auto-deliver with zero fee. |
| `NoPendingRecovery` / `NotProposedOwner` | Enforces two-step recovery. |
| `InvalidSplitIndex` | Split index out of range. |
| `TooManyMilestones` / `TooManySplits` | Prevents gas-bricking array sizes. |

## 8. Function-Level Teaching Notes

### Constructor

Deploys the protocol with USDC, arbiter, pauser, domain manager, CCTP messenger, and treasury addresses. It rejects zero critical addresses, stores immutable dependencies, sets the default fee to 199 bps, and grants initial roles.

If any role address were zero, core emergency or dispute paths could be permanently unusable. That is why the constructor validates all of them.

### Admin Configuration

`addSupportedDomain(destinationDomain)` and `removeSupportedDomain(destinationDomain)` update the destination allow-list. This is used at deposit and redirect time. Releases do not re-check the allow-list because doing so could strand old deposits.

`setProtocolFee(_newFeeBps)` changes the global fee for future deposits only in practice, because each escrow snapshots `protocolFeeBps` at deposit. The max is 500 bps.

`setProtocolTreasury(_newTreasury)` changes the global treasury for future deposits. Existing escrows use `escrowTreasury[escrowId]`.

`setCctpForwardFee(fee)` updates the global CCTP fee floor, capped at 100 USDC. New escrows snapshot it; silent release uses the escrow snapshot.

### `deposit`

Goal: create a new active escrow and pull USDC into the contract.

Inputs:

- `_recipient`: the business recipient/freelancer.
- `_refundTo`: account credited on refunds. If zero, defaults to depositor.
- `_totalAmount`: total USDC escrow amount.
- `_destinationDomain`: CCTP destination for single-recipient payouts.
- `_mintRecipient`: bytes32 encoded recipient address.
- `_reviewWindow`: review duration after delivery claim.
- `_invoiceHash` and `_invoiceURI`: invoice metadata.
- `_milestoneAmounts`: ordered milestone values.
- `_deadline`: final claim deadline.
- `_splits`: optional split payout configuration.

Access control: any unpaused caller.

State changes:

- Pulls `_totalAmount` USDC from depositor.
- Increments `escrowCount`.
- Writes `escrows[escrowId]`.
- Writes all `milestones`.
- Writes optional `splits`.
- Snapshots fee bps, treasury, and CCTP forward fee.

Security:

- Rejects zero amounts, zero recipient, empty invoice metadata, bad review windows, bad deadlines, no milestones, too many milestones/splits.
- Ensures milestone sum equals total.
- Validates supported domains.
- Ensures split bps sum to 10,000.
- For cross-chain escrows, each milestone must be greater than current forward fee.
- Uses `safeTransferFrom` and `nonReentrant`.

Execution flow:

```text
validate escrow terms
validate domain or splits
default refundTo if needed
sum milestones
check cross-chain milestone sizes
transfer USDC in
increment escrow id
store escrow
store milestones
store splits
snapshot terms
emit events
```

### `claimDelivery`

Goal: recipient says a milestone is complete and starts the review window.

Only the escrow recipient can call it. The escrow must exist, be active, and the milestone must be `PENDING`. The function enforces sequential milestones: milestone `n` can only be claimed after milestone `n - 1` is `RELEASED` or `REFUNDED`.

State changes: sets `claimedAt = block.timestamp` and state to `IN_REVIEW`.

### `raiseDispute`

Goal: depositor objects to a claimed milestone.

Only the depositor can call it, only while the milestone is `IN_REVIEW`, and only before the review window expires. It requires evidence hash, evidence URI, and a reason.

State changes: writes `DisputeData` and sets milestone to `DISPUTED`.

### `submitCounterEvidence`

Goal: allow the other party to respond to a dispute.

The caller must be the depositor or recipient but not the party that raised the dispute. Counter-evidence can only be submitted once and only before resolution.

State changes: stores `counterEvidenceHash` and `counterEvidenceURI`.

### `resolveDispute`

Goal: arbiter resolves a disputed milestone by assigning recipient bps.

Only `ARBITER_ROLE` can call it. `_recipientBps` can be 0 through 10,000. If the recipient receives a nonzero cross-chain share, `maxFee` must clear the escrow's CCTP fee floor.

State changes:

- Stores resolution metadata.
- Stores resolved recipient bps.
- Calls `_executePartialRelease`.

Formula:

```text
recipientAmount = milestoneAmount * recipientBps / 10_000
refundAmount = milestoneAmount - recipientAmount
fee = recipientAmount * escrowFeeBps / 10_000
recipientNet = recipientAmount - fee
```

### `mutualSettle`

Goal: let depositor and recipient settle a disputed milestone without the arbiter.

Either party submits a recipient bps. If both parties have submitted and the bps match, settlement executes through `_executePartialRelease`.

This is a two-sided consent pattern. A proposal alone does not move funds.

### `resolveDisputeByTimeout`

Goal: prevent arbiter inaction from freezing funds forever.

Anyone can call it after `ARBITER_WINDOW` has passed since the dispute was raised. It uses a fixed 50/50 split.

Important difference: recipient share is not sent through CCTP here. It is credited as Arc refund credit, including split recipients decoded from `bytes32` to `address`.

Formula:

```text
defaultBps = 5000
recipientShare = milestoneAmount * 5000 / 10_000
depositorShare = milestoneAmount - recipientShare
fee = recipientShare * escrowFeeBps / 10_000
recipientNet = recipientShare - fee
```

State changes:

- Milestone becomes `REFUNDED`.
- Recipient net is credited internally.
- Depositor share is credited to `refundTo`.
- Protocol fee is transferred to treasury.
- Escrow completion is checked.

### `approveRelease`

Goal: depositor explicitly approves a claimed milestone.

Only depositor can call it, only while milestone is `IN_REVIEW`. It respects the depositor-supplied `maxFee`, but checks that cross-chain fee requirements are met.

State changes:

- Milestone becomes `RELEASED`.
- Completion is checked.
- `_executeCCTPReleaseAmount` sends funds through CCTP after fee.

### `release`

Goal: permissionless release after review window expiry.

Anyone can call it after the review window expires. The passed `maxFee` argument is ignored for safety. Instead, the protocol uses `e.escrowCctpForwardFee`, the fee snapshot from deposit. That prevents a third-party caller from authorizing an excessive CCTP forwarding fee.

### `refundAfterDeadline`

Goal: refund a milestone that the recipient never claimed before the deadline.

Anyone can call it after the escrow deadline, but only for `PENDING` milestones and only in order. The amount becomes internal refund credit for `e.refundTo`.

### `_checkEscrowCompletion`

Internal helper. Loops over all milestones. If every milestone is `RELEASED` or `REFUNDED`, the escrow becomes `COMPLETED`.

This is why `MAX_MILESTONES` matters: the helper loops over milestone count.

### `mutualCancel`

Goal: cancel the entire active escrow if both depositor and recipient agree.

First caller sets their approval flag. When both flags are true, all `PENDING` and `IN_REVIEW` milestones become `REFUNDED`, disputed milestones block the cancel, and the escrow becomes `CANCELLED`.

Released milestones are not refunded because those funds have already left.

### `proposeMilestoneCancel`

Goal: cancel one milestone if both parties agree.

Either party proposes cancellation for a `PENDING` or `IN_REVIEW` milestone. When both parties have proposed, the milestone amount is credited to `refundTo`, the milestone becomes `REFUNDED`, proposals are cleared, and completion is checked.

### Refund Credit Functions

`withdrawRefund(recipient)` withdraws the caller's internal refund credit as actual USDC to `recipient`.

`transferRefundCredit(newOwner)` moves internal credit from caller to another address without transferring USDC.

`proposeRefundCreditTransfer(blacklistedWallet, newOwner)` lets a recovery manager propose moving credit away from a locked wallet.

`claimRefundCreditTransfer(blacklistedWallet)` lets the proposed new owner claim that internal credit. This second step prevents a compromised recovery manager from immediately moving and withdrawing funds.

### Recipient Redirect Functions

`updateReceivingAddress` lets the main recipient update future single-recipient payout address and destination domain while the escrow is not completed or cancelled.

`updateSplitReceivingAddress` lets a split recipient update their own split entry. The caller must match the current split `mintRecipient` after conversion to `bytes32(uint160(msg.sender))`.

### Pause Functions

`pause` and `unpause` are controlled by `PAUSER_ROLE`. Pause blocks `deposit` because it uses `whenNotPaused`. Release, refund, dispute, and withdrawal functions are not paused, so users can still escape or settle existing escrows.

### View Functions

The view layer is frontend-friendly:

- `getEscrow`
- `getMilestones`
- `getSplits`
- `isReviewWindowExpired`
- `isClaimed`
- `getEscrowDetail`
- `getCallerRoles`
- `getProtocolConfig`

The remaining views are per-escrow reads bounded by `milestoneCount` / split count; the contract exposes no `1..escrowCount` scan view. Bulk listing is served by the Goldsky subgraph.

## 9. CCTP And Fee Accounting

### Protocol Fee Formula

Protocol fee is charged only on recipient-side released value, not refunded value.

```text
fee = releaseAmount * escrowFeeBps[escrowId] / 10_000
remainder = releaseAmount - fee
```

The fee bps and treasury are snapshotted at deposit:

```text
escrowFeeBps[escrowId] = protocolFeeBps
escrowTreasury[escrowId] = protocolTreasury
```

This prevents fee governance from changing the economic terms after a depositor has locked funds.

### Split Formula

If splits exist, the recipient net amount is divided by bps.

```text
share[i] = remainder * splitBps[i] / 10_000
lastShare = remainder - sum(previousShares)
```

The last split receives rounding dust. This is a common integer division pattern.

### CCTP Max Fee Rules

For same-chain Arc destination:

```text
maxFee = 0
```

For cross-chain destination:

```text
escrowCctpForwardFee must be nonzero
maxFee >= escrowCctpForwardFee
maxFee < burnAmount
```

The strict `maxFee < burnAmount` rule prevents the forwarding fee from consuming the whole burn.

### Burn Flow

```text
_executeCCTPReleaseAmount
  -> calculate fee and remainder
  -> transfer fee to treasury
  -> decide single recipient or split recipients
  -> _approveAndBurn for each burn

_approveAndBurn
  -> decide maxFee
  -> raw-call USDC approve(tokenMessenger, burnAmount)
  -> tokenMessenger.depositForBurnWithHook(...)
```

The raw approval exists because `SafeERC20.forceApprove` is noted as incompatible with Arc's USDC precompile.

## 10. Security Review

### Reentrancy

Most state-changing functions that move money or credits are `nonReentrant`. External calls are usually after state changes, following checks-effects-interactions. Key examples: release functions set milestone state before CCTP burn; refund withdrawals zero balances before transfer.

### Access Control

Arbiter, pauser, domain, fee, and recovery powers are separated. Constructor rejects zero addresses for critical roles. `DEFAULT_ADMIN_ROLE` still has strong power through inherited role administration, so admin key security matters.

### Accounting

Important accounting protections:

- Milestone amounts must sum exactly to total deposit.
- Split bps must sum exactly to 10,000.
- Last split absorbs rounding dust.
- Refunds are credited internally before withdrawal.
- Fees are charged only on recipient-side releases.
- Fee bps and treasury are snapshotted per escrow.

### DoS And Gas

The protocol loops over milestones and splits. It caps milestones at 20 and splits at 10 so completion checks and split burns cannot grow without bound.

View functions that scan all escrows can become expensive for huge deployments, but they are meant for frontend `eth_call` style usage.

### Front-Running And Griefing

Permissionless `release` ignores caller-supplied `maxFee`, using the escrow snapshot instead. This prevents a random caller from authorizing a too-large CCTP fee.

Domain removals do not affect in-flight releases, preventing admin griefing of locked funds.

### Dispute Safety

Disputes require evidence and must be raised during the review window. Arbiter inactivity has a deterministic 50/50 timeout after 14 days, so funds do not remain stuck forever.

### Trust Assumptions

Users trust:

- USDC behavior.
- Circle CCTP and forwarding service.
- Arbiter fairness during disputes.
- Role holders not to abuse admin configuration.
- Frontends/indexers to present invoice/evidence URIs honestly, since the contract stores hashes/URIs but does not validate off-chain content.

### Upgrade Risk

The shown contract is not upgradeable. There are no proxy-specific storage gaps or initializer patterns. A new version would require migration or separate deployment unless another system wraps it.

## 11. Patterns Used

### Milestone Escrow

Funds are locked up front and released in ordered chunks. This reduces counterparty risk because the recipient does not wait for the full project, and the depositor does not release everything before completion.

### Optimistic Review

Recipient starts the clock with `claimDelivery`. Depositor has a fixed review window. If depositor does nothing, release becomes permissionless.

### Pull Refunds

Refunds are credited internally and withdrawn later. This avoids forcing USDC transfers during every settlement path and lets users choose a withdrawal recipient.

### Snapshot Governance Terms

The protocol stores fee bps, treasury, and forward fee at deposit. This makes escrow terms stable after creation.

### Basis-Point Accounting

Percentages use `10_000 = 100%`. This avoids decimals in integer math.

### Two-Party Consent

Mutual cancel and mutual settlement use proposals from both depositor and recipient before funds move.

### CCTP Burn-And-Mint

Recipient releases are not ordinary ERC-20 transfers unless the destination is Arc. They are CCTP burns with hook data so USDC can be minted/forwarded on the destination domain.

## 12. Rebuild Guide

If rebuilding from scratch, write it in this order:

1. Define the interface types: escrow state, milestone state, escrow, milestone, dispute, settlement, split, view structs, events, and errors.
2. Build constructor and role model with USDC, TokenMessenger, treasury, arbiter, pauser, domain manager, fee manager, and recovery manager.
3. Implement deposit validation, milestone storage, split validation, and USDC intake.
4. Implement the milestone state machine: `claimDelivery`, `approveRelease`, `release`, `refundAfterDeadline`, `_checkEscrowCompletion`.
5. Implement CCTP release internals: fee calculation, split calculation, approval, and burn with hook data.
6. Add dispute flow: `raiseDispute`, `submitCounterEvidence`, `resolveDispute`, `mutualSettle`, `resolveDisputeByTimeout`.
7. Add cancellation flows: whole-escrow mutual cancel and milestone-level cancel.
8. Add refund withdrawal, refund credit transfer, and two-step recovery.
9. Add recipient/split recipient redirect functions.
10. Add admin configuration and frontend view helpers.

The central invariant to keep in your head:

```text
For each milestone, exactly one terminal outcome should happen:
RELEASED or REFUNDED.

Once all milestones are terminal, the escrow should be terminal:
COMPLETED or CANCELLED.
```

## 13. Practice Questions

1. A depositor creates an escrow with three milestones. Can the recipient claim milestone 2 before milestone 1 is terminal? Why?
2. Why does `deposit` reject cross-chain milestone amounts less than or equal to `cctpForwardFee`?
3. If protocol fee changes after deposit, which fee applies to that escrow and why?
4. In `release`, why is the user-supplied `maxFee` ignored?
5. What happens if a disputed milestone is not resolved by the arbiter for 14 days?
6. Why does the protocol use internal `refundBalances` instead of immediately transferring refunds in every path?
7. In a split release, why does the last recipient absorb dust?
8. What would go wrong if `supportedDomains` were checked again during release?
9. What prevents a recovery manager from single-handedly stealing refund credit?
10. Which functions can still operate while the contract is paused, and why is that useful?

## 14. Mini Exercises

### Exercise 1: Fee Math

Milestone amount is `1,000 USDC`, recipient bps is `7,500`, and escrow fee is `199 bps`.

Calculate:

- recipient gross share
- depositor refund share
- protocol fee
- recipient net share

Answer:

```text
recipientGross = 1000 * 7500 / 10000 = 750
depositorRefund = 1000 - 750 = 250
protocolFee = 750 * 199 / 10000 = 14.925
recipientNet = 750 - 14.925 = 735.075
```

In raw USDC units, use 6 decimals.

### Exercise 2: Split Math

Recipient net is `735.075 USDC`. Splits are 60%, 25%, 15%.

Expected shares:

```text
share0 = net * 6000 / 10000
share1 = net * 2500 / 10000
share2 = net - share0 - share1
```

The last formula preserves all integer dust.

### Exercise 3: State Prediction

Start:

```text
milestone.state = PENDING
escrow.state = ACTIVE
```

Recipient calls `claimDelivery`, depositor does nothing, review window expires, anyone calls `release`.

Final:

```text
milestone.state = RELEASED
escrow.state = COMPLETED only if every other milestone is RELEASED or REFUNDED
```

### Exercise 4: Security Reasoning

Explain why `resolveDisputeByTimeout` credits recipient shares as refund credit instead of using CCTP. Hint: the timeout path is permissionless and should not rely on a caller-supplied forwarding fee.

## 15. Things To Notice In The Current Code

- `EscrowReleased` and `EscrowRefunded` are declared in the interface but not emitted in the implementation. They appear to be legacy events.
- `raiseDispute` and `submitCounterEvidence` are not marked `nonReentrant`, but they do not transfer tokens or make external calls.
- Bulk reads (dashboard, arbiter queue, per-party escrow lists) are served exclusively by the Goldsky subgraph. The contract intentionally exposes no `1..escrowCount` scan view — that gas cost is kept off-chain.
- Same-chain Arc payouts still call CCTP TokenMessenger with `maxFee = 0`; the code treats Arc as a no-forwarding-fee domain.
- The protocol is intentionally sequential at the milestone level, which simplifies accounting and dispute/cancel reasoning.

