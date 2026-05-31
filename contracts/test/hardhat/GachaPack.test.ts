import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  PokemonCardNFT,
  PaymentSplitter,
  GachaPack,
} from "../../typechain-types";

describe("GachaPack", function () {
  let nft: PokemonCardNFT;
  let splitter: PaymentSplitter;
  let gacha: GachaPack;

  let admin: HardhatEthersSigner;
  let platform: HardhatEthersSigner;
  let issuer: HardhatEthersSigner;
  let buyer: HardhatEthersSigner;

  const MINTER_ROLE    = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const DEPOSITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSITOR_ROLE"));
  const PACK_PRICE     = ethers.parseEther("0.01");
  const PLATFORM_FEE_BPS = 8000n;

  // ─── Pool seeding helper ──────────────────────────────────────────────────

  function makeTemplate(
    cardId: number,
    rarity: number,
    maxSupply: number
  ): PokemonCardNFT.CardTemplateStruct {
    return {
      cardId,
      name:          `Card${cardId}`,
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

  async function seedStandardPool() {
    // Enough supply for a few packs: 12 Common, 9 Uncommon, 8 Rare, 6 UltraRare, 5 Legendary
    const templates = [
      // Common (rarity 0)
      ...[1,2,3,4].map(id => makeTemplate(id, 0, 50)),
      // Uncommon (rarity 1)
      ...[5,6,7].map(id => makeTemplate(id, 1, 30)),
      // Rare (rarity 2)
      ...[8,9].map(id => makeTemplate(id, 2, 15)),
      // UltraRare (rarity 3)
      makeTemplate(10, 3, 8),
      // Legendary (rarity 4)
      makeTemplate(11, 4, 3),
    ];
    await nft.connect(admin).batchAddCards(
      templates,
      platform.address, 300,
      issuer.address,   200
    );
  }

  async function deployAll() {
    [admin, platform, issuer, buyer] = await ethers.getSigners();

    const NFT = await ethers.getContractFactory("PokemonCardNFT");
    nft = await NFT.deploy(admin.address) as PokemonCardNFT;
    await nft.waitForDeployment();

    const Splitter = await ethers.getContractFactory("PaymentSplitter");
    splitter = await Splitter.deploy(admin.address) as PaymentSplitter;
    await splitter.waitForDeployment();

    const Gacha = await ethers.getContractFactory("GachaPack");
    gacha = await Gacha.deploy(
      nft.target, splitter.target,
      platform.address, issuer.address, PLATFORM_FEE_BPS
    ) as GachaPack;
    await gacha.waitForDeployment();

    await nft.connect(admin).grantRole(MINTER_ROLE, gacha.target);
    await splitter.connect(admin).grantRole(DEPOSITOR_ROLE, gacha.target);
  }

  beforeEach(async function () {
    await deployAll();
    await seedStandardPool();
  });

  // ─── Payment validation ───────────────────────────────────────────────────

  describe("payment validation", function () {
    it("reverts when payment is too low", async function () {
      await expect(
        gacha.connect(buyer).openPack({ value: ethers.parseEther("0.005") })
      ).to.be.revertedWithCustomError(gacha, "WrongPayment");
    });

    it("reverts when payment is too high", async function () {
      await expect(
        gacha.connect(buyer).openPack({ value: ethers.parseEther("0.02") })
      ).to.be.revertedWithCustomError(gacha, "WrongPayment");
    });

    it("reverts when no payment sent", async function () {
      await expect(
        gacha.connect(buyer).openPack({ value: 0 })
      ).to.be.revertedWithCustomError(gacha, "WrongPayment");
    });
  });

  // ─── Pack opening ─────────────────────────────────────────────────────────

  describe("openPack — card minting from pool", function () {
    it("mints exactly 5 cards to the buyer", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      expect(await nft.balanceOf(buyer.address)).to.equal(5);
    });

    it("mints cards with sequential tokenIds starting from 0", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      for (let i = 0; i < 5; i++) {
        expect(await nft.ownerOf(i)).to.equal(buyer.address);
      }
    });

    it("second pack gives tokenIds 5-9", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      for (let i = 5; i < 10; i++) {
        expect(await nft.ownerOf(i)).to.equal(buyer.address);
      }
    });

    it("each card has a valid rarity (0-4)", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      for (let i = 0; i < 5; i++) {
        const card = await nft.getCard(i);
        expect(Number(card.rarity)).to.be.gte(0).and.lte(4);
      }
    });

    it("each card has a non-empty name and imageURI", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      for (let i = 0; i < 5; i++) {
        const card = await nft.getCard(i);
        expect(card.name.length).to.be.gt(0);
        expect(card.imageURI.length).to.be.gt(0);
      }
    });

    it("each card has royalty receivers from the pool template", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      const rxs = await nft.getRoyaltyReceivers(0);
      expect(rxs.length).to.equal(2);
      expect(rxs[0].receiver).to.equal(platform.address); // platform
      expect(rxs[0].feeBps).to.equal(300);
      expect(rxs[1].receiver).to.equal(issuer.address);   // artist
      expect(rxs[1].feeBps).to.equal(200);
    });

    it("emits PackOpened with tokenIds, cardIds, and rarities", async function () {
      const tx      = await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      const receipt = await tx.wait();
      const event   = receipt?.logs
        .map((log) => { try { return gacha.interface.parseLog(log as any); } catch { return null; } })
        .find((e) => e?.name === "PackOpened");

      expect(event).to.not.be.null;
      expect(event!.args.tokenIds.length).to.equal(5);
      expect(event!.args.cardIds.length).to.equal(5);
      expect(event!.args.rarities.length).to.equal(5);
    });

    it("pool currentSupply increments after opening a pack", async function () {
      // Open pack and note which cardIds were minted via the event
      const tx      = await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      const receipt = await tx.wait();
      const event   = receipt?.logs
        .map((l) => { try { return gacha.interface.parseLog(l as any); } catch { return null; } })
        .find((e) => e?.name === "PackOpened");

      const mintedCardIds: bigint[] = event!.args.cardIds;
      // Each minted cardId should have currentSupply ≥ 1
      for (const cid of mintedCardIds) {
        const tpl = await nft.getCardTemplate(Number(cid));
        expect(tpl.currentSupply).to.be.gte(1);
      }
    });
  });

  // ─── Revenue routing ──────────────────────────────────────────────────────

  describe("revenue routing", function () {
    it("entire pack price lands in the splitter", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      expect(await ethers.provider.getBalance(splitter.target)).to.equal(PACK_PRICE);
    });

    it("platform receives 80% of pack price", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      const expected = (PACK_PRICE * PLATFORM_FEE_BPS) / 10_000n;
      expect(await splitter.claimable(platform.address)).to.equal(expected);
    });

    it("issuer receives remaining 20%", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      const platformAmt = (PACK_PRICE * PLATFORM_FEE_BPS) / 10_000n;
      expect(await splitter.claimable(issuer.address)).to.equal(PACK_PRICE - platformAmt);
    });

    it("platform + issuer sum to exact pack price", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      const p = await splitter.claimable(platform.address);
      const i = await splitter.claimable(issuer.address);
      expect(p + i).to.equal(PACK_PRICE);
    });

    it("gacha holds zero ETH after opening", async function () {
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      expect(await ethers.provider.getBalance(gacha.target)).to.equal(0);
    });
  });

  // ─── Inventory mechanics ──────────────────────────────────────────────────

  describe("inventory: card supply tracking", function () {
    it("pool is non-empty after seeding", async function () {
      const common = await nft.getAvailableCardIds(0);
      expect(common.length).to.be.gt(0);
    });

    it("opening multiple packs depletes pool supply", async function () {
      // Open 3 packs (15 cards) and verify total minted = 15
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      await gacha.connect(buyer).openPack({ value: PACK_PRICE });
      expect(await nft.balanceOf(buyer.address)).to.equal(15);
    });
  });

  describe("inventory: AllCardsSoldOut", function () {
    async function freshGacha() {
      const nft2      = await (await ethers.getContractFactory("PokemonCardNFT")).deploy(admin.address) as PokemonCardNFT;
      const splitter2 = await (await ethers.getContractFactory("PaymentSplitter")).deploy(admin.address) as PaymentSplitter;
      const gacha2    = await (await ethers.getContractFactory("GachaPack")).deploy(
        nft2.target, splitter2.target, platform.address, issuer.address, 8000
      ) as GachaPack;
      await nft2.connect(admin).grantRole(MINTER_ROLE, gacha2.target);
      await splitter2.connect(admin).grantRole(DEPOSITOR_ROLE, gacha2.target);
      return { nft2, gacha2 };
    }

    it("reverts AllCardsSoldOut when pool has no cards at all", async function () {
      const { gacha2 } = await freshGacha();
      // No cards added to the pool → immediate revert on any roll
      await expect(
        gacha2.connect(buyer).openPack({ value: PACK_PRICE })
      ).to.be.revertedWithCustomError(gacha2, "AllCardsSoldOut");
    });

    it("reverts AllCardsSoldOut after pool supply is exhausted", async function () {
      const { nft2, gacha2 } = await freshGacha();
      // 1 Common card with maxSupply=5.  All rolls (any rarity) fall down to Common.
      // One pack draws exactly 5 cards → exhausts the pool.
      await nft2.connect(admin).batchAddCards(
        [makeTemplate(1, 0, 5)],
        platform.address, 300,
        issuer.address,   200
      );
      // First pack succeeds (5 draws all served by the single Common card)
      await gacha2.connect(buyer).openPack({ value: PACK_PRICE });
      // Pool now exhausted — second pack must revert
      await expect(
        gacha2.connect(buyer).openPack({ value: PACK_PRICE })
      ).to.be.revertedWithCustomError(gacha2, "AllCardsSoldOut");
    });
  });

  describe("inventory: falldown mechanics", function () {
    it("can still open packs when a rarity tier is fully sold out (falldown active)", async function () {
      // Fresh contracts with tiny Legendary supply (1) and large Common supply
      const NFT3 = await ethers.getContractFactory("PokemonCardNFT");
      const nft3 = await NFT3.deploy(admin.address) as PokemonCardNFT;
      await nft3.waitForDeployment();

      const S3 = await ethers.getContractFactory("PaymentSplitter");
      const splitter3 = await S3.deploy(admin.address) as PaymentSplitter;
      await splitter3.waitForDeployment();

      const G3 = await ethers.getContractFactory("GachaPack");
      const gacha3 = await G3.deploy(
        nft3.target, splitter3.target, platform.address, issuer.address, 8000
      ) as GachaPack;
      await gacha3.waitForDeployment();
      await nft3.connect(admin).grantRole(MINTER_ROLE, gacha3.target);
      await splitter3.connect(admin).grantRole(DEPOSITOR_ROLE, gacha3.target);

      // Plenty of Common/Uncommon/Rare/UltraRare but Legendary maxSupply=1
      await nft3.connect(admin).batchAddCards(
        [
          makeTemplate(1, 0, 200), // Common × 200
          makeTemplate(2, 1, 100), // Uncommon × 100
          makeTemplate(3, 2, 50),  // Rare × 50
          makeTemplate(4, 3, 20),  // UltraRare × 20
          makeTemplate(5, 4, 1),   // Legendary × 1 — will sell out quickly
        ],
        platform.address, 300,
        issuer.address,   200
      );

      // Exhaust the Legendary slot by direct admin minting
      await nft3.connect(admin).grantRole(MINTER_ROLE, admin.address);
      await nft3.connect(admin)["mintCard(address,uint16)"](buyer.address, 5);

      // Legendary is now sold out
      expect((await nft3.getAvailableCardIds(4)).length).to.equal(0);

      // But openPack should still work — any Legendary roll falls down to UltraRare
      // (50+ packs should cover at least one Legendary roll statistically)
      // Just verify the pack opens without reverting
      for (let i = 0; i < 3; i++) {
        await expect(
          gacha3.connect(buyer).openPack({ value: PACK_PRICE })
        ).to.not.be.reverted;
      }
    });
  });

  // ─── Owner config ─────────────────────────────────────────────────────────

  describe("owner configuration", function () {
    it("owner can update pack price", async function () {
      await gacha.connect(admin).setPackPrice(ethers.parseEther("0.05"));
      expect(await gacha.packPrice()).to.equal(ethers.parseEther("0.05"));
    });

    it("non-owner cannot update pack price", async function () {
      await expect(
        gacha.connect(buyer).setPackPrice(ethers.parseEther("0.05"))
      ).to.be.revertedWithCustomError(gacha, "OwnableUnauthorizedAccount");
    });
  });
});
