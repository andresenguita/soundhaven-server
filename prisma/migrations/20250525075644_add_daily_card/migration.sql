-- CreateTable
CREATE TABLE "DailyCard" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "cardId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyCard_userId_date_idx" ON "DailyCard"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyCard_userId_cardId_date_key" ON "DailyCard"("userId", "cardId", "date");

-- AddForeignKey
ALTER TABLE "DailyCard" ADD CONSTRAINT "DailyCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
