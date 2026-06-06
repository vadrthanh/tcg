// Shared row shapes returned by the backend API.
// Mirrors backend/prisma/schema.prisma — keep in sync if columns change.

export interface CardRow {
  id:            number;
  name:          string;
  rarity:        "Common" | "Uncommon" | "Rare" | "UltraRare" | "Legendary";
  pokemonType:   string;
  hp:            number;
  attack:        string;
  maxSupply:     number;
  currentSupply: number;
  floorPrice:    string;     // ETH string
  imageURI:      string;
  createdAt:     string;
}

export interface MintedNFTRow {
  tokenId:   number;
  cardId:    number;
  owner:     string;
  mintedTo:  string;
  mintedAt:  string;
  txHash:    string;
  card?:     CardRow;
}

export interface ListingRow {
  id:        number;
  tokenId:   number;
  cardId:    number;
  seller:    string;
  price:     string;          // ETH string
  status:    "active" | "sold" | "cancelled";
  listedAt:  string;
  soldAt:    string | null;
  buyer:     string | null;
  txHash:    string;
  card?:     CardRow;
  nft?:      { owner: string };
}

export type TxType = "pack_opened" | "card_bought" | "card_listed" | "card_cancelled";

export interface TransactionRow {
  id:          number;
  type:        TxType;
  from:        string;
  to:          string | null;
  tokenIds:    number[];      // server stores JSON-string; client receives number[]
  value:       string;
  txHash:      string;
  logIndex:    number;
  blockNumber: number;
  timestamp:   string;
}

export interface StatsResponse {
  totalCardTemplates:     number;
  totalNftsMinted:        number;
  totalListingsAllTime:   number;
  totalListingsSold:      number;
  totalRoyaltyClaimedEth: string;
}

export interface RarityStats {
  byRarity: Record<
    "Common" | "Uncommon" | "Rare" | "UltraRare" | "Legendary",
    { max: number; minted: number; remaining: number; cards: number }
  >;
}

export interface HealthResponse {
  ok:        boolean;
  chainId:   number;
  network:   string;
  lastBlock: number;
  contracts: {
    nft:         string;
    gacha:       string;
    marketplace: string;
    splitter:    string;
  };
}

export type Rarity = CardRow["rarity"];
