-- CreateTable
CREATE TABLE "Card" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "pokemonType" TEXT NOT NULL,
    "hp" INTEGER NOT NULL,
    "attack" TEXT NOT NULL,
    "maxSupply" INTEGER NOT NULL,
    "currentSupply" INTEGER NOT NULL DEFAULT 0,
    "floorPrice" TEXT NOT NULL,
    "imageURI" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MintedNFT" (
    "tokenId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "cardId" INTEGER NOT NULL,
    "owner" TEXT NOT NULL,
    "mintedTo" TEXT NOT NULL,
    "mintedAt" DATETIME NOT NULL,
    "txHash" TEXT NOT NULL,
    CONSTRAINT "MintedNFT_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "tokenId" INTEGER NOT NULL,
    "cardId" INTEGER NOT NULL,
    "seller" TEXT NOT NULL,
    "price" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "listedAt" DATETIME NOT NULL,
    "soldAt" DATETIME,
    "buyer" TEXT,
    "txHash" TEXT NOT NULL,
    CONSTRAINT "Listing_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "MintedNFT" ("tokenId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Listing_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "type" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "to" TEXT,
    "tokenIds" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL DEFAULT 0,
    "blockNumber" INTEGER NOT NULL,
    "timestamp" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RoyaltyClaim" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "claimant" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "logIndex" INTEGER NOT NULL DEFAULT 0,
    "timestamp" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "IndexerState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "lastBlock" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE INDEX "Card_rarity_idx" ON "Card"("rarity");

-- CreateIndex
CREATE INDEX "MintedNFT_owner_idx" ON "MintedNFT"("owner");

-- CreateIndex
CREATE INDEX "MintedNFT_cardId_idx" ON "MintedNFT"("cardId");

-- CreateIndex
CREATE INDEX "Listing_status_idx" ON "Listing"("status");

-- CreateIndex
CREATE INDEX "Listing_seller_idx" ON "Listing"("seller");

-- CreateIndex
CREATE INDEX "Listing_cardId_idx" ON "Listing"("cardId");

-- CreateIndex
CREATE INDEX "Listing_tokenId_status_idx" ON "Listing"("tokenId", "status");

-- CreateIndex
CREATE INDEX "Transaction_from_idx" ON "Transaction"("from");

-- CreateIndex
CREATE INDEX "Transaction_to_idx" ON "Transaction"("to");

-- CreateIndex
CREATE INDEX "Transaction_type_idx" ON "Transaction"("type");

-- CreateIndex
CREATE INDEX "Transaction_blockNumber_idx" ON "Transaction"("blockNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_txHash_logIndex_key" ON "Transaction"("txHash", "logIndex");

-- CreateIndex
CREATE INDEX "RoyaltyClaim_claimant_idx" ON "RoyaltyClaim"("claimant");

-- CreateIndex
CREATE UNIQUE INDEX "RoyaltyClaim_txHash_logIndex_key" ON "RoyaltyClaim"("txHash", "logIndex");
