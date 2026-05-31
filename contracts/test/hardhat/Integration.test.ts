/**
 * Phase 5 — Full End-to-End Integration Test
 *
 * Journey:
 *   1. Deploy all 4 contracts and wire permissions.
 *   2. WalletA opens a pack → 5 cards minted, pack revenue credited in splitter.
 *   3. WalletA lists one card at 1 ETH.
 *   4. WalletB buys it → royalties + platform fee + seller proceeds credited.
 *   5. Verify every claimable balance is exactly correct.
 *   6. Every party calls claim() → assert exact ETH received.
 *   7. Assert splitter ETH balance == 0 after all claims.
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  PokemonCardNFT,
  PaymentSplitter,
  GachaPack,
  Marketplace,
} from "../../typechain-types";

describe("Integration — Full End-to-End Journey", function () {
  // ─── Signers ──────────────────────────────────────────────────────────────
  let admin:    HardhatEthersSigner;
  let platform: HardhatEthersSigner; // marketplace fee + card royalty 1 + pack revenue
  let issuer:   HardhatEthersSigner; // card royalty 2 + pack revenue
  let walletA:  HardhatEthersSigner; // opens pack, lists card (seller)
  let walletB:  HardhatEthersSigner; // buys card (buyer)

  // ─── Contracts ────────────────────────────────────────────────────────────
  let nft:     PokemonCardNFT;
  let splitter: PaymentSplitter;
  let gacha:   GachaPack;
  let market:  Marketplace;

  // ─── Constants ────────────────────────────────────────────────────────────
  const PACK_PRICE          = ethers.parseEther("0.01");
  const SALE_PRICE          = ethers.parseEther("1");
  const GACHA_PLATFORM_BPS  = 8000n;  // 80 %
  const CARD_ROYALTY_1_BPS  = 500n;   // 5 %  (platform)
  const CARD_ROYALTY_2_BPS  = 300n;   // 3 %  (issuer)
  const MARKET_PLATFORM_BPS = 250n;   // 2.5 %

  const MINTER_ROLE    = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const DEPOSITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("DEPOSITOR_ROLE"));

  // ─── Setup ────────────────────────────────────────────────────────────────
  before(async function () {
    [admin, platform, issuer, walletA, walletB] = await ethers.getSigners();

    // 1. Deploy
    nft      = await (await ethers.getContractFactory("PokemonCardNFT")).deploy(admin.address) as PokemonCardNFT;
    splitter = await (await ethers.getContractFactory("PaymentSplitter")).deploy(admin.address) as PaymentSplitter;
    gacha    = await (await ethers.getContractFactory("GachaPack")).deploy(
      nft.target, splitter.target,
      platform.address, issuer.address, GACHA_PLATFORM_BPS
    ) as GachaPack;
    market   = await (await ethers.getContractFactory("Marketplace")).deploy(
      nft.target, splitter.target,
      platform.address, MARKET_PLATFORM_BPS
    ) as Marketplace;

    await nft.waitForDeployment();
    await splitter.waitForDeployment();
    await gacha.waitForDeployment();
    await market.waitForDeployment();

    // 2. Wire permissions
    await nft.connect(admin).grantRole(MINTER_ROLE, gacha.target);
    await splitter.connect(admin).grantRole(DEPOSITOR_ROLE, gacha.target);
    await splitter.connect(admin).grantRole(DEPOSITOR_ROLE, market.target);

    // 3. Seed the card pool so openPack has inventory to draw from.
    //    Use 500 bps (platform) + 300 bps (issuer) = 800 bps total royalty —
    //    matches CARD_ROYALTY_1_BPS / CARD_ROYALTY_2_BPS constants below.
    const templates = [
      { cardId: 1,  name: "Rattata",  rarity: 0, pokemonType: "Normal",   hp: 30,  attack: "Tackle - 20",     maxSupply: 50,  currentSupply: 0, floorPrice: ethers.parseEther("0.001"), imageURI: "ipfs://1"  },
      { cardId: 2,  name: "Pidgey",   rarity: 0, pokemonType: "Flying",   hp: 40,  attack: "Gust - 20",       maxSupply: 50,  currentSupply: 0, floorPrice: ethers.parseEther("0.001"), imageURI: "ipfs://2"  },
      { cardId: 3,  name: "Machop",   rarity: 1, pokemonType: "Fight",    hp: 70,  attack: "Karate Chop - 40",maxSupply: 30,  currentSupply: 0, floorPrice: ethers.parseEther("0.007"), imageURI: "ipfs://3"  },
      { cardId: 4,  name: "Pikachu",  rarity: 2, pokemonType: "Electric", hp: 60,  attack: "Thunderbolt - 60",maxSupply: 15,  currentSupply: 0, floorPrice: ethers.parseEther("0.04"),  imageURI: "ipfs://4"  },
      { cardId: 5,  name: "Gyarados", rarity: 3, pokemonType: "Water",    hp: 130, attack: "Hyper Beam - 120",maxSupply: 8,   currentSupply: 0, floorPrice: ethers.parseEther("0.12"),  imageURI: "ipfs://5"  },
      { cardId: 6,  name: "Mewtwo",   rarity: 4, pokemonType: "Psychic",  hp: 150, attack: "Psystrike - 150", maxSupply: 3,   currentSupply: 0, floorPrice: ethers.parseEther("0.8"),   imageURI: "ipfs://6"  },
    ];
    // royalty receivers: platform 500 bps + issuer 300 bps (matches test constants)
    await nft.connect(admin).batchAddCards(
      templates,
      platform.address, Number(CARD_ROYALTY_1_BPS),
      issuer.address,   Number(CARD_ROYALTY_2_BPS)
    );
  });

  // ─── Shared state accumulated across it() blocks ─────────────────────────
  let listedTokenId: bigint;

  // ─── STEP 1: WalletA opens a pack ─────────────────────────────────────────
  it("STEP 1 — WalletA opens a pack: 5 cards minted, revenue routed to splitter", async function () {
    await gacha.connect(walletA).openPack({ value: PACK_PRICE });

    // 5 NFTs owned by WalletA
    expect(await nft.balanceOf(walletA.address)).to.equal(5);
    for (let i = 0; i < 5; i++) {
      expect(await nft.ownerOf(i)).to.equal(walletA.address);
    }

    // Splitter received the full pack price
    expect(await ethers.provider.getBalance(splitter.target)).to.equal(PACK_PRICE);

    // Pack revenue split: platform 80%, issuer 20%
    const platformPackAmt = (PACK_PRICE * GACHA_PLATFORM_BPS) / 10_000n;
    const issuerPackAmt   = PACK_PRICE - platformPackAmt;
    expect(await splitter.claimable(platform.address)).to.equal(platformPackAmt);
    expect(await splitter.claimable(issuer.address)).to.equal(issuerPackAmt);

    listedTokenId = 0n;
  });

  // ─── STEP 2: WalletA lists tokenId 0 on the marketplace ──────────────────
  it("STEP 2 — WalletA lists a card at 1 ETH", async function () {
    await nft.connect(walletA).approve(market.target, listedTokenId);
    await market.connect(walletA).listCard(listedTokenId, SALE_PRICE);

    const listing = await market.listings(listedTokenId);
    expect(listing.seller).to.equal(walletA.address);
    expect(listing.price).to.equal(SALE_PRICE);
  });

  // ─── STEP 3: WalletB buys the card ────────────────────────────────────────
  it("STEP 3 — WalletB buys the card: NFT transfers, all balances credited", async function () {
    await market.connect(walletB).buyCard(listedTokenId, { value: SALE_PRICE });

    // NFT now owned by WalletB
    expect(await nft.ownerOf(listedTokenId)).to.equal(walletB.address);

    // Listing deleted
    expect((await market.listings(listedTokenId)).price).to.equal(0);
  });

  // ─── STEP 4: Verify all claimable balances ─────────────────────────────────
  it("STEP 4 — All claimable balances are exactly correct", async function () {
    /**
     * Expected accounting (all amounts in ETH):
     *
     * From pack open (0.01 ETH total):
     *   platform : 0.01 × 80%  = 0.008 ETH
     *   issuer   : 0.01 × 20%  = 0.002 ETH
     *
     * From marketplace sale (1 ETH total):
     *   platform marketplace fee: 1 × 2.5%  = 0.025  ETH
     *   platform card royalty 1 : 1 × 5%    = 0.05   ETH
     *   issuer   card royalty 2 : 1 × 3%    = 0.03   ETH
     *   walletA  seller proceeds: 1 − 0.025 − 0.05 − 0.03 = 0.895 ETH
     *
     * Grand totals:
     *   platform : 0.008 + 0.025 + 0.05 = 0.083 ETH
     *   issuer   : 0.002 + 0.03         = 0.032 ETH
     *   walletA  : 0.895 ETH
     *   walletB  : 0 ETH
     *   TOTAL    : 1.01 ETH = packPrice + salePrice ✓
     */

    const packPlatform = (PACK_PRICE * GACHA_PLATFORM_BPS) / 10_000n;
    const packIssuer   = PACK_PRICE - packPlatform;

    const marketFee    = (SALE_PRICE * MARKET_PLATFORM_BPS) / 10_000n;
    const royalty1     = (SALE_PRICE * CARD_ROYALTY_1_BPS) / 10_000n;
    const royalty2     = (SALE_PRICE * CARD_ROYALTY_2_BPS) / 10_000n;
    const sellerProc   = SALE_PRICE - marketFee - royalty1 - royalty2;

    const expectedPlatform = packPlatform + marketFee + royalty1;
    const expectedIssuer   = packIssuer + royalty2;
    const expectedSellerA  = sellerProc;

    expect(await splitter.claimable(platform.address)).to.equal(expectedPlatform,
      "platform claimable mismatch");
    expect(await splitter.claimable(issuer.address)).to.equal(expectedIssuer,
      "issuer claimable mismatch");
    expect(await splitter.claimable(walletA.address)).to.equal(expectedSellerA,
      "walletA (seller) claimable mismatch");
    expect(await splitter.claimable(walletB.address)).to.equal(0,
      "walletB (buyer) should have nothing");

    // Splitter holds exactly packPrice + salePrice
    expect(await ethers.provider.getBalance(splitter.target))
      .to.equal(PACK_PRICE + SALE_PRICE);

    // Conservation: all claimable sums to total deposited
    const total = expectedPlatform + expectedIssuer + expectedSellerA;
    expect(total).to.equal(PACK_PRICE + SALE_PRICE);
  });

  // ─── STEP 5: All parties call claim() → verify ETH received ───────────────
  it("STEP 5 — All parties claim and receive exact ETH amounts", async function () {
    const packPlatform = (PACK_PRICE * GACHA_PLATFORM_BPS) / 10_000n;
    const packIssuer   = PACK_PRICE - packPlatform;
    const marketFee    = (SALE_PRICE * MARKET_PLATFORM_BPS) / 10_000n;
    const royalty1     = (SALE_PRICE * CARD_ROYALTY_1_BPS) / 10_000n;
    const royalty2     = (SALE_PRICE * CARD_ROYALTY_2_BPS) / 10_000n;
    const sellerProc   = SALE_PRICE - marketFee - royalty1 - royalty2;

    const expectedPlatform = packPlatform + marketFee + royalty1;
    const expectedIssuer   = packIssuer + royalty2;

    // Helper: measure net ETH gain accounting for gas
    async function claimAndMeasure(signer: HardhatEthersSigner): Promise<bigint> {
      const before = await ethers.provider.getBalance(signer.address);
      const tx     = await splitter.connect(signer).claim();
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const after  = await ethers.provider.getBalance(signer.address);
      return after - before + gasCost; // net ETH received
    }

    // platform claims
    expect(await claimAndMeasure(platform)).to.equal(expectedPlatform);
    expect(await splitter.claimable(platform.address)).to.equal(0);

    // issuer claims
    expect(await claimAndMeasure(issuer)).to.equal(expectedIssuer);
    expect(await splitter.claimable(issuer.address)).to.equal(0);

    // walletA (seller) claims
    expect(await claimAndMeasure(walletA)).to.equal(sellerProc);
    expect(await splitter.claimable(walletA.address)).to.equal(0);
  });

  // ─── STEP 6: Splitter drained to zero ─────────────────────────────────────
  it("STEP 6 — Splitter ETH balance is 0 after all claims", async function () {
    expect(await ethers.provider.getBalance(splitter.target)).to.equal(0);
  });
});
