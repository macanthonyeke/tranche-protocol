// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {TrancheProtocol} from "../src/TrancheProtocol.sol";
import {ITrancheProtocol} from "../src/interface/ITrancheProtocol.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockTokenMessenger} from "./mocks/MockTokenMessenger.sol";

/// @notice Bounded actor handler for the redesigned lifecycle.
contract Handler is Test, ITrancheProtocol {
    TrancheProtocol public escrow;
    MockUSDC public usdc;
    MockTokenMessenger public tokenMessenger;

    address public arbiter;
    address public pauser;
    address[] public actors;
    uint256[] public escrowIds;

    uint256 internal constant CCTP_FORWARD_FEE = 100_000;

    mapping(uint256 => mapping(uint256 => uint8)) public lastSeenMilestoneState;
    bool public sawBackwardTransition;

    uint256 public depositCalls;
    uint256 public claimCalls;
    uint256 public disputeCalls;
    uint256 public counterCalls;
    uint256 public resolveCalls;
    uint256 public releaseCalls;
    uint256 public refundCalls;
    uint256 public cancelCalls;
    uint256 public milestoneCancelCalls;
    uint256 public withdrawCalls;

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
            6,
            bytes32(uint256(uint160(rec))),
            reviewWindow,
            keccak256(abi.encode(actor, total, block.timestamp)),
            "ipfs://invoice",
            ms,
            block.timestamp + 30 days,
            new SplitRecipient[](0)
        ) returns (uint256 id) {
            escrowIds.push(id);
            depositCalls++;
        } catch {}
        vm.stopPrank();
    }

    function claim(uint256 escrowSeed, uint256 idxSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        vm.prank(escrow.getEscrow(id).recipient);
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

    function resolve(uint256 escrowSeed, uint256 idxSeed, bool releaseToRecipient) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        vm.prank(arbiter);
        uint256 recipientBps = releaseToRecipient ? 10_000 : 0;
        try escrow.resolveDispute(
            id, idx, recipientBps, keccak256(abi.encode(id, idx, releaseToRecipient)), "ipfs://res", CCTP_FORWARD_FEE
        ) {
            resolveCalls++;
        } catch {}
    }

    function release(uint256 escrowSeed, uint256 idxSeed, uint256 warpSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        vm.warp(block.timestamp + bound(warpSeed, 0, 10 days));
        try escrow.release(id, idx, CCTP_FORWARD_FEE) {
            releaseCalls++;
        } catch {}
    }

    function refundAfterDeadline(uint256 escrowSeed, uint256 idxSeed, uint256 warpSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        uint256 count = escrow.getEscrow(id).milestoneCount;
        if (count == 0) return;
        uint256 idx = idxSeed % count;
        vm.warp(block.timestamp + bound(warpSeed, 0, 40 days));
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
        try escrow.withdrawRefund(ref) {
            withdrawCalls++;
        } catch {}
    }

    function recordMonotonic(uint256 escrowSeed) external {
        (uint256 id, bool ok) = _pickEscrow(escrowSeed);
        if (!ok) return;
        Milestone[] memory ms = escrow.getMilestones(id);
        for (uint256 i = 0; i < ms.length; i++) {
            // PENDING(0) -> IN_REVIEW(1) -> {DISPUTED(2), RELEASED(3)}
            // IN_REVIEW(1)/PENDING(0) -> REFUNDED(4); DISPUTED(2) -> {RELEASED(3), REFUNDED(4)}
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

contract TrancheProtocolInvariantTest is StdInvariant, Test, ITrancheProtocol {
    TrancheProtocol internal escrow;
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
        escrow = new TrancheProtocol(
            address(usdc), arbiter, pauser, domainManager, address(tokenMessenger), protocolTreasury
        );
        escrow.setProtocolFee(0);
        vm.prank(domainManager);
        escrow.addSupportedDomain(6);
        escrow.setCctpForwardFee(100_000);
        handler = new Handler(escrow, usdc, tokenMessenger, arbiter, pauser);

        bytes4[] memory selectors = new bytes4[](11);
        selectors[0] = Handler.deposit.selector;
        selectors[1] = Handler.claim.selector;
        selectors[2] = Handler.raiseDispute.selector;
        selectors[3] = Handler.counterEvidence.selector;
        selectors[4] = Handler.resolve.selector;
        selectors[5] = Handler.release.selector;
        selectors[6] = Handler.refundAfterDeadline.selector;
        selectors[7] = Handler.mutualCancel.selector;
        selectors[8] = Handler.withdrawRefund.selector;
        selectors[9] = Handler.recordMonotonic.selector;
        selectors[10] = Handler.proposeMilestoneCancel.selector;

        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

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
        uint256 n = handler.escrowIdsLength();
        uint256 owed;
        for (uint256 i = 0; i < n; i++) {
            Milestone[] memory ms = escrow.getMilestones(handler.escrowIds(i));
            for (uint256 k = 0; k < ms.length; k++) {
                MilestoneState s = ms[k].state;
                if (s == MilestoneState.PENDING || s == MilestoneState.IN_REVIEW || s == MilestoneState.DISPUTED) {
                    owed += ms[k].amount;
                }
            }
        }
        uint256 totalRefund;
        for (uint256 i = 0; i < 4; i++) {
            totalRefund += escrow.refundBalances(handler.actors(i));
        }
        assertGe(usdc.balanceOf(address(escrow)), owed + totalRefund, "escrow undercollateralised");
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
        uint256 sumRefunds;
        for (uint256 i = 0; i < 4; i++) {
            sumRefunds += escrow.refundBalances(handler.actors(i));
        }
        assertGe(usdc.balanceOf(address(escrow)), sumRefunds, "refund balances exceed escrow holdings");
    }
}
