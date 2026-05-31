import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { PaymentSplitter } from "../../typechain-types";

describe("PaymentSplitter", function () {
  let splitter: PaymentSplitter;
  let admin: HardhatEthersSigner;
  let depositor: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;

  const DEPOSITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSITOR_ROLE"));

  beforeEach(async function () {
    [admin, depositor, alice, bob, carol] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("PaymentSplitter");
    splitter = await factory.deploy(admin.address) as PaymentSplitter;
    await splitter.waitForDeployment();
    // Grant depositor role
    await splitter.connect(admin).grantRole(DEPOSITOR_ROLE, depositor.address);
  });

  // ─── Access control ───────────────────────────────────────────────────────

  describe("deposit — access control", function () {
    it("reverts for non-depositor", async function () {
      const v = ethers.parseEther("0.1");
      await expect(
        splitter.connect(alice).deposit([alice.address], [v], { value: v })
      ).to.be.revertedWithCustomError(splitter, "AccessControlUnauthorizedAccount");
    });

    it("succeeds for DEPOSITOR_ROLE holder", async function () {
      const v = ethers.parseEther("0.1");
      await expect(
        splitter.connect(depositor).deposit([alice.address], [v], { value: v })
      ).to.emit(splitter, "Deposited");
    });
  });

  // ─── Deposit correctness ──────────────────────────────────────────────────

  describe("deposit — balance crediting", function () {
    it("credits a single receiver correctly", async function () {
      const v = ethers.parseEther("1");
      await splitter.connect(depositor).deposit([alice.address], [v], { value: v });
      expect(await splitter.balances(alice.address)).to.equal(v);
      expect(await splitter.claimable(alice.address)).to.equal(v);
    });

    it("credits multiple receivers correctly", async function () {
      const a = ethers.parseEther("0.3");
      const b = ethers.parseEther("0.7");
      await splitter.connect(depositor).deposit(
        [alice.address, bob.address],
        [a, b],
        { value: a + b }
      );
      expect(await splitter.balances(alice.address)).to.equal(a);
      expect(await splitter.balances(bob.address)).to.equal(b);
    });

    it("accumulates across multiple deposits", async function () {
      const v = ethers.parseEther("0.5");
      await splitter.connect(depositor).deposit([alice.address], [v], { value: v });
      await splitter.connect(depositor).deposit([alice.address], [v], { value: v });
      expect(await splitter.balances(alice.address)).to.equal(v * 2n);
    });

    it("reverts on sum mismatch (too little value)", async function () {
      const v = ethers.parseEther("1");
      await expect(
        splitter.connect(depositor).deposit([alice.address], [v], { value: ethers.parseEther("0.5") })
      ).to.be.revertedWithCustomError(splitter, "ValueMismatch");
    });

    it("reverts on sum mismatch (too much value)", async function () {
      const v = ethers.parseEther("0.5");
      await expect(
        splitter.connect(depositor).deposit([alice.address], [v], { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(splitter, "ValueMismatch");
    });

    it("reverts on array length mismatch", async function () {
      const v = ethers.parseEther("1");
      await expect(
        splitter.connect(depositor).deposit(
          [alice.address, bob.address],
          [v],
          { value: v }
        )
      ).to.be.revertedWithCustomError(splitter, "ArrayLengthMismatch");
    });

    it("reverts when receivers array is empty", async function () {
      await expect(
        splitter.connect(depositor).deposit([], [], { value: 0 })
      ).to.be.revertedWithCustomError(splitter, "EmptyReceivers");
    });

    it("emits Deposited event with correct args", async function () {
      const v = ethers.parseEther("0.2");
      await expect(
        splitter.connect(depositor).deposit([alice.address], [v], { value: v })
      )
        .to.emit(splitter, "Deposited")
        .withArgs(depositor.address, [alice.address], [v]);
    });
  });

  // ─── Claim ────────────────────────────────────────────────────────────────

  describe("claim", function () {
    beforeEach(async function () {
      const v = ethers.parseEther("1");
      await splitter.connect(depositor).deposit([alice.address], [v], { value: v });
    });

    it("pays out the exact balance", async function () {
      const before = await ethers.provider.getBalance(alice.address);
      const tx = await splitter.connect(alice).claim();
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(alice.address);
      expect(after - before + gasUsed).to.equal(ethers.parseEther("1"));
    });

    it("zeroes the balance after claim", async function () {
      await splitter.connect(alice).claim();
      expect(await splitter.balances(alice.address)).to.equal(0);
    });

    it("double-claim reverts with NothingToClaim", async function () {
      await splitter.connect(alice).claim();
      await expect(splitter.connect(alice).claim())
        .to.be.revertedWithCustomError(splitter, "NothingToClaim");
    });

    it("bob cannot claim alice's balance", async function () {
      await expect(splitter.connect(bob).claim())
        .to.be.revertedWithCustomError(splitter, "NothingToClaim");
    });

    it("emits Claimed event", async function () {
      const v = ethers.parseEther("1");
      await expect(splitter.connect(alice).claim())
        .to.emit(splitter, "Claimed")
        .withArgs(alice.address, v);
    });

    it("contract balance drops to zero after single recipient claims", async function () {
      await splitter.connect(alice).claim();
      expect(await ethers.provider.getBalance(splitter.target)).to.equal(0);
    });
  });

  // ─── Multiple independent claims ──────────────────────────────────────────

  describe("multi-recipient independence", function () {
    it("each recipient claims independently without affecting others", async function () {
      const a = ethers.parseEther("0.4");
      const b = ethers.parseEther("0.6");
      await splitter.connect(depositor).deposit(
        [alice.address, bob.address],
        [a, b],
        { value: a + b }
      );

      await splitter.connect(alice).claim();
      // Bob's balance untouched
      expect(await splitter.balances(bob.address)).to.equal(b);
      await splitter.connect(bob).claim();
      expect(await splitter.balances(bob.address)).to.equal(0);
    });
  });

  // ─── Reentrancy protection ────────────────────────────────────────────────

  describe("reentrancy protection", function () {
    it("malicious receiver cannot drain more than its balance", async function () {
      // Deploy the attacker contract
      const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await Attacker.deploy(splitter.target);
      await attacker.waitForDeployment();

      const victimBalance = ethers.parseEther("1");
      const attackerBalance = ethers.parseEther("0.1");

      // Fund both victim (alice) and attacker
      await splitter.connect(depositor).deposit(
        [alice.address, attacker.target],
        [victimBalance, attackerBalance],
        { value: victimBalance + attackerBalance }
      );

      // Attacker tries to reenter claim() — should only ever get its own balance
      await attacker.attack();

      // Attacker's balance in splitter is now 0
      expect(await splitter.balances(attacker.target)).to.equal(0);
      // Alice's balance must be untouched
      expect(await splitter.balances(alice.address)).to.equal(victimBalance);
      // Attacker contract received exactly its share
      expect(await ethers.provider.getBalance(attacker.target)).to.equal(attackerBalance);
    });
  });
});
