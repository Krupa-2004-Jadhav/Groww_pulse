-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "benchmarkSymbol" TEXT NOT NULL DEFAULT 'NIFTY50',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Watchlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME,
    "lastReviewedAt" DATETIME
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" DATETIME,
    CONSTRAINT "WatchlistItem_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WatchlistItem_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WatchlistPreferences" (
    "watchlistId" TEXT NOT NULL PRIMARY KEY,
    "priceThresholdPct" REAL NOT NULL DEFAULT 3.0,
    "volumeThresholdRatio" REAL NOT NULL DEFAULT 2.0,
    "sentimentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "eventAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sensitivity" TEXT NOT NULL DEFAULT 'balanced',
    "benchmarkSymbol" TEXT NOT NULL DEFAULT 'NIFTY50',
    CONSTRAINT "WatchlistPreferences_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockAcknowledgement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchlistId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "acknowledgedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockAcknowledgement_watchlistId_fkey" FOREIGN KEY ("watchlistId") REFERENCES "Watchlist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstrumentSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "price" REAL NOT NULL,
    "previousClose" REAL NOT NULL,
    "volume" REAL NOT NULL,
    "avgVolume20d" REAL NOT NULL,
    "volatility5d" REAL NOT NULL,
    "volatility30d" REAL NOT NULL,
    "benchmarkReturnPct" REAL NOT NULL DEFAULT 0,
    "sentimentScore" REAL,
    "previousSentimentScore" REAL,
    "sentimentArticleCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InstrumentSnapshot_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instrumentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confidence" TEXT NOT NULL,
    CONSTRAINT "Event_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_symbol_key" ON "Instrument"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_watchlistId_instrumentId_key" ON "WatchlistItem"("watchlistId", "instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "StockAcknowledgement_watchlistId_instrumentId_key" ON "StockAcknowledgement"("watchlistId", "instrumentId");

-- CreateIndex
CREATE INDEX "InstrumentSnapshot_instrumentId_capturedAt_idx" ON "InstrumentSnapshot"("instrumentId", "capturedAt");

-- CreateIndex
CREATE INDEX "Event_instrumentId_publishedAt_idx" ON "Event"("instrumentId", "publishedAt");
