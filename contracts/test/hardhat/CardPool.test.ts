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
  const POOL_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("POOL_MANAGER_ROLE"));

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

  // mintCard is overloaded, so TypeChain exposes no bare `.mintCard` member —
  // index the template-based overload by its full signature to stay typed.
  const MINT = "mintCard(address,uint16)";

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

    it("reverts if non-pool-manager tries to add", async function () {
      await expect(
        nft.connect(user).addCardToPool(makeTemplate(1, 0, 100), [RX(user.address, 300)])
      ).to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });

    it("succeeds after POOL_MANAGER_ROLE is granted", async function () {
      await nft.connect(admin).grantRole(POOL_MANAGER_ROLE, user.address);
      await expect(
        nft.connect(user).addCardToPool(makeTemplate(1, 0, 100), [RX(user.address, 300)])
      ).to.emit(nft, "CardAddedToPool");
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
      await nft.connect(minter)[MINT](user.address, 7); // 1/2
      await nft.connect(minter)[MINT](user.address, 7); // 2/2 — sold out

      // An attempted re-add must NOT succeed (which would otherwise reset
      // currentSupply to 0 and re-open minting beyond maxSupply).
      await expect(
        nft.connect(admin).addCardToPool(makeTemplate(7, 0, 2), [RX(user.address, 300)])
      ).to.be.revertedWithCustomError(nft, "CardAlreadyInPool");

      // Sanity: supply still at cap, mint still reverts.
      expect((await nft.getCardTemplate(7)).currentSupply).to.equal(2);
      await expect(
        nft.connect(minter)[MINT](user.address, 7)
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
      await nft.connect(minter)[MINT](user.address, 1);
      const stored = await nft.getCardTemplate(1);
      expect(stored.currentSupply).to.equal(1);
      expect(await nft.ownerOf(0)).to.equal(user.address);
    });

    it("minted card has correct name from template", async function () {
      await nft.connect(minter)[MINT](user.address, 1);
      const card = await nft.getCard(0);
      expect(card.name).to.equal("Card_1");
    });

    it("minted card has royalty receivers from pool", async function () {
      await nft.connect(minter)[MINT](user.address, 1);
      const rxs = await nft.getRoyaltyReceivers(0);
      expect(rxs.length).to.equal(2);
      expect(rxs[0].receiver).to.equal(user.address);
      expect(rxs[0].feeBps).to.equal(300);
    });

    // Gas optimization: pool mints store only tokenCardId and derive royalties
    // from the template, so they intentionally skip the per-token
    // RoyaltyReceiversSet event. EIP-2981 discovery is view-based
    // (royaltyInfo / getRoyaltyReceivers), so no consumer needs the event;
    // freeform mints still emit it (see PokemonCardNFT.test.ts).
    it("does NOT emit RoyaltyReceiversSet, yet royalties stay queryable via the views", async function () {
      // Card 1 is Common (rarity 0); first mint → tokenId 0, to `user`.
      const tx = nft.connect(minter)[MINT](user.address, 1);
      await expect(tx).to.emit(nft, "CardMinted").withArgs(user.address, 0, 0 /* Common */);
      await expect(tx).to.not.emit(nft, "RoyaltyReceiversSet"); // intentionally omitted

      // Full multi-receiver set is read-through from the template.
      const rxs = await nft.getRoyaltyReceivers(0);
      expect(rxs.map((r: any) => [r.receiver, Number(r.feeBps)]))
        .to.deep.equal([[user.address, 300], [admin.address, 200]]);

      // EIP-2981 royaltyInfo resolves to the first receiver at 3% (300 bps).
      const [recv, amt] = await nft.royaltyInfo(0, ethers.parseEther("1"));
      expect(recv).to.equal(user.address);
      expect(amt).to.equal(ethers.parseEther("0.03"));
    });

    it("mints up to maxSupply successfully", async function () {
      await nft.connect(minter)[MINT](user.address, 1); // supply 1/2
      await nft.connect(minter)[MINT](user.address, 1); // supply 2/2
      const stored = await nft.getCardTemplate(1);
      expect(stored.currentSupply).to.equal(2);
    });

    it("reverts CardSoldOut when maxSupply is reached", async function () {
      await nft.connect(minter)[MINT](user.address, 1); // 1/2
      await nft.connect(minter)[MINT](user.address, 1); // 2/2
      await expect(
        nft.connect(minter)[MINT](user.address, 1) // 3rd → sold out
      ).to.be.revertedWithCustomError(nft, "CardSoldOut");
    });

    it("sold-out card does NOT appear in getAvailableCardIds", async function () {
      await nft.connect(minter)[MINT](user.address, 1); // 1/2
      await nft.connect(minter)[MINT](user.address, 1); // 2/2

      const available = await nft.getAvailableCardIds(0); // Common
      // Card 1 is sold out, only Card 2 (maxSupply=3) should appear
      expect(available.length).to.equal(1);
      expect(available[0]).to.equal(2);
    });

    it("reverts CardNotInPool for unknown cardId", async function () {
      await expect(
        nft.connect(minter)[MINT](user.address, 99)
      ).to.be.revertedWithCustomError(nft, "CardNotInPool");
    });

    it("different cards have independent supply counters", async function () {
      await nft.connect(minter)[MINT](user.address, 1); // card 1: 1/2
      await nft.connect(minter)[MINT](user.address, 2); // card 2: 1/3
      await nft.connect(minter)[MINT](user.address, 2); // card 2: 2/3
      expect((await nft.getCardTemplate(1)).currentSupply).to.equal(1);
      expect((await nft.getCardTemplate(2)).currentSupply).to.equal(2);
    });

    it("Legendary card (maxSupply=1) sells out after one mint", async function () {
      await nft.connect(minter)[MINT](user.address, 5);
      await expect(
        nft.connect(minter)[MINT](user.address, 5)
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
      await nft.connect(minter)[MINT](user.address, 1);
      await nft.connect(minter)[MINT](user.address, 1);

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
  // ─── getAvailableCardIds — Dynamic updates ────────────────────────────────

  describe("getAvailableCardIds — Dynamic updates", function () {
    it("returns an empty array for an unused rarity level", async function () {
      const available = await nft.getAvailableCardIds(1); // Rarity 1 (Uncommon) not added
      expect(available.length).to.equal(0);
    });

    it("removes cardId from available list when maxSupply is reached", async function () {
      await nft.connect(admin).addCardToPool(makeTemplate(10, 0, 1), [RX(user.address, 300)]);
      await nft.connect(admin).addCardToPool(makeTemplate(11, 0, 5), [RX(user.address, 300)]);
      
      let available = await nft.getAvailableCardIds(0);
      expect(available.length).to.equal(2);
      expect(available).to.include(10n);
      expect(available).to.include(11n);

      // Mint out card 10 (maxSupply = 1)
      await nft.connect(minter)[MINT](user.address, 10);
      
      available = await nft.getAvailableCardIds(0);
      expect(available.length).to.equal(1);
      expect(available[0]).to.equal(11n);
    });

    it("does not affect other rarities when a card sells out", async function () {
      await nft.connect(admin).addCardToPool(makeTemplate(10, 0, 1), [RX(user.address, 300)]);
      await nft.connect(admin).addCardToPool(makeTemplate(20, 2, 1), [RX(user.address, 300)]);
      
      await nft.connect(minter)[MINT](user.address, 10); // Sold out Common
      
      const availableRare = await nft.getAvailableCardIds(2);
      expect(availableRare.length).to.equal(1);
      expect(availableRare[0]).to.equal(20n);
    });
  });

  // ─── Royalties Configuration ──────────────────────────────────────────────

  describe("Royalties Configuration", function () {
    it("rejects adding a card with zero royalty receivers", async function () {
      await expect(
        nft.connect(admin).addCardToPool(makeTemplate(1, 0, 10), [])
      ).to.be.revertedWithCustomError(nft, "EmptyReceivers");
    });

    it("handles multiple royalty receivers correctly", async function () {
      const receivers = [
        RX(user.address, 100),
        RX(admin.address, 200),
        RX(minter.address, 300)
      ];
      await nft.connect(admin).addCardToPool(makeTemplate(2, 1, 10), receivers);
      await nft.connect(minter)[MINT](user.address, 2);
      
      const rxs = await nft.getRoyaltyReceivers(0);
      expect(rxs.length).to.equal(3);
      expect(rxs[0].receiver).to.equal(user.address);
      expect(rxs[0].feeBps).to.equal(100);
      expect(rxs[2].receiver).to.equal(minter.address);
      expect(rxs[2].feeBps).to.equal(300);
    });
  });

  // ─── getCard & Template Data Integrity ────────────────────────────────────

  describe("getCard & Template Data Integrity", function () {
    it("stores and retrieves the exact floorPrice", async function () {
      const tpl = makeTemplate(55, 1, 100);
      tpl.floorPrice = ethers.parseEther("1.5");
      await nft.connect(admin).addCardToPool(tpl, [RX(user.address, 300)]);
      
      const stored = await nft.getCardTemplate(55);
      expect(stored.floorPrice).to.equal(ethers.parseEther("1.5"));
    });

    it("preserves exact string fields (pokemonType, imageURI on token; attack on template)", async function () {
      const tpl = makeTemplate(99, 4, 10);
      tpl.pokemonType = "Electric/Steel";
      tpl.attack = "Thunderbolt - 90";
      tpl.imageURI = "ipfs://custom-hash-123";

      await nft.connect(admin).addCardToPool(tpl, [RX(user.address, 300)]);
      await nft.connect(minter)[MINT](user.address, 99);

      // pokemonType + imageURI live on the minted token's Card struct.
      const card = await nft.getCard(0);
      expect(card.pokemonType).to.equal("Electric/Steel");
      expect(card.imageURI).to.equal("ipfs://custom-hash-123");

      // attack is a template-only field (Card struct omits it to stay lightweight).
      const stored = await nft.getCardTemplate(99);
      expect(stored.attack).to.equal("Thunderbolt - 90");
    });

    it("reverts when querying getCard for a non-existent token", async function () {
      await expect(nft.getCard(999))
        .to.be.revertedWithCustomError(nft, "ERC721NonexistentToken")
        .withArgs(999);
    });
  });
});
