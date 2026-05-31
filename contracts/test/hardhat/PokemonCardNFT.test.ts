import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { PokemonCardNFT } from "../../typechain-types";

// EIP-165 interface IDs
const ERC721_ID  = "0x80ac58cd";
const ERC2981_ID = "0x2a55205a";

// Full ABI selector for the freeform mintCard overload (disambiguates from mintCard(address,uint16))
const FREEFORM_MINT = "mintCard(address,(string,uint8,string,uint16,string),(address,uint96)[])";

describe("PokemonCardNFT", function () {
  let nft: PokemonCardNFT;
  let admin: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  let royalty1: HardhatEthersSigner;
  let royalty2: HardhatEthersSigner;

  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

  enum Rarity { Common, Uncommon, Rare, UltraRare, Legendary }

  const defaultCard = {
    name:        "Pikachu",
    rarity:      Rarity.Uncommon,
    pokemonType: "Electric",
    hp:          60,
    imageURI:    "ipfs://QmPikachu",
  };

  const mint = (signer: HardhatEthersSigner, to: string, card: typeof defaultCard, receivers: any[]) =>
    (nft.connect(signer) as any)[FREEFORM_MINT](to, card, receivers);

  beforeEach(async function () {
    [admin, minter, user, royalty1, royalty2] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("PokemonCardNFT");
    nft = await factory.deploy(admin.address) as PokemonCardNFT;
    await nft.waitForDeployment();
  });

  // ─── Access control ───────────────────────────────────────────────────────

  describe("mintCard — access control", function () {
    it("reverts when called by non-minter", async function () {
      const receivers = [{ receiver: royalty1.address, feeBps: 500 }];
      await expect(mint(user, user.address, defaultCard, receivers))
        .to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });

    it("succeeds after MINTER_ROLE is granted", async function () {
      await nft.connect(admin).grantRole(MINTER_ROLE, minter.address);
      const receivers = [{ receiver: royalty1.address, feeBps: 500 }];
      await expect(mint(minter, user.address, defaultCard, receivers))
        .to.emit(nft, "CardMinted");
    });

    it("reverts if MINTER_ROLE is later revoked", async function () {
      await nft.connect(admin).grantRole(MINTER_ROLE, minter.address);
      await nft.connect(admin).revokeRole(MINTER_ROLE, minter.address);
      const receivers = [{ receiver: royalty1.address, feeBps: 500 }];
      await expect(mint(minter, user.address, defaultCard, receivers))
        .to.be.revertedWithCustomError(nft, "AccessControlUnauthorizedAccount");
    });
  });

  // ─── Metadata ─────────────────────────────────────────────────────────────

  describe("metadata", function () {
    beforeEach(async function () {
      await nft.connect(admin).grantRole(MINTER_ROLE, minter.address);
    });

    it("stores card data correctly", async function () {
      const receivers = [{ receiver: royalty1.address, feeBps: 300 }];
      await mint(minter, user.address, defaultCard, receivers);
      const card = await nft.getCard(0);
      expect(card.name).to.equal("Pikachu");
      expect(card.rarity).to.equal(Rarity.Uncommon);
      expect(card.pokemonType).to.equal("Electric");
      expect(card.hp).to.equal(60);
      expect(card.imageURI).to.equal("ipfs://QmPikachu");
    });

    it("tokenURI returns the imageURI", async function () {
      await mint(minter, user.address, defaultCard, [{ receiver: royalty1.address, feeBps: 300 }]);
      expect(await nft.tokenURI(0)).to.equal("ipfs://QmPikachu");
    });

    it("increments tokenId for each mint", async function () {
      const receivers = [{ receiver: royalty1.address, feeBps: 300 }];
      await mint(minter, user.address, defaultCard, receivers);
      await mint(minter, user.address, defaultCard, receivers);
      expect(await nft.ownerOf(0)).to.equal(user.address);
      expect(await nft.ownerOf(1)).to.equal(user.address);
    });

    it("emits CardMinted with correct rarity", async function () {
      const receivers = [{ receiver: royalty1.address, feeBps: 300 }];
      await expect(mint(minter, user.address, defaultCard, receivers))
        .to.emit(nft, "CardMinted")
        .withArgs(user.address, 0, Rarity.Uncommon);
    });

    it("emits RoyaltyReceiversSet", async function () {
      const receivers = [{ receiver: royalty1.address, feeBps: 300 }];
      await expect(mint(minter, user.address, defaultCard, receivers))
        .to.emit(nft, "RoyaltyReceiversSet");
    });
  });

  // ─── Royalties ────────────────────────────────────────────────────────────

  describe("royaltyInfo — EIP-2981", function () {
    beforeEach(async function () {
      await nft.connect(admin).grantRole(MINTER_ROLE, minter.address);
    });

    it("returns correct total royalty for single receiver (500 bps = 5%)", async function () {
      await mint(minter, user.address, defaultCard, [{ receiver: royalty1.address, feeBps: 500 }]);
      const [, royaltyAmt] = await nft.royaltyInfo(0, ethers.parseEther("1"));
      expect(royaltyAmt).to.equal(ethers.parseEther("0.05"));
    });

    it("returns correct total royalty for multiple receivers (300 + 200 = 5%)", async function () {
      await mint(minter, user.address, defaultCard, [
        { receiver: royalty1.address, feeBps: 300 },
        { receiver: royalty2.address, feeBps: 200 },
      ]);
      const [, royaltyAmt] = await nft.royaltyInfo(0, ethers.parseEther("2"));
      expect(royaltyAmt).to.equal(ethers.parseEther("0.1"));
    });

    it("returns first receiver as the EIP-2981 receiver address", async function () {
      await mint(minter, user.address, defaultCard, [
        { receiver: royalty1.address, feeBps: 600 },
        { receiver: royalty2.address, feeBps: 200 },
      ]);
      const [receiver] = await nft.royaltyInfo(0, ethers.parseEther("1"));
      expect(receiver).to.equal(royalty1.address);
    });
  });

  // ─── Multi-receiver split ─────────────────────────────────────────────────

  describe("getRoyaltyReceivers", function () {
    beforeEach(async function () {
      await nft.connect(admin).grantRole(MINTER_ROLE, minter.address);
    });

    it("returns the full receiver array", async function () {
      await mint(minter, user.address, defaultCard, [
        { receiver: royalty1.address, feeBps: 600 },
        { receiver: royalty2.address, feeBps: 200 },
      ]);
      const stored = await nft.getRoyaltyReceivers(0);
      expect(stored.length).to.equal(2);
      expect(stored[0].receiver).to.equal(royalty1.address);
      expect(stored[0].feeBps).to.equal(600);
      expect(stored[1].receiver).to.equal(royalty2.address);
      expect(stored[1].feeBps).to.equal(200);
    });

    it("each token has an independent receiver array", async function () {
      await mint(minter, user.address, defaultCard, [{ receiver: royalty1.address, feeBps: 500 }]);
      await mint(minter, user.address, defaultCard, [{ receiver: royalty2.address, feeBps: 300 }]);
      expect((await nft.getRoyaltyReceivers(0))[0].receiver).to.equal(royalty1.address);
      expect((await nft.getRoyaltyReceivers(1))[0].receiver).to.equal(royalty2.address);
    });
  });

  // ─── Royalty cap enforcement ───────────────────────────────────────────────

  describe("royalty cap enforcement", function () {
    beforeEach(async function () {
      await nft.connect(admin).grantRole(MINTER_ROLE, minter.address);
    });

    it("reverts when total feeBps exceeds 1000 (10%)", async function () {
      await expect(mint(minter, user.address, defaultCard, [
        { receiver: royalty1.address, feeBps: 600 },
        { receiver: royalty2.address, feeBps: 500 },
      ])).to.be.revertedWithCustomError(nft, "RoyaltyCapExceeded");
    });

    it("accepts exactly MAX_ROYALTY_BPS (1000)", async function () {
      await expect(mint(minter, user.address, defaultCard, [
        { receiver: royalty1.address, feeBps: 600 },
        { receiver: royalty2.address, feeBps: 400 },
      ])).to.emit(nft, "CardMinted");
    });

    it("reverts when receivers array is empty", async function () {
      await expect(mint(minter, user.address, defaultCard, []))
        .to.be.revertedWithCustomError(nft, "EmptyReceivers");
    });

    it("reverts on zero-address receiver", async function () {
      await expect(mint(minter, user.address, defaultCard, [{ receiver: ethers.ZeroAddress, feeBps: 300 }]))
        .to.be.revertedWithCustomError(nft, "InvalidReceiver");
    });
  });

  // ─── supportsInterface ────────────────────────────────────────────────────

  describe("supportsInterface", function () {
    it("returns true for ERC-721 (0x80ac58cd)", async function () {
      expect(await nft.supportsInterface(ERC721_ID)).to.be.true;
    });

    it("returns true for EIP-2981 (0x2a55205a)", async function () {
      expect(await nft.supportsInterface(ERC2981_ID)).to.be.true;
    });

    it("returns false for a random interface", async function () {
      expect(await nft.supportsInterface("0xdeadbeef")).to.be.false;
    });
  });
});
