// Contract ABIs and addresses. Addresses are read from Vite env vars
// (VITE_*) — see frontend/.env.example. The deploy script writes them to
// contracts/deploy/addresses.json after `npm run deploy:sepolia`; copy from
// there into frontend/.env (the file is gitignored).

const env = import.meta.env;

function requireAddr(name: string): string {
  const v = env[name];
  if (!v || !/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new Error(
      `${name} is not set or is not a valid address. ` +
      `Copy frontend/.env.example to frontend/.env and fill in deployed addresses.`
    );
  }
  return v;
}

export const CHAIN_ID = Number(env.VITE_CHAIN_ID ?? 11155111);

export const ADDRESSES = {
  PokemonCardNFT:  requireAddr("VITE_POKEMON_CARD_NFT_ADDRESS"),
  PaymentSplitter: requireAddr("VITE_PAYMENT_SPLITTER_ADDRESS"),
  GachaPack:       requireAddr("VITE_GACHA_PACK_ADDRESS"),
  Marketplace:     requireAddr("VITE_MARKETPLACE_ADDRESS"),
};

// ─── ABIs (minimal — only functions called by the UI) ────────────────────────

export const NFT_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "function getCard(uint256) view returns (tuple(string name, uint8 rarity, string pokemonType, uint16 hp, string imageURI))",
  "function getRoyaltyReceivers(uint256) view returns (tuple(address receiver, uint96 feeBps)[])",
  "function tokenCardId(uint256) view returns (uint16)",
  "function getCardTemplate(uint16) view returns (tuple(uint16 cardId, string name, uint8 rarity, string pokemonType, uint16 hp, string attack, uint16 maxSupply, uint16 currentSupply, uint96 floorPrice, string imageURI))",
  "function getPoolStatus() view returns (uint16[] cardIds, uint16[] remaining)",
  "function isApprovedForAll(address, address) view returns (bool)",
  "function setApprovalForAll(address, bool)",
  // Pool administration — gated to POOL_MANAGER_ROLE (the deployer).
  "function POOL_MANAGER_ROLE() view returns (bytes32)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function addCardToPool(tuple(uint16 cardId, string name, uint8 rarity, string pokemonType, uint16 hp, string attack, uint16 maxSupply, uint16 currentSupply, uint96 floorPrice, string imageURI) template, tuple(address receiver, uint96 feeBps)[] receivers)",
] as const;

export const GACHA_ABI = [
  "function packPrice() view returns (uint256)",
  "function CARDS_PER_PACK() view returns (uint256)",
  "function REVEAL_WINDOW() view returns (uint256)",
  // Block number of the caller's pending (unrevealed) commit, 0 if none.
  "function commitBlockOf(address) view returns (uint256)",
  // Two-step commit–reveal: commitPack() pays packPrice and records the block;
  // revealPack() (in a later block) draws + mints 5 cards and emits PackOpened.
  "function commitPack() payable",
  "function revealPack()",
  "event PackCommitted(address indexed buyer, uint256 commitBlock)",
  "event PackOpened(address indexed buyer, uint256[5] tokenIds, uint16[5] cardIds, uint8[5] rarities)",
] as const;

export const MARKET_ABI = [
  "function listings(uint256) view returns (address seller, uint256 price)",
  "function listCard(uint256 tokenId, uint256 price)",
  "function cancelListing(uint256 tokenId)",
  "function buyCard(uint256 tokenId) payable",
  "function getSuggestedPrice(uint256 tokenId) view returns (uint256)",
  "function getListingWithDetails(uint256 tokenId) view returns (address seller, uint256 price, string name, uint8 rarity, uint16 hp, string imageURI, uint16 cardId, uint96 suggestedPrice)",
  "event Listed(uint256 indexed tokenId, address indexed seller, uint256 price, uint8 rarity, uint16 cardId)",
  "event ListingCancelled(uint256 indexed tokenId, address indexed seller)",
  "event Purchased(uint256 indexed tokenId, address indexed buyer, address indexed seller, uint256 salePrice, uint256 platformFee, uint256 totalRoyalty, uint256 sellerProceeds)",
] as const;

export const SPLITTER_ABI = [
  "function claimable(address) view returns (uint256)",
  "function claim()",
  "event Claimed(address indexed recipient, uint256 amount)",
] as const;

export const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Ultra Rare", "Legendary"];
export const RARITY_COLORS = [
  "text-gray-400",
  "text-green-400",
  "text-blue-400",
  "text-purple-400",
  "text-yellow-400",
];
export const RARITY_GLOW = [
  "",
  "shadow-green-500/40",
  "shadow-blue-500/50",
  "shadow-purple-500/60",
  "shadow-yellow-500/70",
];
