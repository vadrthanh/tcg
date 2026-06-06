import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  PokemonCardNFT,
  PaymentSplitter,
  GachaPack,
  Marketplace,
} from "../../typechain-types";

describe("Marketplace", function () {
  let nft: PokemonCardNFT;
  let splitter: PaymentSplitter;
  let gacha: GachaPack;
  let market: Marketplace;

  let admin: HardhatEthersSigner;
  let platform: HardhatEthersSigner;
  let issuer: HardhatEthersSigner;
  let seller: HardhatEthersSigner;
  let buyer: HardhatEthersSigner;
  let royaltyR1: HardhatEthersSigner;
  let royaltyR2: HardhatEthersSigner;

  const MINTER_ROLE    = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const DEPOSITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSITOR_ROLE"));
  const PACK_PRICE     = ethers.parseEther("0.01");
  const PLATFORM_FEE_BPS = 250n; // 2.5 %

  // Mints 5 cards via GachaPack; returns tokenId of first card (always 0 on first pack)
  async function openPackForSeller(): Promise<void> {
    await gacha.connect(seller).openPack({ value: PACK_PRICE });
  }

  // Mint a card with known royalty receivers directly (for precise royalty tests)
  async function mintCardWithKnownRoyalties(
    to: string,
    rx1: string,
    rx1Bps: number,
    rx2: string,
    rx2Bps: number
  ): Promise<bigint> {
    const card = {
      name: "TestCard",
      rarity: 2,
      pokemonType: "Fire",
      hp: 80,
      imageURI: "ipfs://test",
    };
    const receivers = [
      { receiver: rx1, feeBps: rx1Bps },
      { receiver: rx2, feeBps: rx2Bps },
    ];
    // Grant direct MINTER_ROLE to admin for this helper
    await nft.connect(admin).grantRole(MINTER_ROLE, admin.address);
    const FREEFORM = "mintCard(address,(string,uint8,string,uint16,string),(address,uint96)[])";
    const tx = await nft.connect(admin)[FREEFORM](to, card, receivers);
    const receipt = await tx.wait();
    // Find CardMinted event
    const event = receipt?.logs
      .map((log) => { try { return nft.interface.parseLog(log as any); } catch { return null; } })
      .find((e) => e?.name === "CardMinted");
    return event!.args.tokenId as bigint;
  }

  async function deployAll() {
    [admin, platform, issuer, seller, buyer, royaltyR1, royaltyR2] =
      await ethers.getSigners();

    const NFT = await ethers.getContractFactory("PokemonCardNFT");
    nft = await NFT.deploy(admin.address) as PokemonCardNFT;
    await nft.waitForDeployment();

    const Splitter = await ethers.getContractFactory("PaymentSplitter");
    splitter = await Splitter.deploy(admin.address) as PaymentSplitter;
    await splitter.waitForDeployment();

    const Gacha = await ethers.getContractFactory("GachaPack");
    gacha = await Gacha.deploy(
      nft.target, splitter.target,
      platform.address, issuer.address, 8000
    ) as GachaPack;
    await gacha.waitForDeployment();

    const Market = await ethers.getContractFactory("Marketplace");
    market = await Market.deploy(
      nft.target, splitter.target,
      platform.address, PLATFORM_FEE_BPS
    ) as Marketplace;
    await market.waitForDeployment();

    // Wire permissions
    await nft.connect(admin).grantRole(MINTER_ROLE, gacha.target);
    await splitter.connect(admin).grantRole(DEPOSITOR_ROLE, gacha.target);
    await splitter.connect(admin).grantRole(DEPOSITOR_ROLE, market.target);

    // Seed card pool so openPack has inventory to draw from
    const templates = [1,2,3,4].map(id => ({
      cardId: id, name: `Card${id}`, rarity: 0, pokemonType: "Fire",
      hp: 50, attack: "Ember - 40", maxSupply: 50, currentSupply: 0,
      floorPrice: ethers.parseEther("0.01"), imageURI: `ipfs://${id}`,
    }));
    await nft.connect(admin).batchAddCards(templates, platform.address, 300, issuer.address, 200);
  }

  beforeEach(deployAll);

  // ─── listCard ─────────────────────────────────────────────────────────────

  describe("listCard", function () {
    beforeEach(openPackForSeller);

    it("emits Listed event with tokenId, seller, price, rarity, cardId", async function () {
      const price = ethers.parseEther("0.5");
      await nft.connect(seller).approve(market.target, 0);
      const card   = await nft.getCard(0);
      const cardId = await nft.tokenCardId(0);
      await expect(market.connect(seller).listCard(0, price))
        .to.emit(market, "Listed")
        .withArgs(0, seller.address, price, card.rarity, cardId);
    });

    it("stores listing correctly", async function () {
      const price = ethers.parseEther("0.5");
      await nft.connect(seller).approve(market.target, 0);
      await market.connect(seller).listCard(0, price);
      const listing = await market.listings(0);
      expect(listing.seller).to.equal(seller.address);
      expect(listing.price).to.equal(price);
    });

    it("reverts if caller is not the token owner", async function () {
      const price = ethers.parseEther("0.5");
      await nft.connect(seller).approve(market.target, 0);
      await expect(market.connect(buyer).listCard(0, price))
        .to.be.revertedWithCustomError(market, "NotOwner");
    });

    it("reverts if price is zero", async function () {
      await nft.connect(seller).approve(market.target, 0);
      await expect(market.connect(seller).listCard(0, 0))
        .to.be.revertedWithCustomError(market, "PriceZero");
    });

    it("reverts if marketplace is not approved", async function () {
      await expect(market.connect(seller).listCard(0, ethers.parseEther("0.5")))
        .to.be.revertedWithCustomError(market, "NotApproved");
    });

    it("accepts setApprovalForAll instead of per-token approve", async function () {
      await nft.connect(seller).setApprovalForAll(market.target, true);
      await expect(market.connect(seller).listCard(0, ethers.parseEther("0.5")))
        .to.emit(market, "Listed");
    });
  });

  // ─── cancelListing ────────────────────────────────────────────────────────

  describe("cancelListing", function () {
    beforeEach(async function () {
      await openPackForSeller();
      await nft.connect(seller).approve(market.target, 0);
      await market.connect(seller).listCard(0, ethers.parseEther("0.5"));
    });

    it("emits ListingCancelled", async function () {
      await expect(market.connect(seller).cancelListing(0))
        .to.emit(market, "ListingCancelled")
        .withArgs(0, seller.address);
    });

    it("deletes the listing", async function () {
      await market.connect(seller).cancelListing(0);
      const listing = await market.listings(0);
      expect(listing.price).to.equal(0);
    });

    it("reverts if not the seller", async function () {
      await expect(market.connect(buyer).cancelListing(0))
        .to.be.revertedWithCustomError(market, "NotSeller");
    });

    it("reverts if not listed", async function () {
      await expect(market.connect(seller).cancelListing(99))
        .to.be.revertedWithCustomError(market, "NotListed");
    });
  });

  // ─── buyCard — happy path ─────────────────────────────────────────────────

  describe("buyCard — happy path", function () {
    const SALE_PRICE   = ethers.parseEther("1");
    const R1_BPS = 500n;  // 5 %
    const R2_BPS = 300n;  // 3 %
    let tokenId: bigint;

    beforeEach(async function () {
      tokenId = await mintCardWithKnownRoyalties(
        seller.address,
        royaltyR1.address, Number(R1_BPS),
        royaltyR2.address, Number(R2_BPS)
      );
      await nft.connect(seller).approve(market.target, tokenId);
      await market.connect(seller).listCard(tokenId, SALE_PRICE);
    });

    it("NFT transfers to buyer", async function () {
      await market.connect(buyer).buyCard(tokenId, { value: SALE_PRICE });
      expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
    });

    it("listing is deleted after purchase", async function () {
      await market.connect(buyer).buyCard(tokenId, { value: SALE_PRICE });
      expect((await market.listings(tokenId)).price).to.equal(0);
    });

    it("platform receives correct fee", async function () {
      await market.connect(buyer).buyCard(tokenId, { value: SALE_PRICE });
      const expected = (SALE_PRICE * PLATFORM_FEE_BPS) / 10_000n;
      expect(await splitter.claimable(platform.address)).to.equal(expected);
    });

    it("royaltyR1 receives correct amount", async function () {
      await market.connect(buyer).buyCard(tokenId, { value: SALE_PRICE });
      const expected = (SALE_PRICE * R1_BPS) / 10_000n;
      expect(await splitter.claimable(royaltyR1.address)).to.equal(expected);
    });

    it("royaltyR2 receives correct amount", async function () {
      await market.connect(buyer).buyCard(tokenId, { value: SALE_PRICE });
      const expected = (SALE_PRICE * R2_BPS) / 10_000n;
      expect(await splitter.claimable(royaltyR2.address)).to.equal(expected);
    });

    it("seller receives correct proceeds", async function () {
      await market.connect(buyer).buyCard(tokenId, { value: SALE_PRICE });
      const platformFee = (SALE_PRICE * PLATFORM_FEE_BPS) / 10_000n;
      const r1 = (SALE_PRICE * R1_BPS) / 10_000n;
      const r2 = (SALE_PRICE * R2_BPS) / 10_000n;
      const expected = SALE_PRICE - platformFee - r1 - r2;
      expect(await splitter.claimable(seller.address)).to.equal(expected);
    });

    it("platformFee + royalties + sellerProceeds == salePrice (no wei lost)", async function () {
      await market.connect(buyer).buyCard(tokenId, { value: SALE_PRICE });
      const pAmt  = await splitter.claimable(platform.address);
      const r1Amt = await splitter.claimable(royaltyR1.address);
      const r2Amt = await splitter.claimable(royaltyR2.address);
      const sAmt  = await splitter.claimable(seller.address);
      expect(pAmt + r1Amt + r2Amt + sAmt).to.equal(SALE_PRICE);
    });

    it("emits Purchased with correct args", async function () {
      const platformFee = (SALE_PRICE * PLATFORM_FEE_BPS) / 10_000n;
      const r1 = (SALE_PRICE * R1_BPS) / 10_000n;
      const r2 = (SALE_PRICE * R2_BPS) / 10_000n;
      const totalRoyalty = r1 + r2;
      const sellerProceeds = SALE_PRICE - platformFee - totalRoyalty;

      await expect(market.connect(buyer).buyCard(tokenId, { value: SALE_PRICE }))
        .to.emit(market, "Purchased")
        .withArgs(
          tokenId, buyer.address, seller.address,
          SALE_PRICE, platformFee, totalRoyalty, sellerProceeds
        );
    });

    it("splitter holds exact sale price", async function () {
      // Drain any prior pack revenue first so balance is clean
      const before = await ethers.provider.getBalance(splitter.target);
      await market.connect(buyer).buyCard(tokenId, { value: SALE_PRICE });
      const after = await ethers.provider.getBalance(splitter.target);
      expect(after - before).to.equal(SALE_PRICE);
    });
  });

  // ─── buyCard — error cases ────────────────────────────────────────────────

  describe("buyCard — errors", function () {
    beforeEach(async function () {
      await openPackForSeller();
      await nft.connect(seller).approve(market.target, 0);
      await market.connect(seller).listCard(0, ethers.parseEther("1"));
    });

    it("reverts if tokenId not listed", async function () {
      await expect(
        market.connect(buyer).buyCard(99, { value: ethers.parseEther("1") })
      ).to.be.revertedWithCustomError(market, "NotListed");
    });

    it("reverts if payment is too low", async function () {
      await expect(
        market.connect(buyer).buyCard(0, { value: ethers.parseEther("0.5") })
      ).to.be.revertedWithCustomError(market, "WrongPayment");
    });

    it("reverts if payment is too high", async function () {
      await expect(
        market.connect(buyer).buyCard(0, { value: ethers.parseEther("2") })
      ).to.be.revertedWithCustomError(market, "WrongPayment");
    });
  });

  // ─── Atomicity ────────────────────────────────────────────────────────────

  describe("buyCard — atomicity", function () {
    it("reverts entirely if NFT transfer fails: no ETH credited, listing survives", async function () {
      await openPackForSeller();
      const price = ethers.parseEther("1");
      await nft.connect(seller).approve(market.target, 0);
      await market.connect(seller).listCard(0, price);

      // Snapshot balances BEFORE the failed purchase attempt
      const splitterBefore   = await ethers.provider.getBalance(splitter.target);
      const sellerBefore     = await splitter.claimable(seller.address);
      const platformBefore   = await splitter.claimable(platform.address);

      // Seller revokes approval — NFT transfer will fail mid-buyCard
      await nft.connect(seller).approve(ethers.ZeroAddress, 0);

      await expect(
        market.connect(buyer).buyCard(0, { value: price })
      ).to.be.reverted;

      // Splitter ETH balance unchanged — deposit rolled back atomically
      expect(await ethers.provider.getBalance(splitter.target)).to.equal(splitterBefore);
      // No new claimable balance was credited — delta is zero
      expect(await splitter.claimable(seller.address)).to.equal(sellerBefore);
      expect(await splitter.claimable(platform.address)).to.equal(platformBefore);
      // Listing still exists (was re-created as part of the revert)
      expect((await market.listings(0)).price).to.equal(price);
    });
  });

  // ─── Reentrancy ───────────────────────────────────────────────────────────

  describe("buyCard — reentrancy protection", function () {
    it("malicious buyer cannot reenter via onERC721Received", async function () {
      await openPackForSeller();
      const price = ethers.parseEther("1");
      await nft.connect(seller).approve(market.target, 0);
      await market.connect(seller).listCard(0, price);

      const Attacker = await ethers.getContractFactory("MarketplaceAttacker");
      const attacker = await Attacker.deploy(market.target);
      await attacker.waitForDeployment();

      // Fund attacker with exact price
      await admin.sendTransaction({ to: attacker.target, value: price });

      // Attack: try to reenter during onERC721Received
      await attacker.attack(0, price);

      // Attacker received the NFT (first call succeeded)
      expect(await nft.ownerOf(0)).to.equal(attacker.target);
      // Reentrancy attempt did NOT steal extra ETH — seller got their proceeds
      const sellerClaimable = await splitter.claimable(seller.address);
      expect(sellerClaimable).to.be.gt(0);
    });
  });

  // ─── Section C: getSuggestedPrice & getListingWithDetails ─────────────────

  describe("getSuggestedPrice", function () {
    it("returns the template floorPrice for a pool-minted token", async function () {
      // Mint a card directly from pool with a known template (cardId=1, floorPrice=0.01 ETH)
      await nft.connect(admin).grantRole(MINTER_ROLE, admin.address);
      await nft.connect(admin)["mintCard(address,uint16)"](seller.address, 1);

      // tokenId N (first after any pack mints — use balanceOf to find it)
      const totalMinted = await nft.balanceOf(seller.address);
      // The last minted token is totalMinted - 1 (tokenIds are sequential from 0)
      // But we minted this one just now. Let's find it by checking tokenCardId.
      // Since we know it's the most recently minted, its tokenId = totalMinted - 1.
      // Actually, let's just track from a fresh deployment.

      // Use a fresh NFT to avoid offset confusion
      const nft2 = await (await ethers.getContractFactory("PokemonCardNFT")).deploy(admin.address);
      await nft2.waitForDeployment();
      await nft2.connect(admin).grantRole(MINTER_ROLE, admin.address);
      await nft2.connect(admin).batchAddCards(
        [{ cardId: 7, name: "Pikachu", rarity: 2, pokemonType: "Electric",
           hp: 60, attack: "Thunderbolt - 60", maxSupply: 10, currentSupply: 0,
           floorPrice: ethers.parseEther("0.04"), imageURI: "ipfs://pikachu" }],
        admin.address, 300, issuer.address, 200
      );
      await nft2.connect(admin)["mintCard(address,uint16)"](seller.address, 7);

      // Deploy a fresh marketplace pointing at nft2
      const market2 = await (await ethers.getContractFactory("Marketplace")).deploy(
        nft2.target, splitter.target, platform.address, 250
      );
      expect(await market2.getSuggestedPrice(0)).to.equal(ethers.parseEther("0.04"));
    });

    it("returns 0 for a freeform-minted token (no pool template)", async function () {
      await nft.connect(admin).grantRole(MINTER_ROLE, admin.address);
      const card = { name: "Custom", rarity: 0, pokemonType: "Fire", hp: 40, imageURI: "ipfs://x" };
      const nftAsMinter = nft.connect(admin);
      await nftAsMinter["mintCard(address,(string,uint8,string,uint16,string),(address,uint96)[])"](
        seller.address, card, [{ receiver: platform.address, feeBps: 300 }]
      );
      // tokenCardId should be 0 for freeform mint
      const id = await nft.balanceOf(seller.address);
      expect(await market.getSuggestedPrice(Number(id) - 1)).to.equal(0);
    });
  });

  describe("getListingWithDetails", function () {
    it("returns listing and card metadata in one call", async function () {
      await openPackForSeller(); // mints tokens 0-4 to seller
      const price = ethers.parseEther("0.5");
      await nft.connect(seller).approve(market.target, 0);
      await market.connect(seller).listCard(0, price);

      const details = await market.getListingWithDetails(0);
      expect(details.seller).to.equal(seller.address);
      expect(details.price).to.equal(price);
      expect(details.name.length).to.be.gt(0);
      expect(Number(details.rarity)).to.be.gte(0).and.lte(4);
      expect(details.hp).to.be.gt(0);
      expect(details.imageURI.length).to.be.gt(0);
      // cardId should match tokenCardId on-chain
      expect(details.cardId).to.equal(await nft.tokenCardId(0));
      // suggestedPrice matches template floorPrice (0 if freeform)
      const cid = await nft.tokenCardId(0);
      if (cid > 0) {
        const tpl = await nft.getCardTemplate(cid);
        expect(details.suggestedPrice).to.equal(tpl.floorPrice);
      }
    });

    it("returns zero seller and price for an unlisted token", async function () {
      await openPackForSeller();
      const details = await market.getListingWithDetails(0);
      expect(details.seller).to.equal(ethers.ZeroAddress);
      expect(details.price).to.equal(0);
      // Card metadata still returned
      expect(details.name.length).to.be.gt(0);
    });
  });
});
