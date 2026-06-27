// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {console2 as console} from "forge-std/console2.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {TrancheProtocol} from "../src/TrancheProtocol.sol";
import {ITrancheProtocol} from "../src/interface/ITrancheProtocol.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockTokenMessenger} from "./mocks/MockTokenMessenger.sol";

/// @notice Bounded actor handler for the redesigned lifecycle.
/// @dev    Round 6 PBT deepening: the handler now creates split escrows
///         (mixed Arc + cross-chain legs, both orderings), drives partial
///         dispute resolutions and mutual settlements, exercises
///         approveRelease (incl. a deliberate under-floor maxFee probe — the
///         DR-2 catcher), the 50/50 timeout path, and cross-chain
///         withdrawRefund. Reached-state counters are surfaced via
///         afterInvariant() so a green run can be proven non-vacuous.
contract Handler is Test, ITrancheProtocol {
    TrancheProtocol public escrow;
    MockUSDC public usdc;
    MockTokenMessenger public tokenMessenger;

    address public arbiter;
    address public pauser;
    address[] public actors;
    uint256[] public escrowIds;

    uint256 internal constant CCTP_FORWARD_FEE = 100_000;
    uint32 internal constant ARC_DOMAIN = 26;
    uint32 internal constant CC_DOMAIN = 6;

    // Milestone-state monotonicity ghost (existing).
    mapping(uint256 => mapping(uint256 => uint8)) public lastSeenMilestoneState;
    bool public sawBackwardTransition;

    // Round 6 ghosts.
    mapping(uint256 => bool) internal ackSeen;
    mapping(uint256 => uint256) internal ackedAt;
    mapping(uint256 => bytes32) internal frozenURIHash;
    mapping(uint256 => bool) internal escrowStateSeen;
    mapping(uint256 => EscrowState) internal lastEscrowState;
    bool public sawAckReset; // invoiceAcknowledgedAt went non-zero -> changed/zero
    bool public sawURIChangedAfterAck; // invoiceURI mutated after acknowledgment
    bool public sawEscrowRevived; // terminal escrow returned to ACTIVE
    bool public sawUnderFloorApproveSucceeded; // DR-2 catcher: under-floor approve on a cross-chain escrow succeeded

    uint256 public depositCalls;
    uint256 public splitDepositCalls;
    uint256 public shortDepositCalls;
    uint256 public warpCalls;
    uint256 public claimCalls;
    uint256 public disputeCalls;
    uint256 public counterCalls;
    uint256 public resolveCalls;
    uint256 public partialResolveCalls;
    uint256 public approveCalls;
    uint256 public underFloorApproveAttempts;
    uint256 public settleCalls;
    uint256 public timeoutCalls;
    uint256 public releaseCalls;
    uint256 public refundCalls;
    uint256 public cancelCalls;
    uint256 public milestoneCancelCalls;
    uint256 public withdrawCalls;
    uint256 public withdrawCcCalls;
    uint256 public uriUpdateCalls;

    constructor(TrancheProtocol _escrow, MockUSDC _usdc, MockTokenMessenger _tm, address _arbiter, address _pauser) {
        escrow = _escrow;
        usdc = _usdc;
        tokenMessenger = _tm;
        arbiter = _arbiter;
        pauser = _pauser;
        actors.push(makeAddr("actorA"));
        actors.push(makeAddr("actorB"));
        actors.push(makeAddr("actorC"));
        actors.push(makeAddr("actorD"));
        for (uint256 i = 0; i < actors.length; i++) {
            usdc.mint(actors[i], 1_000_000e6);
        }
    }

    function escrowIdsLength() external view returns (uint256) {
        return escrowIds.length;
    }

    function _pickActor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _pickEscrow(uint256 seed) internal view returns (uint256, bool) {
        if (escrowIds.length == 0) return (0, false);
        return (escrowIds[seed % escrowIds.length], true);
    }

    function _isCrossChain(uint256 id) internal view returns (bool) {
        SplitRecipient[] memory s = escrow.getSplits(id);
        if (s.length == 0) return escrow.getEscrow(id).destinationDomain != ARC_DOMAIN;
        for (uint256 i = 0; i < s.length; i++) {
            if (s[i].destinationDomain != ARC_DOMAIN) return true;
        }
        return false;
    }

    function deposit(uint256 actorSeed, uint256 m1, uint256 m2, uint256 m3, uint256 reviewWindow) external {
        address actor = _pickActor(actorSeed);
        // Cross-chain (domain 6): every milestone must out-size the forward fee.
        m1 = bound(m1, CCTP_FORWARD_FEE + 1, 1_000e6);
        m2 = bound(m2, CCTP_FORWARD_FEE + 1, 1_000e6);
        m3 = bound(m3, CCTP_FORWARD_FEE + 1, 1_000e6);
        reviewWindow = bound(reviewWindow, 1 days, 7 days);
        uint256[] memory ms = new uint256[](3);
        ms[0] = m1;
        ms[1] = m2;
        ms[2] = m3;
        uint256 total = m1 + m2 + m3;

        if (usdc.balanceOf(actor) < total) usdc.mint(actor, total);

        address rec = actors[(actorSeed + 1) % actors.length];
        vm.startPrank(actor);
        usdc.approve(address(escrow), total);
        try escrow.deposit(
            rec,
            actor, // refundTo = depositor
            total,
            CC_DOMAIN,
            bytes32(uint256(uint160(rec))),
            reviewWindow,
            keccak256(abi.encode(actor, total, block.timestamp)),
            "ipfs://invoice",
            ms,
            // Far deadline: claimDelivery must never time out, so the happy path
            // (claim -> release/approve/dispute/settle) is decoupled from the
            // clock. Short-deadline escrows (depositShortDeadline) feed the
            // refundAfterDeadline path instead.
            block.timestamp + 3000 days,
            new SplitRecipient[](0),
            ""
        ) returns (
            uint256 id
        ) {
            escrowIds.push(id);
            depositCalls++;
        } catch {}
        vm.stopPrank();
    }

    /// @notice Single-recipient cross-chain escrow with a short deadline, left
    ///         unclaimed by design so the deadline+grace lapses and
    ///         refundAfterDeadline becomes reachable.
    function depositShortDeadline(uint256 actorSeed, uint256 amt) external {
        address actor = _pickActor(actorSeed);
        amt = bound(amt, CCTP_FORWARD_FEE + 1, 1_000e6);
        uint256[] memory ms = new uint256[](1);
        ms[0] = amt;
        if (usdc.balanceOf(actor) < amt) usdc.mint(actor, amt);
        address rec = actors[(actorSeed + 1) % actors.length];
        vm.startPrank(actor);
        usdc.approve(address(escrow), amt);
        try escrow.deposit(
            rec,
            actor,
            amt,
            CC_DOMAIN,
            bytes32(uint256(uint160(rec))),
            1 days,
            keccak256(abi.encode("short", actor, amt, block.timestamp)),
            "ipfs://invoice-short",
            ms,
            block.timestamp + 2 days,
            new SplitRecipient[](0),
            ""
        ) returns (
            uint256 id
        ) {
            escrowIds.push(id);
            shortDepositCalls++;
        } catch {}
        vm.stopPrank();
    }

    /// @notice Advance the clock a bounded amount so review windows (1-7d) and
    ///         the arbiter window (14d) are reached by accumulation rather than
    ///         by a single large jump that would strand claimDelivery.
    function warpTime(uint256 seed) external {
        vm.warp(block.timestamp + bound(seed, 6 hours, 5 days));
        warpCalls++;
    }

    /// @notice Split escrow with two legs — one Arc, one cross-chain — in either
    ///         ordering (arcFirst toggles Arc-leg-at-index-0, the exact DR-2
    ///         shape). Milestones bounded large enough that the deposit-time F2
    ///         floor always clears for the chosen bps split.
    function depositSplit(uint256 actorSeed, uint256 m1, uint256 m2, uint256 bpsSeed, bool arcFirst) external {
        address actor = _pickActor(actorSeed);
        m1 = bound(m1, 2e6, 500e6);
        m2 = bound(m2, 2e6, 500e6);
        uint256[] memory ms = new uint256[](2);
        ms[0] = m1;
        ms[1] = m2;
        uint256 total = m1 + m2;
        if (usdc.balanceOf(actor) < total) usdc.mint(actor, total);

        address legA = actors[(actorSeed + 1) % actors.length];
        address legB = actors[(actorSeed + 2) % actors.length];
        uint256 bpsA = bound(bpsSeed, 1000, 9000);
        uint256 bpsB = 10_000 - bpsA;

        SplitRecipient[] memory sp = new SplitRecipient[](2);
        sp[0] = SplitRecipient({
            mintRecipient: bytes32(uint256(uint160(legA))),
            destinationDomain: arcFirst ? ARC_DOMAIN : CC_DOMAIN,
            bps: bpsA
        });
        sp[1] = SplitRecipient({
            mintRecipient: bytes32(uint256(uint160(legB))),
            destinationDomain: arcFirst ? CC_DOMAIN : ARC_DOMAIN,
            bps: bpsB
        });

        vm.startPrank(actor);
        usdc.approve(address(escrow), total);
        try escrow.deposit(
            legA,
            actor,
            total,
            ARC_DOMAIN, // single-recipient field unused when splits present
            bytes32(uint256(uint160(legA))),
            3 days,
            keccak256(abi.encode("split", actor, total, block.timestamp)),
            "ipfs://invoice-split",
            ms,
            block.timestamp + 3000 days,
            sp,
            ""
        ) returns (
            uint256 id
        ) {
            escrowIds.push(id);
            splitDepositCalls++;
        } catch {}
        vm.stopPrank();
    }

    function claim(uint256 escrowSeed, uint256 idxSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        address recip = escrow.getEscrow(id).recipient;
        vm.prank(recip);
        try escrow.acknowledgeInvoice(id) {} catch {}
        vm.prank(recip);
        try escrow.claimDelivery(id, idx) {
            claimCalls++;
        } catch {}
    }

    function raiseDispute(uint256 escrowSeed, uint256 idxSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        // Disputes are depositor-only and require IN_REVIEW; try/catch absorbs misses.
        vm.prank(escrow.getEscrow(id).depositor);
        try escrow.raiseDispute(id, idx, "reason", keccak256(abi.encode(idx, block.timestamp)), "ipfs://ev") {
            disputeCalls++;
        } catch {}
    }

    /// @notice Acknowledge, claim, and dispute a milestone in a single block so
    ///         the raiseDispute call lands inside the review window (claimedAt ==
    ///         now). Standalone raiseDispute starves because warpTime pushes past
    ///         the 1-7 day window before the depositor's selector is picked; this
    ///         reliably produces DISPUTED milestones for resolve / timeout /
    ///         counterEvidence / disputed-mutualSettle to consume.
    function claimAndDispute(uint256 escrowSeed, uint256 idxSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        address recip = escrow.getEscrow(id).recipient;
        address dep = escrow.getEscrow(id).depositor;
        vm.prank(recip);
        try escrow.acknowledgeInvoice(id) {} catch {}
        vm.prank(recip);
        try escrow.claimDelivery(id, idx) {
            claimCalls++;
        } catch {
            return;
        }
        vm.prank(dep);
        try escrow.raiseDispute(id, idx, "reason", keccak256(abi.encode("d", idx, block.timestamp)), "ipfs://ev") {
            disputeCalls++;
        } catch {}
    }

    function counterEvidence(uint256 escrowSeed, uint256 idxSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        vm.prank(escrow.getEscrow(id).recipient);
        try escrow.submitCounterEvidence(id, idx, keccak256(abi.encode(idx)), "ipfs://counter") {
            counterCalls++;
        } catch {}
    }

    /// @notice Arbiter resolution with a fuzzed, possibly-partial recipient bps.
    ///         A partial bps scales a cross-chain recipient share below the
    ///         forwarding-fee floor and exercises the Finding-3 divert-to-Arc.
    function resolve(uint256 escrowSeed, uint256 idxSeed, uint256 bpsSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        uint256 recipientBps = bound(bpsSeed, 0, 10_000);
        vm.prank(arbiter);
        try escrow.resolveDispute(
            id, idx, recipientBps, keccak256(abi.encode(id, idx, bpsSeed)), "ipfs://res", CCTP_FORWARD_FEE
        ) {
            resolveCalls++;
            if (recipientBps > 0 && recipientBps < 10_000) partialResolveCalls++;
        } catch {}
    }

    /// @notice Depositor instant-release with an at-floor maxFee (the success
    ///         path for the function DR-2 governed).
    function approveRelease(uint256 escrowSeed, uint256 idxSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        vm.prank(escrow.getEscrow(id).depositor);
        try escrow.approveRelease(id, idx, CCTP_FORWARD_FEE) {
            approveCalls++;
        } catch {}
    }

    /// @notice DR-2 catcher. On a cross-chain escrow whose milestone is actually
    ///         IN_REVIEW (so _assertCrossChainFee executes), the depositor passes
    ///         maxFee = snapshot - 1. The fixed floor check MUST revert
    ///         (MaxFeeBelowFloor) for ANY split layout, incl. Arc-leg-first.
    ///         Any success here means the floor was skipped (the DR-2 bug).
    function approveReleaseUnderFloor(uint256 escrowSeed, uint256 idxSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        if (!_isCrossChain(id)) return; // floor only applies cross-chain
        uint256 snap = escrow.getEscrow(id).escrowCctpForwardFee;
        if (snap == 0) return;
        Milestone[] memory ms = escrow.getMilestones(id);
        if (ms[idx].state != MilestoneState.IN_REVIEW) return; // ensure the check actually runs
        underFloorApproveAttempts++;
        vm.prank(escrow.getEscrow(id).depositor);
        try escrow.approveRelease(id, idx, snap - 1) {
            sawUnderFloorApproveSucceeded = true; // must never happen
        } catch {}
    }

    /// @notice Both parties propose the same (possibly partial) bps so the
    ///         settlement executes. Exercises the mutualSettle burn path and its
    ///         snapshot-maxFee substitution; partial bps drives split diverts.
    function mutualSettle(uint256 escrowSeed, uint256 idxSeed, uint256 bpsSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        uint256 bps = bound(bpsSeed, 0, 10_000);
        address dep = escrow.getEscrow(id).depositor;
        address rec = escrow.getEscrow(id).recipient;
        vm.prank(dep);
        try escrow.mutualSettle(id, idx, bps, CCTP_FORWARD_FEE) {} catch {}
        vm.prank(rec);
        try escrow.mutualSettle(id, idx, bps, CCTP_FORWARD_FEE) {
            settleCalls++;
        } catch {}
    }

    function release(uint256 escrowSeed, uint256 idxSeed, uint256 warpSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        vm.warp(block.timestamp + bound(warpSeed, 0, 3 days));
        try escrow.release(id, idx, CCTP_FORWARD_FEE) {
            releaseCalls++;
        } catch {}
    }

    /// @notice 50/50 permissionless timeout settlement of a DISPUTED milestone.
    function resolveByTimeout(uint256 escrowSeed, uint256 idxSeed, uint256 warpSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        // Cross the full ARBITER_WINDOW (14d) in one step so any existing
        // dispute becomes timeout-settleable. Safe now that escrow deadlines are
        // decoupled (far), so a large warp no longer strands claimDelivery.
        vm.warp(block.timestamp + bound(warpSeed, 14 days, 16 days));
        try escrow.resolveDisputeByTimeout(id, idx) {
            timeoutCalls++;
        } catch {}
    }

    function refundAfterDeadline(uint256 escrowSeed, uint256 idxSeed, uint256 warpSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        vm.warp(block.timestamp + bound(warpSeed, 0, 5 days));
        try escrow.refundAfterDeadline(id, idx) {
            refundCalls++;
        } catch {}
    }

    function mutualCancel(uint256 escrowSeed, uint256 actorSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        address[2] memory parties = [escrow.getEscrow(id).depositor, escrow.getEscrow(id).recipient];
        vm.prank(parties[actorSeed % 2]);
        try escrow.mutualCancel(id) {
            cancelCalls++;
        } catch {}
    }

    function proposeMilestoneCancel(uint256 escrowSeed, uint256 idxSeed, uint256 actorSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        address[2] memory parties = [escrow.getEscrow(id).depositor, escrow.getEscrow(id).recipient];
        vm.prank(parties[actorSeed % 2]);
        try escrow.proposeMilestoneCancel(id, idx) {
            milestoneCancelCalls++;
        } catch {}
    }

    function withdrawRefund(uint256 escrowSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        address ref = escrow.getEscrow(id).refundTo;
        vm.prank(ref);
        try escrow.withdrawRefund(ref, 0, address(0), 0) {
            withdrawCalls++;
        } catch {}
    }

    /// @notice Cross-chain withdrawal of refund credit — the DR-1 full-amount
    ///         burn path (burn `amount`, maxFee as cap only).
    function withdrawRefundCrossChain(uint256 escrowSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        address ref = escrow.getEscrow(id).refundTo;
        uint256 bal = escrow.refundBalances(ref);
        if (bal <= CCTP_FORWARD_FEE) return; // need amount > maxFee
        vm.prank(ref);
        try escrow.withdrawRefund(ref, CC_DOMAIN, ref, CCTP_FORWARD_FEE) {
            withdrawCcCalls++;
        } catch {}
    }

    /// @notice Attempt an invoice-URI update. Succeeds pre-ack, reverts
    ///         (InvoiceLocked) post-ack — the freeze invariant proves the latter
    ///         holds over arbitrary sequences.
    function updateURI(uint256 escrowSeed, uint256 uriSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        vm.prank(escrow.getEscrow(id).depositor);
        try escrow.updateInvoiceURI(id, string(abi.encodePacked("ipfs://u", vm.toString(uriSeed)))) {
            uriUpdateCalls++;
        } catch {}
    }

    /// @notice Ghost recorder: milestone monotonicity, ack monotonicity,
    ///         post-ack URI freeze, and escrow-state one-wayness — sampled over
    ///         every escrow each call so no id is missed.
    function recordGhosts() external {
        uint256 n = escrowIds.length;
        for (uint256 j = 0; j < n; j++) {
            uint256 id = escrowIds[j];
            Escrow memory e = escrow.getEscrow(id);

            // Ack monotonicity + post-ack URI freeze.
            if (e.invoiceAcknowledgedAt != 0) {
                if (ackSeen[id]) {
                    if (ackedAt[id] != e.invoiceAcknowledgedAt) sawAckReset = true;
                    if (frozenURIHash[id] != keccak256(bytes(e.invoiceURI))) sawURIChangedAfterAck = true;
                } else {
                    ackSeen[id] = true;
                    ackedAt[id] = e.invoiceAcknowledgedAt;
                    frozenURIHash[id] = keccak256(bytes(e.invoiceURI));
                }
            } else if (ackSeen[id]) {
                sawAckReset = true; // acked -> back to zero
            }

            // Escrow state one-wayness.
            if (escrowStateSeen[id]) {
                EscrowState prev = lastEscrowState[id];
                if ((prev == EscrowState.COMPLETED || prev == EscrowState.CANCELLED) && e.state == EscrowState.ACTIVE) {
                    sawEscrowRevived = true;
                }
            }
            escrowStateSeen[id] = true;
            lastEscrowState[id] = e.state;

            // Milestone-state monotonicity.
            Milestone[] memory ms = escrow.getMilestones(id);
            for (uint256 i = 0; i < ms.length; i++) {
                uint8 cur = uint8(ms[i].state);
                uint8 prev = lastSeenMilestoneState[id][i];
                if (prev == 1) {
                    if (cur != 1 && cur != 2 && cur != 3 && cur != 4) sawBackwardTransition = true;
                } else if (prev == 2) {
                    if (cur != 2 && cur != 3 && cur != 4) sawBackwardTransition = true;
                } else if (prev == 3) {
                    if (cur != 3) sawBackwardTransition = true;
                } else if (prev == 4) {
                    if (cur != 4) sawBackwardTransition = true;
                }
                lastSeenMilestoneState[id][i] = cur;
            }
        }
    }
}

contract TrancheProtocolInvariantTest is StdInvariant, Test, ITrancheProtocol {
    TrancheProtocol internal escrow;
    MockUSDC internal usdc;
    MockTokenMessenger internal tokenMessenger;
    Handler internal handler;

    address internal arbiter = makeAddr("arbiter");
    address internal pauser = makeAddr("pauser");
    address internal domainManager = makeAddr("domainManager");
    address internal protocolTreasury = makeAddr("protocolTreasury");

    uint256 internal constant CCTP_FORWARD_FEE = 100_000;
    uint32 internal constant ARC_DOMAIN = 26;
    uint32 internal constant CC_DOMAIN = 6;

    function setUp() public {
        usdc = new MockUSDC();
        tokenMessenger = new MockTokenMessenger();
        escrow = new TrancheProtocol(
            address(usdc), arbiter, pauser, domainManager, address(tokenMessenger), protocolTreasury
        );
        escrow.setProtocolFee(0);
        vm.startPrank(domainManager);
        escrow.addSupportedDomain(CC_DOMAIN);
        escrow.addSupportedDomain(ARC_DOMAIN); // needed for Arc split legs
        vm.stopPrank();
        escrow.setCctpForwardFee(CCTP_FORWARD_FEE);
        handler = new Handler(escrow, usdc, tokenMessenger, arbiter, pauser);

        bytes4[] memory selectors = new bytes4[](21);
        selectors[0] = Handler.deposit.selector;
        selectors[1] = Handler.depositSplit.selector;
        selectors[2] = Handler.claim.selector;
        selectors[3] = Handler.raiseDispute.selector;
        selectors[4] = Handler.counterEvidence.selector;
        selectors[5] = Handler.resolve.selector;
        selectors[6] = Handler.approveRelease.selector;
        selectors[7] = Handler.approveReleaseUnderFloor.selector;
        selectors[8] = Handler.mutualSettle.selector;
        selectors[9] = Handler.release.selector;
        selectors[10] = Handler.resolveByTimeout.selector;
        selectors[11] = Handler.refundAfterDeadline.selector;
        selectors[12] = Handler.mutualCancel.selector;
        selectors[13] = Handler.proposeMilestoneCancel.selector;
        selectors[14] = Handler.withdrawRefund.selector;
        selectors[15] = Handler.withdrawRefundCrossChain.selector;
        selectors[16] = Handler.updateURI.selector;
        selectors[17] = Handler.recordGhosts.selector;
        selectors[18] = Handler.depositShortDeadline.selector;
        selectors[19] = Handler.warpTime.selector;
        selectors[20] = Handler.claimAndDispute.selector;

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // ----- existing invariants -----

    // Invariant 1: sum of milestone amounts always equals escrow.totalAmount.
    function invariant_MilestoneSumEqualsTotalAmount() public view {
        uint256 n = handler.escrowIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.escrowIds(i);
            Escrow memory e = escrow.getEscrow(id);
            Milestone[] memory ms = escrow.getMilestones(id);
            uint256 sum;
            for (uint256 k = 0; k < ms.length; k++) {
                sum += ms[k].amount;
            }
            assertEq(sum, e.totalAmount, "milestone sum != totalAmount");
        }
    }

    // Invariant 2: contract holds enough USDC for all non-terminal milestones +
    // outstanding refund credits.
    function invariant_Solvency() public view {
        assertGe(usdc.balanceOf(address(escrow)), _owed() + _totalRefunds(), "escrow undercollateralised");
    }

    // Invariant 3: milestone states only progress forward.
    function invariant_MonotonicMilestoneState() public view {
        assertFalse(handler.sawBackwardTransition(), "milestone state went backward");
    }

    // Invariant 4: COMPLETED/CANCELLED escrows have only terminal milestones.
    function invariant_EscrowCompletionConsistent() public view {
        uint256 n = handler.escrowIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.escrowIds(i);
            EscrowState es = escrow.getEscrow(id).state;
            if (es == EscrowState.COMPLETED || es == EscrowState.CANCELLED) {
                Milestone[] memory ms = escrow.getMilestones(id);
                for (uint256 k = 0; k < ms.length; k++) {
                    assertTrue(
                        ms[k].state == MilestoneState.RELEASED || ms[k].state == MilestoneState.REFUNDED,
                        "completed/cancelled escrow has non-terminal milestone"
                    );
                }
            }
        }
    }

    // Invariant 5: sequential ordering -- a non-PENDING milestone i implies i-1
    // is terminal. Mutual cancel sweeps all at once, so skip CANCELLED escrows.
    function invariant_SequentialOrdering() public view {
        uint256 n = handler.escrowIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.escrowIds(i);
            if (escrow.getEscrow(id).state == EscrowState.CANCELLED) continue;
            Milestone[] memory ms = escrow.getMilestones(id);
            for (uint256 k = 1; k < ms.length; k++) {
                MilestoneState cur = ms[k].state;
                if (cur != MilestoneState.PENDING) {
                    assertTrue(
                        ms[k - 1].state == MilestoneState.RELEASED || ms[k - 1].state == MilestoneState.REFUNDED,
                        "milestone advanced before previous reached terminal state"
                    );
                }
            }
        }
    }

    // Invariant 6: refund credits are backed by tokens held in the contract.
    function invariant_RefundBalancesBackedByTokens() public view {
        assertGe(usdc.balanceOf(address(escrow)), _totalRefunds(), "refund balances exceed escrow holdings");
    }

    // ----- Round 6 additions -----

    // Invariant 7 (DR-2 / Finding-3 / H-04 catcher): every recorded CCTP burn is
    // a genuine cross-chain leg strictly above the forwarding-fee floor, with
    // maxFee strictly below the burn amount. A sub-floor burn would mean a leg
    // that should have diverted to Arc instead burned (the bug class DR-2 lives
    // in); maxFee >= amount would mean H-04 was bypassed. The snapshot fee is a
    // constant 100_000 across all escrows (setUp sets it once, never changed).
    function invariant_BurnFloorAndH04() public view {
        uint256 n = tokenMessenger.callsLength();
        for (uint256 i = 0; i < n; i++) {
            (
                ,
                uint256 amount,
                uint32 destinationDomain,
                ,
                ,
                ,
                uint256 maxFee,
                ,
                ,
            ) = tokenMessenger.calls(i);
            assertTrue(destinationDomain != ARC_DOMAIN, "arc leg should never burn through CCTP");
            assertGt(amount, CCTP_FORWARD_FEE, "cross-chain burn at/below forwarding-fee floor");
            assertLt(maxFee, amount, "maxFee >= burn amount (H-04 bypassed)");
        }
    }

    // Invariant 8 (DR-2 floor-check catcher): an under-floor maxFee on a
    // cross-chain escrow's IN_REVIEW milestone must always revert. If it ever
    // succeeded, _assertCrossChainFee skipped the floor for some split layout.
    function invariant_NoUnderFloorApprove() public view {
        assertFalse(handler.sawUnderFloorApproveSucceeded(), "under-floor approve succeeded on a cross-chain escrow");
    }

    // Invariant 9 (SE-1 / ack monotonicity): invoiceAcknowledgedAt, once set,
    // never changes or resets to zero.
    function invariant_AckMonotonic() public view {
        assertFalse(handler.sawAckReset(), "invoiceAcknowledgedAt was reset/changed");
    }

    // Invariant 10 (SE-1 as a global invariant): once acknowledged, invoiceURI
    // is frozen over any subsequent call sequence.
    function invariant_URIFrozenAfterAck() public view {
        assertFalse(handler.sawURIChangedAfterAck(), "invoiceURI changed after acknowledgment");
    }

    // Invariant 11: a terminal escrow never returns to ACTIVE.
    function invariant_EscrowStateOneWay() public view {
        assertFalse(handler.sawEscrowRevived(), "terminal escrow returned to ACTIVE");
    }

    // Invariant 12 (split/bps integrity): configured split bps always sum to
    // exactly 10_000 — no rounding drift in the distribution loop.
    function invariant_SplitBpsSum() public view {
        uint256 n = handler.escrowIdsLength();
        for (uint256 i = 0; i < n; i++) {
            SplitRecipient[] memory sp = escrow.getSplits(handler.escrowIds(i));
            if (sp.length == 0) continue;
            uint256 sum;
            for (uint256 k = 0; k < sp.length; k++) {
                sum += sp[k].bps;
            }
            assertEq(sum, 10_000, "split bps do not sum to 10000");
        }
    }

    // Invariant 13 (strong conservation): with protocol fee 0 and no external
    // donation, the contract holds EXACTLY the still-locked milestone amounts
    // plus all outstanding refund credits. Cross-chain burns leave via the
    // messenger; Arc legs leave via direct transfer; everything else stays.
    // Equality (not >=) proves no value was minted or destroyed — a divert moves
    // money sideways into refund credits, never creating or burning it.
    function invariant_StrongConservation() public view {
        assertEq(usdc.balanceOf(address(escrow)), _owed() + _totalRefunds(), "value created or destroyed");
    }

    // ----- helpers -----

    function _owed() internal view returns (uint256 owed) {
        uint256 n = handler.escrowIdsLength();
        for (uint256 i = 0; i < n; i++) {
            Milestone[] memory ms = escrow.getMilestones(handler.escrowIds(i));
            for (uint256 k = 0; k < ms.length; k++) {
                MilestoneState s = ms[k].state;
                if (s == MilestoneState.PENDING || s == MilestoneState.IN_REVIEW || s == MilestoneState.DISPUTED) {
                    owed += ms[k].amount;
                }
            }
        }
    }

    function _totalRefunds() internal view returns (uint256 total) {
        for (uint256 i = 0; i < 4; i++) {
            total += escrow.refundBalances(handler.actors(i));
        }
    }

    /// @dev Surfaces reached-state counters after each invariant run so a green
    ///      result can be proven non-vacuous (handlers use try/catch with
    ///      fail_on_revert=false, so reachability must be demonstrated, not
    ///      assumed).
    function afterInvariant() external view {
        console.log("== reached-state counters ==");
        console.log("deposit(single):    ", handler.depositCalls());
        console.log("deposit(split):     ", handler.splitDepositCalls());
        console.log("deposit(short):     ", handler.shortDepositCalls());
        console.log("warpTime:           ", handler.warpCalls());
        console.log("claim:              ", handler.claimCalls());
        console.log("raiseDispute:       ", handler.disputeCalls());
        console.log("counterEvidence:    ", handler.counterCalls());
        console.log("resolve(any):       ", handler.resolveCalls());
        console.log("resolve(partial):   ", handler.partialResolveCalls());
        console.log("approveRelease:     ", handler.approveCalls());
        console.log("underFloorAttempts: ", handler.underFloorApproveAttempts());
        console.log("mutualSettle:       ", handler.settleCalls());
        console.log("resolveByTimeout:   ", handler.timeoutCalls());
        console.log("release:            ", handler.releaseCalls());
        console.log("refundAfterDeadline:", handler.refundCalls());
        console.log("mutualCancel:       ", handler.cancelCalls());
        console.log("milestoneCancel:    ", handler.milestoneCancelCalls());
        console.log("withdraw(arc):      ", handler.withdrawCalls());
        console.log("withdraw(crosschain)", handler.withdrawCcCalls());
        console.log("updateURI(ok):      ", handler.uriUpdateCalls());
        console.log("cctp burns recorded:", tokenMessenger.callsLength());
    }
}

/// @notice Enumerated dead-wallet matrix (no-stuck-funds). Each test pins one
///         (state x unreachable-party) cell and proves a permissionless or
///         recovery exit can still move the money. Deterministic by design —
///         far more reliable than hoping the fuzzer reaches a stuck state.
contract TrancheProtocolDeadWalletTest is Test, ITrancheProtocol {
    TrancheProtocol internal escrow;
    MockUSDC internal usdc;
    MockTokenMessenger internal tokenMessenger;

    address internal arbiter = makeAddr("arbiter");
    address internal pauser = makeAddr("pauser");
    address internal domainManager = makeAddr("domainManager");
    address internal protocolTreasury = makeAddr("protocolTreasury");
    address internal recovery; // this contract holds RECOVERY_MANAGER_ROLE (deployer)

    address internal payer = makeAddr("payer");
    address internal worker = makeAddr("worker");
    address internal stranger = makeAddr("stranger"); // arbitrary permissionless caller
    uint32 internal constant ARC_DOMAIN = 26;

    function setUp() public {
        usdc = new MockUSDC();
        tokenMessenger = new MockTokenMessenger();
        escrow = new TrancheProtocol(
            address(usdc), arbiter, pauser, domainManager, address(tokenMessenger), protocolTreasury
        );
        escrow.setProtocolFee(0);
        vm.prank(domainManager);
        escrow.addSupportedDomain(ARC_DOMAIN);
        usdc.mint(payer, 1_000_000e6);
    }

    function _createArcEscrow(uint256 amount, uint256 reviewWindow) internal returns (uint256 id) {
        uint256[] memory ms = new uint256[](1);
        ms[0] = amount;
        vm.startPrank(payer);
        usdc.approve(address(escrow), amount);
        id = escrow.deposit(
            worker,
            payer,
            amount,
            ARC_DOMAIN,
            bytes32(uint256(uint160(worker))),
            reviewWindow,
            keccak256(abi.encode("dw", amount)),
            "ipfs://dw",
            ms,
            block.timestamp + 30 days,
            new SplitRecipient[](0),
            ""
        );
        vm.stopPrank();
    }

    // Cell: IN_REVIEW milestone, depositor unreachable -> anyone can release()
    // once the review window lapses (silence = consent).
    function test_DeadDepositor_InReviewReleasable() public {
        uint256 id = _createArcEscrow(100e6, 1 days);
        vm.prank(worker);
        escrow.acknowledgeInvoice(id);
        vm.prank(worker);
        escrow.claimDelivery(id, 0);
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(stranger); // depositor never acts
        escrow.release(id, 0, 0);
        assertEq(uint8(escrow.getMilestones(id)[0].state), uint8(MilestoneState.RELEASED));
        assertEq(usdc.balanceOf(worker), 100e6);
    }

    // Cell: PENDING milestone, recipient unreachable, deadline passed -> anyone
    // can refundAfterDeadline() once the grace period elapses.
    function test_DeadWorker_PendingRefundableAfterDeadline() public {
        uint256 id = _createArcEscrow(100e6, 1 days);
        // worker never claims; warp past deadline + 72h grace.
        vm.warp(block.timestamp + 30 days + 72 hours + 1);
        vm.prank(stranger);
        escrow.refundAfterDeadline(id, 0);
        assertEq(uint8(escrow.getMilestones(id)[0].state), uint8(MilestoneState.REFUNDED));
        assertEq(escrow.refundBalances(payer), 100e6);
    }

    // Cell: DISPUTED milestone, arbiter unreachable -> anyone can settle 50/50
    // once the arbiter window lapses.
    function test_DeadArbiter_DisputedSettlesByTimeout() public {
        uint256 id = _createArcEscrow(100e6, 1 days);
        vm.prank(worker);
        escrow.acknowledgeInvoice(id);
        vm.prank(worker);
        escrow.claimDelivery(id, 0);
        vm.prank(payer);
        escrow.raiseDispute(id, 0, "bad", keccak256("ev"), "ipfs://ev");
        vm.warp(block.timestamp + 14 days + 1);
        vm.prank(stranger); // arbiter never rules
        escrow.resolveDisputeByTimeout(id, 0);
        assertEq(uint8(escrow.getMilestones(id)[0].state), uint8(MilestoneState.REFUNDED));
        // 50/50: half to worker credit, half to payer credit.
        assertEq(escrow.refundBalances(worker), 50e6);
        assertEq(escrow.refundBalances(payer), 50e6);
    }

    // Cell: refund credit stranded on an unreachable wallet -> RECOVERY_MANAGER
    // proposes, the nominee self-claims (two-step recovery).
    function test_DeadCreditHolder_RecoverableTwoStep() public {
        uint256 id = _createArcEscrow(100e6, 1 days);
        vm.warp(block.timestamp + 30 days + 72 hours + 1);
        vm.prank(stranger);
        escrow.refundAfterDeadline(id, 0);
        assertEq(escrow.refundBalances(payer), 100e6);

        address rescueWallet = makeAddr("rescueWallet");
        // This test contract is the deployer and holds RECOVERY_MANAGER_ROLE.
        escrow.proposeRefundCreditTransfer(payer, rescueWallet);
        vm.prank(rescueWallet);
        escrow.claimRefundCreditTransfer(payer);
        assertEq(escrow.refundBalances(payer), 0);
        assertEq(escrow.refundBalances(rescueWallet), 100e6);
    }
}
