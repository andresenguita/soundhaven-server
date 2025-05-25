-- CreateTable
CREATE TABLE "DiscoveryLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cardTitle" TEXT NOT NULL,
    "trackUri" TEXT NOT NULL,
    "added" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPlaylist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPlaylist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "uri" TEXT NOT NULL,
    "img" TEXT NOT NULL,
    "cover" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPlaylist_userId_key" ON "UserPlaylist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Card_uri_key" ON "Card"("uri");
