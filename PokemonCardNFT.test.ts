import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { PokemonCardNFT } from "../../typechain-types";

// ─── helpers ─────────────────────────────────────────────────────────────────

const Rarity = { Common: 0, Uncommon: 1, Rare: 2, UltraRare: 3, Legendary: 4 };
const PokemonType = {
  Fire: 0, Water: 1, Grass: 2, Lightning: 3,
  Psychic: 4, Fighting: 5, Colorless: 6,
};

function cardTemplate(overrides: Partial<{
  cardId: number;
  rarity: number;
  pokemonType: number;
  hp: number;
  maxSupply: number;
  floorPrice: bigint;
  name: string;
  attack: string;
  imageURI: string;
}> = {}) {
  return {
    cardId:        overrides.cardId        ?? 1,
    rarity:        overrides.rarity        ?? Rarity.Common,
    pokemonType:   overrides.pokemonType   ?? PokemonType.Grass,
    hp:            overrides.hp            ?? 40,
    maxSupply:     overrides.maxSupply     ?? 100,
    currentSupply: 0,
    floorPrice:    overrides.floorPrice    ?? ethers.parseEther("0.001"),
    name:          overrides.name          ?? "Caterpie",
    attack:        overrides.attack        ?? "String Shot",
    imageURI:      overrides.imageURI      ?? "https://example.com/caterpie.png",
  };
}

function receiver(address: string, feeBps: number) {
  return { receiver: address, feeBps };
}

// ─── test suite ──────────────────────────────────────────────────────────────

describe("PokemonCardNFT", function () {
  let nft: PokemonCardNFT;
  let owner: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let user1: HardhatEthersSigner;
  let user2: HardhatEthersSigner;
  let artist: HardhatEthersSigner;

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const POOL_MANAGER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("POOL_MANAGER_ROLE"));

  beforeEach(async function () {
    [owner, minter, user1, user2, artist] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("PokemonCardNFT");
    nft = await Factory.deploy(owner.address);
    await nft.waitForDeployment();

    // Grant minter role
    await nft.grantRole(MINTER_ROLE, minter.address);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Deployment
  // ─────────────────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets deployer as DEFAULT_ADMIN and POOL_MANAGER", async function () {
      expect(await nft.hasRole(await nft.DEFAULT_ADMIN_ROLE(), owner.address)).to.equal(true);
      expect(await nft.hasRole(POOL_MANAGER_ROLE, owner.address)).to.equal(true);
    });

    it("reverts if admin is zero address", async function () {
      const Factory = await ethers.getContractFactory("PokemonCardNFT");
      await expect(Factory.deploy(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(nft, "ZeroAddress");
    });

    it("name and symbol are correct", async function () {
      expect(await nft.name()).to.equal("PokemonCardNFT");
      expect(await nft.symbol()).to.equal("PKMN");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // batchAddCards
  // ─────────────────────────────────────────────────────────────────────────

  describe("batchAddCards", function () {
    it("adds a single card to the pool and emits CardAddedToPool", async function () {
      const tmpl = cardTemplate({ cardId: 1, rarity: Rarity.Common });
      await expect(nft.batchAddCards([tmpl]))
        .to.emit(nft, "CardAddedToPool")
        .withArgs(1, Rarity.Common, "Caterpie", 100);

      const stored = await nft.getCardTemplate(1);
      expect(stored.name).to.equal("Caterpie");
      expect(stored.currentSupply).to.equal(0);
      expect(stored.maxSupply).to.equal(100);
    });

    it("adds cards across all rarity tiers in one call", async function () {
      const templates = [
        cardTemplate({ cardId: 1,  rarity: Rarity.Common,    maxSupply: 800 }),
        cardTemplate({ cardId: 2,  rarity: Rarity.Uncommon,  maxSupply: 300, name: "Ivysaur" }),
        cardTemplate({ cardId: 3,  rarity: Rarity.Rare,      maxSupply: 70,  name: "Venusaur" }),
        cardTemplate({ cardId: 4,  rarity: Rarity.UltraRare, maxSupply: 25,  name: "Pikachu" }),
        cardTemplate({ cardId: 5,  rarity: Rarity.Legendary, maxSupply: 5,   name: "Mewtwo" }),
      ];
      await nft.batchAddCards(templates);

      // Each card accessible
      for (const t of templates) {
        const stored = await nft.getCardTemplate(t.cardId);
        expect(stored.name).to.equal(t.name);
      }
    });

    it("reverts when called by non-POOL_MANAGER", async function () {
      await expect(nft.connect(user1).batchAddCards([cardTemplate()]))
        .to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });

    it("reverts with EmptyCardInput when array is empty", async function () {
      await expect(nft.batchAddCards([]))
        .to.be.revertedWithCustomError(nft, "EmptyCardInput");
    });

    it("reverts when same cardId is added twice", async function () {
      await nft.batchAddCards([cardTemplate({ cardId: 1 })]);
      await expect(nft.batchAddCards([cardTemplate({ cardId: 1 })]))
        .to.be.revertedWithCustomError(nft, "CardAlreadyInPool")
        .withArgs(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // mintCard
  // ─────────────────────────────────────────────────────────────────────────

  describe("mintCard", function () {
    beforeEach(async function () {
      // Seed 3 cards
      await nft.batchAddCards([
        cardTemplate({ cardId: 1,  rarity: Rarity.Common,    maxSupply: 5  }),
        cardTemplate({ cardId: 2,  rarity: Rarity.Uncommon,  maxSupply: 2,  name: "Ivysaur"  }),
        cardTemplate({ cardId: 3,  rarity: Rarity.Legendary, maxSupply: 1,  name: "Mewtwo"   }),
      ]);
    });

    it("mints successfully and emits CardMinted", async function () {
      const receivers = [receiver(artist.address, 500)]; // 5 %
      await expect(nft.connect(minter).mintCard(user1.address, 1, receivers))
        .to.emit(nft, "CardMinted")
        .withArgs(0, 1, user1.address, Rarity.Common);

      expect(await nft.ownerOf(0)).to.equal(user1.address);
      expect(await nft.tokenCardId(0)).to.equal(1);
    });

    it("increments currentSupply on each mint", async function () {
      const receivers: any[] = [];
      await nft.connect(minter).mintCard(user1.address, 1, receivers);
      await nft.connect(minter).mintCard(user1.address, 1, receivers);

      const tmpl = await nft.getCardTemplate(1);
      expect(tmpl.currentSupply).to.equal(2);
    });

    it("mints tokens with sequential IDs", async function () {
      await nft.connect(minter).mintCard(user1.address, 1, []);
      await nft.connect(minter).mintCard(user2.address, 2, []);
      expect(await nft.ownerOf(0)).to.equal(user1.address);
      expect(await nft.ownerOf(1)).to.equal(user2.address);
    });

    it("stores royalty receivers correctly", async function () {
      const recs = [
        receiver(artist.address,  500), // 5 %
        receiver(owner.address,   300), // 3 %
      ];
      await nft.connect(minter).mintCard(user1.address, 1, recs);

      const stored = await nft.getRoyaltyReceivers(0);
      expect(stored[0].receiver).to.equal(artist.address);
      expect(stored[0].feeBps).to.equal(500);
      expect(stored[1].receiver).to.equal(owner.address);
      expect(stored[1].feeBps).to.equal(300);
    });

    it("reverts with CardSoldOut when maxSupply is reached", async function () {
      // Card 3 has maxSupply = 1
      await nft.connect(minter).mintCard(user1.address, 3, []);
      await expect(nft.connect(minter).mintCard(user2.address, 3, []))
        .to.be.revertedWithCustomError(nft, "CardSoldOut")
        .withArgs(3);
    });

    it("reverts CardDoesNotExist for unknown cardId", async function () {
      await expect(nft.connect(minter).mintCard(user1.address, 99, []))
        .to.be.revertedWithCustomError(nft, "CardDoesNotExist")
        .withArgs(99);
    });

    it("reverts RoyaltyTooHigh when bps exceeds 1000", async function () {
      const recs = [receiver(artist.address, 1001)];
      await expect(nft.connect(minter).mintCard(user1.address, 1, recs))
        .to.be.revertedWithCustomError(nft, "RoyaltyTooHigh")
        .withArgs(1001);
    });

    it("reverts ZeroAddress when minting to zero", async function () {
      await expect(nft.connect(minter).mintCard(ethers.ZeroAddress, 1, []))
        .to.be.revertedWithCustomError(nft, "ZeroAddress");
    });

    it("reverts when non-MINTER_ROLE calls mintCard", async function () {
      await expect(nft.connect(user1).mintCard(user1.address, 1, []))
        .to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });

    it("mints exactly maxSupply cards without reverting", async function () {
      // Card 2 has maxSupply = 2
      await nft.connect(minter).mintCard(user1.address, 2, []);
      await nft.connect(minter).mintCard(user2.address, 2, []);
      // Third must revert
      await expect(nft.connect(minter).mintCard(user1.address, 2, []))
        .to.be.revertedWithCustomError(nft, "CardSoldOut");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getAvailableCardIds
  // ─────────────────────────────────────────────────────────────────────────

  describe("getAvailableCardIds", function () {
    beforeEach(async function () {
      await nft.batchAddCards([
        cardTemplate({ cardId: 1,  rarity: Rarity.Common,    maxSupply: 2 }),
        cardTemplate({ cardId: 2,  rarity: Rarity.Common,    maxSupply: 3, name: "Weedle" }),
        cardTemplate({ cardId: 3,  rarity: Rarity.Legendary, maxSupply: 1, name: "Mewtwo" }),
      ]);
    });

    it("returns all cardIds when no mints have occurred", async function () {
      const available = await nft.getAvailableCardIds(Rarity.Common);
      expect(available.length).to.equal(2);
      expect(available).to.include.members([1n, 2n]);
    });

    it("excludes depleted cards", async function () {
      // Mint both slots of card 1
      await nft.connect(minter).mintCard(user1.address, 1, []);
      await nft.connect(minter).mintCard(user1.address, 1, []);

      const available = await nft.getAvailableCardIds(Rarity.Common);
      expect(available.length).to.equal(1);
      expect(available[0]).to.equal(2n);
    });

    it("returns empty array when all Common cards are sold out", async function () {
      await nft.connect(minter).mintCard(user1.address, 1, []);
      await nft.connect(minter).mintCard(user1.address, 1, []);
      await nft.connect(minter).mintCard(user1.address, 2, []);
      await nft.connect(minter).mintCard(user1.address, 2, []);
      await nft.connect(minter).mintCard(user1.address, 2, []);

      const available = await nft.getAvailableCardIds(Rarity.Common);
      expect(available.length).to.equal(0);
    });

    it("returns empty array for rarity with no cards seeded", async function () {
      const available = await nft.getAvailableCardIds(Rarity.UltraRare);
      expect(available.length).to.equal(0);
    });

    it("Legendary: fully minted card disappears from available list", async function () {
      await nft.connect(minter).mintCard(user1.address, 3, []);
      const available = await nft.getAvailableCardIds(Rarity.Legendary);
      expect(available.length).to.equal(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getPoolStatus
  // ─────────────────────────────────────────────────────────────────────────

  describe("getPoolStatus", function () {
    it("returns correct remaining counts before any mints", async function () {
      await nft.batchAddCards([
        cardTemplate({ cardId: 1,  rarity: Rarity.Common,    maxSupply: 100 }),
        cardTemplate({ cardId: 2,  rarity: Rarity.Legendary, maxSupply: 5, name: "Mewtwo" }),
      ]);

      const [cardIds, remaining] = await nft.getPoolStatus();
      expect(cardIds.length).to.equal(2);

      const idx1 = cardIds.indexOf(1n);
      const idx2 = cardIds.indexOf(2n);
      expect(remaining[idx1]).to.equal(100n);
      expect(remaining[idx2]).to.equal(5n);
    });

    it("decrements remaining after mints", async function () {
      await nft.batchAddCards([
        cardTemplate({ cardId: 1, rarity: Rarity.Common, maxSupply: 10 }),
      ]);
      await nft.connect(minter).mintCard(user1.address, 1, []);
      await nft.connect(minter).mintCard(user1.address, 1, []);
      await nft.connect(minter).mintCard(user1.address, 1, []);

      const [cardIds, remaining] = await nft.getPoolStatus();
      const idx = cardIds.indexOf(1n);
      expect(remaining[idx]).to.equal(7n);
    });

    it("returns zero remaining for a sold-out card", async function () {
      await nft.batchAddCards([
        cardTemplate({ cardId: 1, rarity: Rarity.Legendary, maxSupply: 1, name: "Mewtwo" }),
      ]);
      await nft.connect(minter).mintCard(user1.address, 1, []);

      const [, remaining] = await nft.getPoolStatus();
      expect(remaining[0]).to.equal(0n);
    });

    it("returns empty arrays when pool is empty", async function () {
      const [cardIds, remaining] = await nft.getPoolStatus();
      expect(cardIds.length).to.equal(0);
      expect(remaining.length).to.equal(0);
    });

    it("covers all 5 rarity tiers in correct order", async function () {
      await nft.batchAddCards([
        cardTemplate({ cardId: 1,  rarity: Rarity.Common,    maxSupply: 800 }),
        cardTemplate({ cardId: 2,  rarity: Rarity.Uncommon,  maxSupply: 300, name: "Ivysaur"   }),
        cardTemplate({ cardId: 3,  rarity: Rarity.Rare,      maxSupply: 70,  name: "Charizard" }),
        cardTemplate({ cardId: 4,  rarity: Rarity.UltraRare, maxSupply: 25,  name: "Pikachu"   }),
        cardTemplate({ cardId: 5,  rarity: Rarity.Legendary, maxSupply: 3,   name: "Mewtwo"    }),
      ]);

      const [cardIds, remaining] = await nft.getPoolStatus();
      expect(cardIds.length).to.equal(5);
      const total = remaining.reduce((a, b) => a + b, 0n);
      expect(total).to.equal(800n + 300n + 70n + 25n + 3n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getCardTemplate
  // ─────────────────────────────────────────────────────────────────────────

  describe("getCardTemplate", function () {
    it("returns correct template data", async function () {
      const fp = ethers.parseEther("0.05");
      await nft.batchAddCards([
        cardTemplate({
          cardId: 7, rarity: Rarity.Rare, pokemonType: PokemonType.Psychic,
          hp: 80, maxSupply: 60, floorPrice: fp, name: "Alakazam",
          attack: "Psychic", imageURI: "https://example.com/alakazam.png",
        }),
      ]);

      const t = await nft.getCardTemplate(7);
      expect(t.cardId).to.equal(7);
      expect(t.rarity).to.equal(Rarity.Rare);
      expect(t.pokemonType).to.equal(PokemonType.Psychic);
      expect(t.hp).to.equal(80);
      expect(t.maxSupply).to.equal(60);
      expect(t.floorPrice).to.equal(fp);
      expect(t.name).to.equal("Alakazam");
      expect(t.attack).to.equal("Psychic");
      expect(t.imageURI).to.equal("https://example.com/alakazam.png");
    });

    it("reverts CardDoesNotExist for unknown cardId", async function () {
      await expect(nft.getCardTemplate(255))
        .to.be.revertedWithCustomError(nft, "CardDoesNotExist")
        .withArgs(255);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // EIP-2981 royaltyInfo
  // ─────────────────────────────────────────────────────────────────────────

  describe("royaltyInfo", function () {
    beforeEach(async function () {
      await nft.batchAddCards([cardTemplate({ cardId: 1, rarity: Rarity.Common })]);
      await nft.connect(minter).mintCard(user1.address, 1, [
        receiver(artist.address, 500),
        receiver(owner.address,  300),
      ]);
    });

    it("returns first receiver and correct royalty amount", async function () {
      const salePrice = ethers.parseEther("1");
      const [rec, amount] = await nft.royaltyInfo(0, salePrice);
      expect(rec).to.equal(artist.address);
      expect(amount).to.equal(ethers.parseEther("0.05")); // 5%
    });

    it("returns zero for token with no receivers", async function () {
      await nft.connect(minter).mintCard(user1.address, 1, []);
      const [rec, amount] = await nft.royaltyInfo(1, ethers.parseEther("1"));
      expect(rec).to.equal(ethers.ZeroAddress);
      expect(amount).to.equal(0n);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getSuggestedPrice
  // ─────────────────────────────────────────────────────────────────────────

  describe("getSuggestedPrice", function () {
    it("returns the floor price from the card template", async function () {
      const fp = ethers.parseEther("0.04");
      await nft.batchAddCards([
        cardTemplate({ cardId: 1, floorPrice: fp }),
      ]);
      await nft.connect(minter).mintCard(user1.address, 1, []);
      expect(await nft.getSuggestedPrice(0)).to.equal(fp);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // tokenURI
  // ─────────────────────────────────────────────────────────────────────────

  describe("tokenURI", function () {
    it("returns the imageURI from the card template", async function () {
      const uri = "https://example.com/pikachu.png";
      await nft.batchAddCards([
        cardTemplate({ cardId: 1, imageURI: uri }),
      ]);
      await nft.connect(minter).mintCard(user1.address, 1, []);
      expect(await nft.tokenURI(0)).to.equal(uri);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Inventory sell-out scenario (Phase A Day 3 acceptance test)
  // ─────────────────────────────────────────────────────────────────────────

  describe("Full sell-out scenario", function () {
    it("seeds 5 cards, mints until maxSupply, asserts CardSoldOut and getAvailableCardIds", async function () {
      const cards = [
        cardTemplate({ cardId: 1,  rarity: Rarity.Common,    maxSupply: 3 }),
        cardTemplate({ cardId: 2,  rarity: Rarity.Common,    maxSupply: 2, name: "Weedle"    }),
        cardTemplate({ cardId: 3,  rarity: Rarity.Rare,      maxSupply: 1, name: "Charizard" }),
        cardTemplate({ cardId: 4,  rarity: Rarity.UltraRare, maxSupply: 2, name: "Pikachu"   }),
        cardTemplate({ cardId: 5,  rarity: Rarity.Legendary, maxSupply: 1, name: "Mewtwo"    }),
      ];
      await nft.batchAddCards(cards);

      // Drain card 1 (maxSupply=3)
      for (let i = 0; i < 3; i++) {
        await nft.connect(minter).mintCard(user1.address, 1, []);
      }
      await expect(nft.connect(minter).mintCard(user1.address, 1, []))
        .to.be.revertedWithCustomError(nft, "CardSoldOut").withArgs(1);

      // Drain card 2 (maxSupply=2)
      for (let i = 0; i < 2; i++) {
        await nft.connect(minter).mintCard(user1.address, 2, []);
      }

      // Common tier now fully exhausted
      expect(await nft.getAvailableCardIds(Rarity.Common)).to.deep.equal([]);

      // Drain Legendary (maxSupply=1)
      await nft.connect(minter).mintCard(user1.address, 5, []);
      expect(await nft.getAvailableCardIds(Rarity.Legendary)).to.deep.equal([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // supportsInterface
  // ─────────────────────────────────────────────────────────────────────────

  describe("supportsInterface", function () {
    it("supports ERC721 interface", async function () {
      expect(await nft.supportsInterface("0x80ac58cd")).to.equal(true);
    });

    it("supports EIP-2981 interface", async function () {
      expect(await nft.supportsInterface("0x2a55205a")).to.equal(true);
    });

    it("supports AccessControl interface", async function () {
      expect(await nft.supportsInterface("0x01ffc9a7")).to.equal(true);
    });
  });
});
