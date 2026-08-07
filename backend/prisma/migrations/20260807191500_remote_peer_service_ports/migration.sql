-- Capture the actual listening port for WebFig/SSH/Winbox on each router.
-- Defaults match the RouterOS out-of-the-box values so existing rows keep
-- their prior behaviour after the ALTER (backend was hardcoded to these).
ALTER TABLE "RemotePeer"
  ADD COLUMN "webfigPort" INTEGER NOT NULL DEFAULT 80,
  ADD COLUMN "sshPort" INTEGER NOT NULL DEFAULT 22,
  ADD COLUMN "winboxPort" INTEGER NOT NULL DEFAULT 8291;
