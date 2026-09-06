-- CreateTable
CREATE TABLE "Symbol" (
    "symbol" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "exchange" TEXT NOT NULL DEFAULT 'US'
);

-- CreateTable
CREATE TABLE "QuoteLatest" (
    "symbol" TEXT NOT NULL PRIMARY KEY,
    "price" REAL NOT NULL,
    "dayOpen" REAL,
    "dayHigh" REAL,
    "dayLow" REAL,
    "prevClose" REAL,
    "volume" REAL,
    "asOf" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "source" TEXT NOT NULL,
    CONSTRAINT "QuoteLatest_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BarDaily" (
    "symbol" TEXT NOT NULL,
    "barDate" DATETIME NOT NULL,
    "open" REAL,
    "high" REAL,
    "low" REAL,
    "close" REAL,
    "volume" REAL,
    "adjFactor" REAL NOT NULL DEFAULT 1.0,

    PRIMARY KEY ("symbol", "barDate"),
    CONSTRAINT "BarDaily_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SymbolStats" (
    "symbol" TEXT NOT NULL PRIMARY KEY,
    "vol20d" REAL,
    "avgVolume20d" REAL,
    "high52w" REAL,
    "low52w" REAL,
    "beta" REAL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SymbolStats_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SymbolEvent" (
    "seq" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "symbol" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "score" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL,
    "resolvedAt" DATETIME,
    "triggerMetric" TEXT,
    "triggerThreshold" REAL,
    "clearStreak" INTEGER NOT NULL DEFAULT 0,
    "dedupeKey" TEXT NOT NULL,
    CONSTRAINT "SymbolEvent_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Watchlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "position" REAL NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seedWatermark" INTEGER NOT NULL,
    CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WatchlistItem_symbol_fkey" FOREIGN KEY ("symbol") REFERENCES "Symbol" ("symbol") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReadState" (
    "userId" TEXT NOT NULL,
    "watchlistId" TEXT NOT NULL,
    "watermark" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" DATETIME,

    PRIMARY KEY ("userId", "watchlistId"),
    CONSTRAINT "ReadState_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserEventState" (
    "userId" TEXT NOT NULL,
    "eventId" INTEGER NOT NULL,
    "acknowledgedAt" DATETIME,
    "dismissedAt" DATETIME,

    PRIMARY KEY ("userId", "eventId"),
    CONSTRAINT "UserEventState_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SymbolEvent" ("seq") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "SymbolEvent_dedupeKey_key" ON "SymbolEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "SymbolEvent_symbol_idx" ON "SymbolEvent"("symbol");

-- CreateIndex
CREATE INDEX "SymbolEvent_resolvedAt_idx" ON "SymbolEvent"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_symbol_key" ON "WatchlistItem"("watchlistId", "symbol");
