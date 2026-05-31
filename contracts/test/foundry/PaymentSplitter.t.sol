// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../src/PaymentSplitter.sol";
import "../../src/test/ReentrancyAttacker.sol";

contract PaymentSplitterFuzzTest is Test {
    PaymentSplitter splitter;
    address admin    = address(0xA0);
    address depositor = address(0xD0);

    bytes32 constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

    function setUp() public {
        vm.startPrank(admin);
        splitter = new PaymentSplitter(admin);
        splitter.grantRole(DEPOSITOR_ROLE, depositor);
        vm.stopPrank();

        // Fund depositor with plenty of ETH
        vm.deal(depositor, 1_000_000 ether);
    }

    // ─── Fuzz: arbitrary 2-receiver deposit ───────────────────────────────────

    /// @notice Invariant for a single deposit: sum(balances) == contract balance
    function testFuzz_depositInvariant(
        address r1,
        address r2,
        uint96  a1,
        uint96  a2
    ) public {
        // Avoid zero amounts and collision with zero address / precompiles
        vm.assume(r1 != address(0) && r2 != address(0));
        vm.assume(r1 != r2);
        vm.assume(uint256(a1) + uint256(a2) > 0);
        vm.assume(uint256(a1) + uint256(a2) <= 100 ether);

        address[] memory receivers = new address[](2);
        receivers[0] = r1;
        receivers[1] = r2;

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = uint256(a1);
        amounts[1] = uint256(a2);
        uint256 total = amounts[0] + amounts[1];

        vm.prank(depositor);
        splitter.deposit{value: total}(receivers, amounts);

        // Invariant: each balance credited correctly
        assertEq(splitter.balances(r1), a1, "r1 balance wrong");
        assertEq(splitter.balances(r2), a2, "r2 balance wrong");
        // Invariant: contract holds exactly the deposited ETH
        assertEq(address(splitter).balance, total, "contract balance wrong");
    }

    // ─── Fuzz: sum mismatch always reverts ────────────────────────────────────

    function testFuzz_depositRevertsOnValueMismatch(
        uint96 amount,
        uint96 sentExtra
    ) public {
        vm.assume(amount > 0);
        vm.assume(sentExtra > 0);

        address[] memory receivers = new address[](1);
        receivers[0] = address(0xBEEF);
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        // Send more than required
        vm.prank(depositor);
        vm.expectRevert();
        splitter.deposit{value: uint256(amount) + uint256(sentExtra)}(receivers, amounts);
    }

    // ─── Fuzz: claim preserves ETH conservation ───────────────────────────────

    function testFuzz_claimConservesEth(
        address recipient,
        uint96  amount
    ) public {
        vm.assume(recipient != address(0));
        vm.assume(amount > 0 && amount <= 100 ether);
        // Avoid precompiles and system addresses
        vm.assume(uint160(recipient) > 10);
        vm.assume(recipient.code.length == 0);

        address[] memory receivers = new address[](1);
        receivers[0] = recipient;
        uint256[] memory amounts   = new uint256[](1);
        amounts[0] = amount;

        vm.prank(depositor);
        splitter.deposit{value: amount}(receivers, amounts);

        uint256 beforeRecipient = recipient.balance;
        uint256 beforeContract  = address(splitter).balance;

        vm.prank(recipient);
        splitter.claim();

        // Recipient gained exactly `amount`
        assertEq(recipient.balance, beforeRecipient + amount, "recipient ETH mismatch");
        // Contract lost exactly `amount`
        assertEq(address(splitter).balance, beforeContract - amount, "contract ETH mismatch");
        // Balance mapping zeroed
        assertEq(splitter.balances(recipient), 0, "balance not zeroed");
    }

    // ─── Reentrancy attack: cannot drain beyond own balance ───────────────────

    function test_reentrancyCannotDrain() public {
        ReentrancyAttacker attacker = new ReentrancyAttacker(address(splitter));

        address victim = address(0xBEEF);
        uint256 victimAmt   = 1 ether;
        uint256 attackerAmt = 0.1 ether;

        address[] memory receivers = new address[](2);
        receivers[0] = victim;
        receivers[1] = address(attacker);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = victimAmt;
        amounts[1] = attackerAmt;

        vm.prank(depositor);
        splitter.deposit{value: victimAmt + attackerAmt}(receivers, amounts);

        // Attacker tries to reenter — outer claim should still succeed
        // but nested claim() calls must revert due to ReentrancyGuard
        attacker.attack();

        // Attacker received exactly its share — no more
        assertEq(address(attacker).balance, attackerAmt, "attacker drained extra ETH");
        // Victim's balance is intact
        assertEq(splitter.balances(victim), victimAmt, "victim balance stolen");
        // Contract still holds victim's share
        assertEq(address(splitter).balance, victimAmt, "contract balance wrong");
    }
}

// ─── Invariant test ───────────────────────────────────────────────────────────

contract PaymentSplitterInvariantTest is Test {
    PaymentSplitter splitter;
    PaymentSplitterHandler handler;

    function setUp() public {
        address admin     = address(0xA0);
        address depositor = address(0xD0);

        vm.startPrank(admin);
        splitter = new PaymentSplitter(admin);
        splitter.grantRole(keccak256("DEPOSITOR_ROLE"), depositor);
        vm.stopPrank();

        handler = new PaymentSplitterHandler(splitter, depositor);
        vm.deal(address(handler), 1_000_000 ether);

        // Only fuzz through the handler
        targetContract(address(handler));
    }

    /// @notice core invariant: sum of all tracked balances == contract ETH balance
    function invariant_balanceSumEqualsContractBalance() public view {
        assertEq(
            handler.totalDeposited() - handler.totalClaimed(),
            address(splitter).balance,
            "sum(balances) != contract.balance"
        );
    }
}

/// @dev Handler drives deposit/claim calls and tracks totals for the invariant.
contract PaymentSplitterHandler is Test {
    PaymentSplitter public splitter;
    address         public depositor;

    uint256 public totalDeposited;
    uint256 public totalClaimed;

    // Track addresses that have received deposits so we can call claim on them
    address[] public recipients;
    mapping(address => bool) public isRecipient;

    constructor(PaymentSplitter _splitter, address _depositor) {
        splitter  = _splitter;
        depositor = _depositor;
    }

    function deposit(address recipient, uint96 amount) external {
        vm.assume(recipient != address(0));
        vm.assume(uint160(recipient) > 10);
        vm.assume(amount > 0 && amount <= 10 ether);

        address[] memory receivers = new address[](1);
        receivers[0] = recipient;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        vm.prank(depositor);
        splitter.deposit{value: amount}(receivers, amounts);

        totalDeposited += amount;

        if (!isRecipient[recipient]) {
            isRecipient[recipient] = true;
            recipients.push(recipient);
        }
    }

    function claim(uint256 recipientIndex) external {
        if (recipients.length == 0) return;
        address recipient = recipients[recipientIndex % recipients.length];
        uint256 bal = splitter.balances(recipient);
        if (bal == 0) return;

        // Give the recipient an empty code slot so ETH transfer succeeds
        vm.assume(recipient.code.length == 0);

        vm.prank(recipient);
        splitter.claim();

        totalClaimed += bal;
    }
}
