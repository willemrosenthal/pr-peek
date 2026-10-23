-- CreateEnum
CREATE TYPE "ShowAuthors" AS ENUM ('off', 'review', 'all');

-- Turns the on/off setting into a choice. On becomes every row.
ALTER TABLE "UserSettings" ALTER COLUMN "showAuthors" DROP DEFAULT;
ALTER TABLE "UserSettings" ALTER COLUMN "showAuthors" TYPE "ShowAuthors"
  USING (CASE WHEN "showAuthors" THEN 'all' ELSE 'off' END)::"ShowAuthors";
ALTER TABLE "UserSettings" ALTER COLUMN "showAuthors" SET DEFAULT 'off';
