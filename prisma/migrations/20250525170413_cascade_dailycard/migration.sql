-- DropForeignKey
ALTER TABLE "DailyCard" DROP CONSTRAINT "DailyCard_cardId_fkey";

-- AddForeignKey
ALTER TABLE "DailyCard" ADD CONSTRAINT "DailyCard_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
