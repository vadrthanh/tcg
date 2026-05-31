// Contract ABIs and addresses. The address object is populated from
// deploy/addresses.json after running `npm run deploy:sepolia`.
// For local dev, update the addresses below.

export const CHAIN_ID = 11155111; // Sepolia

export const ADDRESSES = {
  PokemonCardNFT:  "0x0000000000000000000000000000000000000000",
  PaymentSplitter: "0x0000000000000000000000000000000000000000",
  GachaPack:       "0x0000000000000000000000000000000000000000",
  Marketplace:     "0x0000000000000000000000000000000000000000",
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
  "function approve(address, uint256)",
  "function isApprovedForAll(address, address) view returns (bool)",
  "function setApprovalForAll(address, bool)",
] as const;

export const GACHA_ABI = [
  "function packPrice() view returns (uint256)",
  "function openPack() payable",
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
