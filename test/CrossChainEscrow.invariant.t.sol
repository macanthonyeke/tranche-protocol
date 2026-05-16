// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {CrossChainEscrow} from "../src/CrossChainEscrow.sol";
import {ICrossChainEscrow} from "../src/interface/ICrossChainEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockTokenMessenger} from "./mocks/MockTokenMessenger.sol";

/// @notice Bounded actor handler used for invariant fuzzing.
contract Handler is Test, ICrossChainEscrow {
    CrossChainEscrow public escrow;
    MockUSDC public usdc;
    MockTokenMessenger public tokenMessenger;

    address public arbiter;
    address public pauser;
    address[] public actors;
    uint256[] public escrowIds;

    // Mirrors the value the invariant runner seeds via setCctpForwardFee; the
    // handler passes this when calling releaseAfterWindow so the cross-chain
    // maxFee floor is cleared.
    uint256 internal constant CCTP_FORWARD_FEE = 100_000;

    // Track historical milestone states to validate monotonic forward-only progression.
    mapping(uint256 => mapping(uint256 => uint8)) public lastSeenMilestoneState;
    bool public sawBackwardTransition;

    // Track sums per escrow for the "sum of milestones == totalAmount" invariant
    // and for solvency. These are computed lazily from contract state during invariants.

    // Stats
    uint256 public depositCalls;
    uint256 public fulfillCalls;
    uint256 public disputeCalls;
    uint256 public counterCalls;
    uint256 public resolveCalls;
    uint256 public releaseCalls;
    uint256 public cancelCalls;
    uint256 public withdrawCalls;

    constructor(CrossChainEscrow _escrow, MockUSDC _usdc, MockTokenMessenger _tm, address _arbiter, address _pauser) {
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

    function deposit(uint256 actorSeed, uint256 m1, uint256 m2, uint256 m3, uint256 disputeWindow) external {
        address actor = _pickActor(actorSeed);
        m1 = bound(m1, 1, 1_000e6);
        m2 = bound(m2, 1, 1_000e6);
        m3 = bound(m3, 1, 1_000e6);
        disputeWindow = bound(disputeWindow, 1 hours, 14 days);
        uint256[] memory ms = new uint256[](3);
        ms[0] = m1;
        ms[1] = m2;
        ms[2] = m3;
        uint256 total = m1 + m2 + m3;

        if (usdc.balanceOf(actor) < total) {
            usdc.mint(actor, total);
        }

        address rec = actors[(actorSeed + 1) % actors.length];
        vm.startPrank(actor);
        usdc.approve(address(escrow), total);
        try escrow.deposit(
            rec,
            actor, // refundTo = depositor
            total,
            6,
            bytes32(uint256(uint160(rec))),
            disputeWindow,
            3 days, // deliveryNoticeWindow
            keccak256(abi.encode(actor, total, block.timestamp)),
            "ipfs://invoice",
            ms,
            block.timestamp + 30 days,
            new SplitRecipient[](0)
        ) returns (
            uint256 id
        ) {
            escrowIds.push(id);
            depositCalls++;
        } catch {}
        vm.stopPrank();
    }

    function fulfill(uint256 escrowSeed, uint256 idxSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = _getMilestoneCount(id);
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        // Skip non-PENDING milestones to model intended state machine. A separate
        // adversarial test (test_FINDING_*) explicitly exercises the contract's
        // missing current-state guard.
        if (_getMilestoneStateRaw(id, idx) != MilestoneState.PENDING) return;
        address dep = _getDepositor(id);
        vm.prank(dep);
        try escrow.fulfillCondition(id, idx) {
            fulfillCalls++;
        } catch {}
    }

    function raiseDispute(uint256 escrowSeed, uint256 idxSeed, uint256 actorSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = _getMilestoneCount(id);
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        address[2] memory parties = [_getDepositor(id), _getRecipient(id)];
        address who = parties[actorSeed % 2];
        vm.prank(who);
        try escrow.raiseDispute(id, idx, "reason", keccak256(abi.encode(idx, who, block.timestamp)), "ipfs://ev") {
            disputeCalls++;
        } catch {}
    }

    function counterEvidence(uint256 escrowSeed, uint256 idxSeed, uint256 actorSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = _getMilestoneCount(id);
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        address[2] memory parties = [_getDepositor(id), _getRecipient(id)];
        address who = parties[actorSeed % 2];
        vm.prank(who);
        try escrow.submitCounterEvidence(id, idx, keccak256(abi.encode(idx, who)), "ipfs://counter") {
            counterCalls++;
        } catch {}
    }

    function resolve(uint256 escrowSeed, uint256 idxSeed, bool releaseToRecipient) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = _getMilestoneCount(id);
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        vm.prank(arbiter);
        try escrow.resolveDispute(id, idx, releaseToRecipient, keccak256(abi.encode(id, idx, releaseToRecipient)), 0) {
            resolveCalls++;
        } catch {}
    }

    function releaseAfterWindow(uint256 escrowSeed, uint256 idxSeed, uint256 warpSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = _getMilestoneCount(id);
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        // Optionally warp forward to make the window expire.
        uint256 warpAmt = bound(warpSeed, 0, 35 days);
        vm.warp(block.timestamp + warpAmt);
        try escrow.releaseAfterWindow(id, idx, CCTP_FORWARD_FEE) {
            releaseCalls++;
        } catch {}
    }

    function mutualCancel(uint256 escrowSeed, uint256 actorSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        address[2] memory parties = [_getDepositor(id), _getRecipient(id)];
        address who = parties[actorSeed % 2];
        vm.prank(who);
        try escrow.mutualCancel(id) {
            cancelCalls++;
        } catch {}
    }

    function withdrawRefund(uint256 escrowSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        address ref = _getRefundTo(id);
        vm.prank(ref);
        try escrow.withdrawRefund(ref) {
            withdrawCalls++;
        } catch {}
    }

    function recordMonotonic(uint256 escrowSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = _getMilestoneCount(id);
        for (uint256 i = 0; i < count; i++) {
            uint8 cur = uint8(_getMilestoneStateRaw(id, i));
            uint8 prev = lastSeenMilestoneState[id][i];
            // valid forward transitions:
            // PENDING(0) -> FULFILLED(1) -> {DISPUTED(2), RELEASED(3)}
            // DISPUTED(2) -> {RELEASED(3), REFUNDED(4)}
            // PENDING(0) -> REFUNDED(4) (mutual cancel)
            // FULFILLED(1) -> REFUNDED(4) (mutual cancel)
            if (prev == 0) {
                // any forward state is OK
            } else if (prev == 1) {
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

    // ---------- view helpers ----------
    function _getMilestoneCount(uint256 id) internal view returns (uint256 c) {
        (,,,,,,,,,,,, c,,) = escrow.escrows(id);
    }

    function _getDepositor(uint256 id) internal view returns (address d) {
        (d,,,,,,,,,,,,,,) = escrow.escrows(id);
    }

    function _getRecipient(uint256 id) internal view returns (address r) {
        (, r,,,,,,,,,,,,,) = escrow.escrows(id);
    }

    function _getRefundTo(uint256 id) internal view returns (address r) {
        (,, r,,,,,,,,,,,,) = escrow.escrows(id);
    }

    function _getMilestoneStateRaw(uint256 id, uint256 idx) internal view returns (MilestoneState s) {
        (,, s,) = escrow.milestones(id, idx);
    }
}

contract CrossChainEscrowInvariantTest is StdInvariant, Test, ICrossChainEscrow {
    CrossChainEscrow internal escrow;
    MockUSDC internal usdc;
    MockTokenMessenger internal tokenMessenger;
    Handler internal handler;

    address internal arbiter = makeAddr("arbiter");
    address internal pauser = makeAddr("pauser");
    address internal domainManager = makeAddr("domainManager");
    address internal protocolTreasury = makeAddr("protocolTreasury");

    function setUp() public {
        usdc = new MockUSDC();
        tokenMessenger = new MockTokenMessenger();
        escrow = new CrossChainEscrow(
            address(usdc), arbiter, pauser, domainManager, address(tokenMessenger), protocolTreasury
        );
        // Disable fee + register the domain used by the handler so deposits succeed.
        escrow.setProtocolFee(0);
        vm.prank(domainManager);
        escrow.addSupportedDomain(6);
        escrow.setCctpForwardFee(100_000); // 0.1 USDC forwarding fee
        handler = new Handler(escrow, usdc, tokenMessenger, arbiter, pauser);

        bytes4[] memory selectors = new bytes4[](9);
        selectors[0] = Handler.deposit.selector;
        selectors[1] = Handler.fulfill.selector;
        selectors[2] = Handler.raiseDispute.selector;
        selectors[3] = Handler.counterEvidence.selector;
        selectors[4] = Handler.resolve.selector;
        selectors[5] = Handler.releaseAfterWindow.selector;
        selectors[6] = Handler.mutualCancel.selector;
        selectors[7] = Handler.withdrawRefund.selector;
        selectors[8] = Handler.recordMonotonic.selector;

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    // -------------------------------------------------------------------------
    // Invariant 1: sum of milestone amounts always equals escrow.totalAmount
    // -------------------------------------------------------------------------
    function invariant_MilestoneSumEqualsTotalAmount() public view {
        uint256 n = handler.escrowIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.escrowIds(i);
            (,,, uint256 total,,,,,,,,, uint256 count,,) = escrow.escrows(id);
            uint256 sum;
            for (uint256 k = 0; k < count; k++) {
                (uint256 amt,,,) = escrow.milestones(id, k);
                sum += amt;
            }
            assertEq(sum, total, "milestone sum != totalAmount");
        }
    }

    // -------------------------------------------------------------------------
    // Invariant 2: contract USDC balance >= sum of all PENDING/FULFILLED/DISPUTED
    // milestones across active escrows + pending refundBalances
    // -------------------------------------------------------------------------
    function invariant_Solvency() public view {
        uint256 n = handler.escrowIdsLength();
        uint256 owed;
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.escrowIds(i);
            (,,,,,,,,,,,, uint256 count,,) = escrow.escrows(id);
            for (uint256 k = 0; k < count; k++) {
                (uint256 amt,, MilestoneState s,) = escrow.milestones(id, k);
                if (s == MilestoneState.PENDING || s == MilestoneState.FULFILLED || s == MilestoneState.DISPUTED) {
                    owed += amt;
                } else if (s == MilestoneState.REFUNDED) {
                    // funds remain in contract until refund withdrawn; refundBalances tracks them
                    // accounted for separately below
                }
            }
        }
        // Sum tracked refund balances for the actor pool + canonical refund recipients we know of
        // Use a generous superset: scan all known actors from the handler.
        uint256 totalRefund;
        for (uint256 i = 0; i < 4; i++) {
            address actor = handler.actors(i);
            totalRefund += escrow.refundBalances(actor);
        }

        assertGe(usdc.balanceOf(address(escrow)), owed + totalRefund, "escrow undercollateralised");
    }

    // -------------------------------------------------------------------------
    // Invariant 3: milestone states only progress forward
    // -------------------------------------------------------------------------
    function invariant_MonotonicMilestoneState() public view {
        assertFalse(handler.sawBackwardTransition(), "milestone state went backward");
    }

    // -------------------------------------------------------------------------
    // Invariant 4: escrow is COMPLETED only when all milestones are RELEASED or REFUNDED.
    // CANCELLED implies all milestones REFUNDED or already RELEASED before cancel.
    // -------------------------------------------------------------------------
    function invariant_EscrowCompletionConsistent() public view {
        uint256 n = handler.escrowIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.escrowIds(i);
            (,,,,,,,,,,,, uint256 count, EscrowState es,) = escrow.escrows(id);
            if (es == EscrowState.COMPLETED || es == EscrowState.CANCELLED) {
                for (uint256 k = 0; k < count; k++) {
                    (,, MilestoneState s,) = escrow.milestones(id, k);
                    assertTrue(
                        s == MilestoneState.RELEASED || s == MilestoneState.REFUNDED,
                        "completed/cancelled escrow has non-terminal milestone"
                    );
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Invariant 5: sequential ordering -- if milestone i is FULFILLED, DISPUTED,
    // RELEASED, or REFUNDED-via-arbiter, then milestone i-1 must already be
    // RELEASED or REFUNDED (terminal). REFUNDED-via-mutual-cancel can violate
    // this since mutual cancel sweeps all non-terminal milestones at once;
    // we therefore exclude CANCELLED escrows from the check.
    // -------------------------------------------------------------------------
    function invariant_SequentialOrdering() public view {
        uint256 n = handler.escrowIdsLength();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = handler.escrowIds(i);
            (,,,,,,,,,,,, uint256 count, EscrowState es,) = escrow.escrows(id);
            if (es == EscrowState.CANCELLED) continue;
            for (uint256 k = 1; k < count; k++) {
                (,, MilestoneState cur,) = escrow.milestones(id, k);
                if (
                    cur == MilestoneState.FULFILLED || cur == MilestoneState.DISPUTED || cur == MilestoneState.RELEASED
                        || cur == MilestoneState.REFUNDED
                ) {
                    (,, MilestoneState prev,) = escrow.milestones(id, k - 1);
                    assertTrue(
                        prev == MilestoneState.RELEASED || prev == MilestoneState.REFUNDED,
                        "milestone advanced before previous reached terminal state"
                    );
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Invariant 6: refundBalances for any address can only grow until withdrawn,
    // and a withdraw zeroes it. We can't observe transitions easily without
    // a snapshot, so check the simpler property: total escrow balance >= sum of refundBalances.
    // -------------------------------------------------------------------------
    function invariant_RefundBalancesBackedByTokens() public view {
        uint256 sumRefunds;
        for (uint256 i = 0; i < 4; i++) {
            sumRefunds += escrow.refundBalances(handler.actors(i));
        }
        assertGe(usdc.balanceOf(address(escrow)), sumRefunds, "refund balances exceed escrow holdings");
    }
}
