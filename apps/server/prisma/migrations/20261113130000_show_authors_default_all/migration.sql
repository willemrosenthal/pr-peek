-- New users see author pictures on every row. Existing users keep their choice. Only a
-- default, so the live code keeps working while this deploys.
ALTER TABLE "UserSettings" ALTER COLUMN "showAuthors" SET DEFAULT 'all';
