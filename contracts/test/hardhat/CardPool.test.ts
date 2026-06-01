import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { PokemonCardNFT } from "../../typechain-types";

describe("PokemonCardNFT — Card Pool & Inventory", function () {
  let nft: PokemonCardNFT;
  let admin: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let user: HardhatEthersSigner;

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

  // Helper: build a CardTemplate with configurable maxSupply
  function makeTemplate(
    cardId: number,
    rarity: number,
    maxSupply: number
  ): PokemonCardNFT.CardTemplateStruct {
    return {
      cardId,
      name:          `Card_${cardId}`,
      rarity,
      pokemonType:   "Fire",
      hp:            50,
      attack:        "Ember - 40",
      maxSupply,
      currentSupply: 0,
      floorPrice:    ethers.parseEther("0.01"),
      imageURI:      `ipfs://card/${cardId}`,
    };
  }

  const RX = (addr: string, bps: number) => ({ receiver: addr, feeBps: bps });

  beforeEach(async function () {
    [admin, minter, user] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("PokemonCardNFT");
    nft = await factory.deploy(admin.address) as PokemonCardNFT;
    await nft.waitForDeployment();
    await nft.connect(admin).grantRole(MINTER_ROLE, minter.address);
  });

  // ─── addCardToPool ────────────────────────────────────────────────────────

  describe("addCardToPool", function () {
    it("stores the template correctly", async function () {
      const tpl = makeTemplate(1, 0 /* Common */, 100);
      await nft.connect(admin).addCardToPool(tpl, [RX(user.address, 300)]);
      const stored = await nft.getCardTemplate(1);
      expect(stored.name).to.equal("Card_1");
      expect(stored.maxSupply).to.equal(100);
      expect(stored.currentSupply).to.equal(0);
      expect(stored.rarity).to.equal(0);
    });

    it("emits CardAddedToPool", async function () {
      const tpl = makeTemplate(2, 2 /* Rare */, 50);
      await expect(nft.connect(admin).addCardToPool(tpl, [RX(user.address, 300)]))
        .to.emit(nft, "CardAddedToPool")
        .withArgs(2, 2, 50);
    });

    it("registers in the correct rarity array", async function () {
      await nft.connect(admin).addCardToPool(makeTemplate(10, 0, 100), [RX(user.address, 300)]);
      await nft.connect(admin).addCardToPool(makeTemplate(11, 0, 200), [RX(user.address, 300)]);
      await nft.connect(admin).addCardToPool(makeTemplate(20, 4 /* Legendary */, 5), [RX(user.address, 300)]);

      const available = await nft.getAvailableCardIds(0); // Common
      expect(available.length).to.equal(2);
      expect(available[0]).to.equal(10);
      expect(available[1]).to.equal(11);

      const legendary = await nft.getAvailableCardIds(4);
      expect(legendary.length).to.equal(1);
      expect(legendary[0]).to.equal(20);
    });

    it("reverts if non-owner tries to add", async function () {
      await expect(
        nft.connect(user).addCardToPool(makeTemplate(1, 0, 100), [RX(user.address, 300)])
      ).to.be.revertedWithCustomError(nft, "OwnableUnauthorizedAccount");
    });

    // ── H-01 regression: write-once template, no supply-reset attack ──────
    it("reverts InvalidCardId when cardId == 0 (sentinel collision)", async function () {
      await expect(
        nft.connect(admin).addCardToPool(makeTemplate(0, 0, 100), [RX(user.address, 300)])
      ).to.be.revertedWithCustomError(nft, "InvalidCardId");
    });

    it("reverts InvalidMaxSupply when maxSupply == 0", async function () {
      await expect(
        nft.connect(admin).addCardToPool(makeTemplate(1, 0, 0), [RX(user.address, 300)])
      ).to.be.revertedWithCustomError(nft, "InvalidMaxSupply");
    });

    it("reverts CardAlreadyInPool when re-adding an existing cardId", async function () {
      await nft.connect(admin).addCardToPool(makeTemplate(1, 0, 100), [RX(user.address, 300)]);
      await expect(
        nft.connect(admin).addCardToPool(makeTemplate(1, 0, 100), [RX(user.address, 300)])
      ).to.be.revertedWithCustomError(nft, "CardAlreadyInPool").withArgs(1);
    });

    it("re-add cannot reset currentSupply mid-sale (supply inflation guard)", async function () {
      await nft.connect(admin).addCardToPool(makeTemplate(7, 0, 2), [RX(user.address, 300)]);
      await nft.connect(minter).mintCard(user.address, 7); // 1/2
      await nft.connect(minter).mintCard(user.address, 7); // 2/2 — sold out

      // An attempted re-add must NOT succeed (which would otherwise reset
      // currentSupply to 0 and re-open minting beyond maxSupply).
      await expect(
        nft.connect(admin).addCardToPool(makeTemplate(7, 0, 2), [RX(user.address, 300)])
      ).to.be.revertedWithCustomError(nft, "CardAlreadyInPool");

      // Sanity: supply still at cap, mint still reverts.
      expect((await nft.getCardTemplate(7)).currentSupply).to.equal(2);
      await expect(
        nft.connect(minter).mintCard(user.address, 7)
      ).to.be.revertedWithCustomError(nft, "CardSoldOut");
    });

    it("re-add does not duplicate cardId in rarity array (probability skew guard)", async function () {
      await nft.connect(admin).addCardToPool(makeTemplate(20, 4 /* Legendary */, 1), [RX(user.address, 300)]);
      // Attempt re-add must revert.
      await expect(
        nft.connect(admin).addCardToPool(makeTemplate(20, 4, 1), [RX(user.address, 300)])
      ).to.be.revertedWithCustomError(nft, "CardAlreadyInPool");

      // Legendary array still contains exactly one entry.
      const legendary = await nft.getAvailableCardIds(4);
      expect(legendary.length).to.equal(1);
      expect(legendary[0]).to.equal(20);
    });
  });

  // ─── batchAddCards ────────────────────────────────────────────────────────

  describe("batchAddCards", function () {
    it("adds 5 cards in one call", async function () {
      const templates = [1, 2, 3, 4, 5].map((id) => makeTemplate(id, 0, 100));
      await nft.connect(admin).batchAddCards(
        templates,
        user.address, 300,
        admin.address, 200
      );
      const available = await nft.getAvailableCardIds(0);
      expect(available.length).to.equal(5);
    });

    it("resets currentSupply to 0 even if caller passes non-zero", async function () {
      const tpl = makeTemplate(99, 0, 10);
      (tpl as any).currentSupply = 5; // caller tries to smuggle in a supply value
      await nft.connect(admin).batchAddCards([tpl], user.address, 300, admin.address, 200);
      const stored = await nft.getCardTemplate(99);
      expect(stored.currentSupply).to.equal(0);
    });

    // ── H-01 regression on the batch path ────────────────────────────────
    it("reverts CardAlreadyInPool if any template in the batch duplicates an existing one", async function () {
      await nft.connect(admin).addCardToPool(makeTemplate(1, 0, 100), [RX(user.address, 300)]);
      const batch = [makeTemplate(2, 0, 50), makeTemplate(1, 0, 50)]; // dup at idx 1
      await expect(
        nft.connect(admin).batchAddCards(batch, user.address, 300, admin.address, 200)
      ).to.be.revertedWithCustomError(nft, "CardAlreadyInPool").withArgs(1);
    });

    it("reverts InvalidCardId if a batch template uses cardId == 0", async function () {
      const batch = [makeTemplate(1, 0, 50), makeTemplate(0, 0, 50)];
      await expect(
        nft.connect(admin).batchAddCards(batch, user.address, 300, admin.address, 200)
      ).to.be.revertedWithCustomError(nft, "InvalidCardId");
    });
  });

  // ─── mintCard(to, cardId) — template-based ────────────────────────────────

  describe("mintCard(to, cardId) — template-based", function () {
    beforeEach(async function () {
      // Seed 5 cards: two Common (maxSupply 2 & 3), one Rare, one UltraRare, one Legendary
      await nft.connect(admin).addCardToPool(makeTemplate(1, 0, 2), [RX(user.address, 300), RX(admin.address, 200)]);
      await nft.connect(admin).addCardToPool(makeTemplate(2, 0, 3), [RX(user.address, 300), RX(admin.address, 200)]);
      await nft.connect(admin).addCardToPool(makeTemplate(3, 2, 10), [RX(user.address, 300), RX(admin.address, 200)]);
      await nft.connect(admin).addCardToPool(makeTemplate(4, 3, 5),  [RX(user.address, 300), RX(admin.address, 200)]);
      await nft.connect(admin).addCardToPool(makeTemplate(5, 4, 1),  [RX(user.address, 300), RX(admin.address, 200)]);
    });

    it("mints a card from the pool and increments currentSupply", async function () {
      await nft.connect(minter).mintCard(user.address, 1);
      const stored = await nft.getCardTemplate(1);
      expect(stored.currentSupply).to.equal(1);
      expect(await nft.ownerOf(0)).to.equal(user.address);
    });

    it("minted card has correct name from template", async function () {
      await nft.connect(minter).mintCard(user.address, 1);
      const card = await nft.getCard(0);
      expect(card.name).to.equal("Card_1");
    });

    it("minted card has royalty receivers from pool", async function () {
      await nft.connect(minter).mintCard(user.address, 1);
      const rxs = await nft.getRoyaltyReceivers(0);
      expect(rxs.length).to.equal(2);
      expect(rxs[0].receiver).to.equal(user.address);
      expect(rxs[0].feeBps).to.equal(300);
    });

    it("mints up to maxSupply successfully", async function () {
      await nft.connect(minter).mintCard(user.address, 1); // supply 1/2
      await nft.connect(minter).mintCard(user.address, 1); // supply 2/2
      const stored = await nft.getCardTemplate(1);
      expect(stored.currentSupply).to.equal(2);
    });

    it("reverts CardSoldOut when maxSupply is reached", async function () {
      await nft.connect(minter).mintCard(user.address, 1); // 1/2
      await nft.connect(minter).mintCard(user.address, 1); // 2/2
      await expect(
        nft.connect(minter).mintCard(user.address, 1) // 3rd → sold out
      ).to.be.revertedWithCustomError(nft, "CardSoldOut");
    });

    it("sold-out card does NOT appear in getAvailableCardIds", async function () {
      await nft.connect(minter).mintCard(user.address, 1); // 1/2
      await nft.connect(minter).mintCard(user.address, 1); // 2/2

      const available = await nft.getAvailableCardIds(0); // Common
      // Card 1 is sold out, only Card 2 (maxSupply=3) should appear
      expect(available.length).to.equal(1);
      expect(available[0]).to.equal(2);
    });

    it("reverts CardNotInPool for unknown cardId", async function () {
      await expect(
        nft.connect(minter).mintCard(user.address, 99)
      ).to.be.revertedWithCustomError(nft, "CardNotInPool");
    });

    it("different cards have independent supply counters", async function () {
      await nft.connect(minter).mintCard(user.address, 1); // card 1: 1/2
      await nft.connect(minter).mintCard(user.address, 2); // card 2: 1/3
      await nft.connect(minter).mintCard(user.address, 2); // card 2: 2/3
      expect((await nft.getCardTemplate(1)).currentSupply).to.equal(1);
      expect((await nft.getCardTemplate(2)).currentSupply).to.equal(2);
    });

    it("Legendary card (maxSupply=1) sells out after one mint", async function () {
      await nft.connect(minter).mintCard(user.address, 5);
      await expect(
        nft.connect(minter).mintCard(user.address, 5)
      ).to.be.revertedWithCustomError(nft, "CardSoldOut");
      const available = await nft.getAvailableCardIds(4); // Legendary
      expect(available.length).to.equal(0);
    });
  });

  // ─── getPoolStatus ────────────────────────────────────────────────────────

  describe("getPoolStatus", function () {
    it("returns all cards with correct remaining supply", async function () {
      await nft.connect(admin).addCardToPool(makeTemplate(1, 0, 5), [RX(user.address, 300)]);
      await nft.connect(admin).addCardToPool(makeTemplate(2, 2, 3), [RX(user.address, 300)]);
      await nft.connect(minter).mintCard(user.address, 1);
      await nft.connect(minter).mintCard(user.address, 1);

      const [ids, remaining] = await nft.getPoolStatus();
      expect(ids.length).to.equal(2);

      const idx1 = ids.findIndex((id: bigint) => id === 1n);
      const idx2 = ids.findIndex((id: bigint) => id === 2n);
      expect(remaining[idx1]).to.equal(3); // 5 - 2 minted
      expect(remaining[idx2]).to.equal(3); // 3 - 0 minted
    });
  });

  // ─── Backward-compat: freeform mintCard still works ──────────────────────

  describe("mintCard(to, Card, RoyaltyReceiver[]) — backward compat", function () {
    it("mints without touching pool supply counters", async function () {
      await nft.connect(admin).addCardToPool(makeTemplate(1, 0, 5), [RX(user.address, 300)]);

      const card = { name: "Custom", rarity: 0, pokemonType: "Water", hp: 40, imageURI: "ipfs://x" };
      const rxs  = [{ receiver: user.address, feeBps: 300 }];
      // Use full ABI signature to disambiguate overloaded mintCard
      const nftAsMinter = nft.connect(minter);
      await nftAsMinter["mintCard(address,(string,uint8,string,uint16,string),(address,uint96)[])"](
        user.address, card, rxs
      );

      // Pool supply for card 1 should still be 0
      expect((await nft.getCardTemplate(1)).currentSupply).to.equal(0);
    });
  });
});
