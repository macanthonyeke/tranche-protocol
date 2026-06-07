# Entry Point Map

> Tranche Protocol | 25 entry points | 6 permissionless | 10 party-gated | 9 admin/role (+3 inherited AccessControl)

---

## Protocol Flow Paths

### Setup (Admin / Domain Manager)

`constructor()` → `addSupportedDomain(domain)` → `setProtocolFee()` / `setCctpForwardFee()`  ◄── roles granted in constructor

### Happy Path (Depositor → Recipient)

`deposit()` → `claimDelivery()` (recipient)  ◄── milestone PENDING, on/before deadline+72h
        ├─→ `approveRelease()` (depositor, instant)  → CCTP burn
        └─→ `release()` (anyone)  ◄── review window elapsed → CCTP burn

### Dispute Path

`[claimDelivery above]` → `raiseDispute()` (depositor)  ◄── within review window
        ├─→ `submitCounterEvidence()` (other party)
        ├─→ `resolveDispute()` (arbiter)  → partial release + refund credit
        ├─→ `mutualSettle()` (both parties agree same bps)  → partial release
        └─→ `resolveDisputeByTimeout()` (anyone)  ◄── 14d arbiter inaction → 50/50

### Refund / Cancel Paths

`deposit()` → `refundAfterDeadline()` (anyone)  ◄── deadline+72h passed, milestone never claimed
`deposit()` → `mutualCancel()` ×2 (both parties)  → refund credit for unreleased milestones
`[claimDelivery]` → `proposeMilestoneCancel()` ×2 (both parties)  → single-milestone refund

### Withdrawal / Recovery

`[any refund above]` → `withdrawRefund()` (credit holder)  → Arc transfer or cross-chain CCTP burn
        ├─→ `transferRefundCredit(newOwner)` (credit holder re-keys)
        └─→ `proposeRefundCreditTransfer()` (recovery mgr) → `claimRefundCreditTransfer()` (proposed wallet)

---

## Permissionless

Entry points callable by any address with no effective caller restriction. Sorted by value flow.

### `TrancheProtocol.deposit()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, whenNotPaused, nonReentrant |
| Caller | Depositor (anyone) |
| Parameters | `_recipient`, `_refundTo`, `_totalAmount`, `_destinationDomain`, `_mintRecipient`, `_reviewWindow`, `_invoiceHash`, `_invoiceURI`, `_milestoneAmounts[]`, `_deadline`, `_splits[]` (all user-controlled) |
| Call chain | `→ _validateSplits() → usdc.safeTransferFrom() ` (writes escrow/milestones/splits/fee snapshot) |
| State modified | `escrowCount`, `escrows`, `milestones`, `splits`, `escrowFeeBps`, `escrowTreasury` |
| Value flow | Depositor → Tranche (USDC in) |
| Reentrancy guard | yes |

### `TrancheProtocol.release()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant (NOT whenNotPaused — by design) |
| Caller | Anyone, after review window |
| Parameters | `escrowId`, `milestoneIndex` (user-controlled); `maxFee` (**ignored** — burn uses `escrowCctpForwardFee` snapshot) |
| Call chain | `→ _assertCrossChainFee() → _checkEscrowCompletion() → _executeCCTPReleaseAmount() → usdc.safeTransfer()(fee) → _approveAndBurn() → tokenMessenger.depositForBurnWithHook()` |
| State modified | `milestones[].state` → RELEASED, possibly `escrows[].state` → COMPLETED |
| Value flow | Tranche → treasury (fee) + CCTP burn → recipient |
| Reentrancy guard | yes |

### `TrancheProtocol.withdrawRefund()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Refund-credit holder (msg.sender's own balance) |
| Parameters | `recipient`, `destinationDomain`, `mintRecipient`, `maxFee` (all user-controlled) |
| Call chain | Arc: `→ usdc.safeTransfer()`; cross-chain: `→ _approveAndBurn() → tokenMessenger.depositForBurnWithHook()` |
| State modified | `refundBalances[msg.sender]` → 0 |
| Value flow | Tranche → recipient (Arc transfer or CCTP burn) |
| Reentrancy guard | yes |

### `TrancheProtocol.refundAfterDeadline()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone, after deadline + 72h |
| Parameters | `escrowId`, `milestoneIndex` (user-controlled) |
| Call chain | `→ _checkEscrowCompletion()` |
| State modified | `milestones[].state` → REFUNDED, `refundBalances[e.refundTo] += amount` |
| Value flow | none (credits refund balance; USDC stays on Arc) |
| Reentrancy guard | yes |

### `TrancheProtocol.resolveDisputeByTimeout()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Anyone, after 14d arbiter window |
| Parameters | `escrowId`, `milestoneIndex` (user-controlled) |
| Call chain | `→ _checkEscrowCompletion() → usdc.safeTransfer()(fee)` |
| State modified | `milestones[].state` → REFUNDED, `refundBalances` (50/50 split across splits + refundTo) |
| Value flow | Tranche → treasury (fee on recipient half); rest as Arc refund credits |
| Reentrancy guard | yes |

### `TrancheProtocol.transferRefundCredit()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Refund-credit holder (re-keys own balance) |
| Parameters | `newOwner` (user-controlled) |
| Call chain | — (internal balance move only) |
| State modified | `refundBalances[msg.sender]` → 0, `refundBalances[newOwner] += amount` |
| Value flow | none |
| Reentrancy guard | yes |

---

## Role-Gated

Restricted by an internal `msg.sender` check tied to escrow participants (no OZ modifier). Grouped by required identity.

### Recipient (`msg.sender == e.recipient`)

#### `TrancheProtocol.claimDelivery()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Recipient |
| Parameters | `escrowId`, `milestoneIndex` (user-controlled) |
| State modified | `milestones[].state` → IN_REVIEW, `milestones[].claimedAt` |
| Value flow | none |
| Reentrancy guard | yes |

#### `TrancheProtocol.updateReceivingAddress()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Recipient |
| Parameters | `escrowId`, `newAddress`, `newDestinationDomain` (user-controlled) |
| State modified | `escrows[].mintRecipient`, `escrows[].destinationDomain` |
| Value flow | none |
| Reentrancy guard | no |

### Depositor (`msg.sender == e.depositor`)

#### `TrancheProtocol.raiseDispute()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Depositor, within review window |
| Parameters | `escrowId`, `milestoneIndex`, `_reason`, `_evidenceHash`, `_evidenceURI` (user-controlled) |
| State modified | `disputes[][]`, `milestones[].state` → DISPUTED |
| Value flow | none |
| Reentrancy guard | no |

#### `TrancheProtocol.approveRelease()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Depositor |
| Parameters | `escrowId`, `milestoneIndex`, `maxFee` (user-controlled — honored, unlike `release`) |
| Call chain | `→ _assertCrossChainFee() → _checkEscrowCompletion() → _executeCCTPReleaseAmount() → tokenMessenger.depositForBurnWithHook()` |
| State modified | `milestones[].state` → RELEASED, possibly escrow COMPLETED |
| Value flow | Tranche → treasury (fee) + CCTP burn → recipient |
| Reentrancy guard | yes |

### Either party (`msg.sender == depositor || recipient`)

#### `TrancheProtocol.submitCounterEvidence()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Party who did not raise the dispute |
| Parameters | `escrowId`, `milestoneIndex`, `_counterEvidenceHash`, `_counterEvidenceURI` (user-controlled) |
| State modified | `disputes[][].counterEvidence*` |
| Value flow | none |
| Reentrancy guard | no |

#### `TrancheProtocol.mutualSettle()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Either party (executes when both propose equal bps) |
| Parameters | `escrowId`, `milestoneIndex`, `_agreedBps`, `maxFee` (user-controlled) |
| Call chain | `→ _assertCrossChainFee() → _executePartialRelease() → _executeCCTPReleaseAmount()` |
| State modified | `settlementProposals[][][]`, on match `milestones[].state`, `refundBalances` |
| Value flow | Tranche → recipient (CCTP) + refund credit |
| Reentrancy guard | yes |

#### `TrancheProtocol.mutualCancel()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Either party (executes when both approve) |
| Parameters | `escrowId` (user-controlled) |
| State modified | `escrows[].*ApproveCancel`, on match milestones → REFUNDED, escrow → CANCELLED, `refundBalances` |
| Value flow | none (credits refunds) |
| Reentrancy guard | yes |

#### `TrancheProtocol.proposeMilestoneCancel()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Either party (executes when both propose) |
| Parameters | `escrowId`, `milestoneIndex` (user-controlled) |
| State modified | `milestoneCancelProposals[][][]`, on match milestone → REFUNDED, `refundBalances` |
| Value flow | none (credits refund) |
| Reentrancy guard | yes |

### Split owner (`s[i].mintRecipient == bytes32(msg.sender)`)

#### `TrancheProtocol.updateSplitReceivingAddress()`

| Aspect | Detail |
|--------|--------|
| Visibility | external |
| Caller | Address currently encoded in the split entry |
| Parameters | `escrowId`, `splitIndex`, `newAddress`, `newDestinationDomain` (user-controlled) |
| State modified | `splits[][].mintRecipient`, `splits[][].destinationDomain` |
| Value flow | none |
| Reentrancy guard | no |

### Proposed recovery wallet (`msg.sender == pendingRefundRecovery[wallet]`)

#### `TrancheProtocol.claimRefundCreditTransfer()`

| Aspect | Detail |
|--------|--------|
| Visibility | external, nonReentrant |
| Caller | Address a recovery manager proposed |
| Parameters | `blacklistedWallet` (user-controlled) |
| State modified | `refundBalances[blacklistedWallet]` → 0, `refundBalances[msg.sender] += amount`, clears `pendingRefundRecovery` |
| Value flow | none |
| Reentrancy guard | yes |

---

## Admin-Only

Restricted by OpenZeppelin role modifiers. These configure the protocol rather than operate it.

| Contract | Function | Role | Parameters | State Modified |
|----------|----------|------|------------|----------------|
| TrancheProtocol | `resolveDispute()` | ARBITER_ROLE | `escrowId`, `milestoneIndex`, `_recipientBps`, `_resolutionHash`, `_resolutionURI`, `maxFee` | `disputes`, `milestones[].state`, `refundBalances`, CCTP burn |
| TrancheProtocol | `addSupportedDomain()` | DOMAIN_MANAGER_ROLE | `destinationDomain` | `supportedDomains` |
| TrancheProtocol | `removeSupportedDomain()` | DOMAIN_MANAGER_ROLE | `destinationDomain` | `supportedDomains` |
| TrancheProtocol | `setProtocolFee()` | FEE_MANAGER_ROLE | `_newFeeBps` | `protocolFeeBps` |
| TrancheProtocol | `setProtocolTreasury()` | FEE_MANAGER_ROLE | `_newTreasury` | `protocolTreasury` |
| TrancheProtocol | `setCctpForwardFee()` | FEE_MANAGER_ROLE | `fee` | `cctpForwardFee` |
| TrancheProtocol | `pause()` | PAUSER_ROLE | — | paused → true (blocks `deposit` only) |
| TrancheProtocol | `unpause()` | PAUSER_ROLE | — | paused → false |
| TrancheProtocol | `proposeRefundCreditTransfer()` | RECOVERY_MANAGER_ROLE | `blacklistedWallet`, `newOwner` | `pendingRefundRecovery` |

### Inherited (OpenZeppelin AccessControl)

| Contract | Function | Role | Notes |
|----------|----------|------|-------|
| TrancheProtocol | `grantRole()` | DEFAULT_ADMIN_ROLE | Can grant any role, incl. ARBITER / FEE_MANAGER, to any address |
| TrancheProtocol | `revokeRole()` | DEFAULT_ADMIN_ROLE | Revoke any role |
| TrancheProtocol | `renounceRole()` | self | Caller renounces own role |
