-- A review request the user commented on, until the author replies or pushes.
ALTER TABLE "Item" ADD COLUMN "waitingOnAuthor" BOOLEAN NOT NULL DEFAULT false;
