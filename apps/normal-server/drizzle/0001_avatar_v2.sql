-- Avatar catalogue v1 -> v2 (Plan 8, avatar-3d design §3.3).
--
-- Hand-written: there is no schema delta to generate. `items.category` keeps its name and holds the
-- new slot vocabulary instead (`hair`, `top`, `bottom`, `shoes`, `hat`, `accessory`, `jewelry`,
-- `title`, `badge`), so everything below is data.
--
-- Three things have to happen, in this order:
--   1. the four new default items must exist before anybody can be granted one;
--   2. every *existing* player must be granted them — `seed()` upserts the catalogue on every boot
--      but grants nothing, and `isDefault` only reaches new accounts, so without this a player who
--      registered before Plan 8 would have no top, bottom, shoes or hair to wear;
--   3. the withdrawn slots (`base_*`, `face_*`) and the renamed `clothing_tee` leave the wardrobes
--      first and the catalogue second.
--
-- Idempotent throughout: re-running inserts nothing new, deletes nothing that is already gone, and
-- rewrites `category`/`asset_key` to the values they already hold.
--
-- Stored `players.avatar_config` values are deliberately *not* rewritten. They are read through
-- `readAvatarConfig`, which migrates v1 -> v2 on the way out (`inventory/avatar-migrate.ts`), and a
-- one-shot jsonb rewrite would have to be right the first time on data nobody can inspect after.

INSERT INTO "items" ("id", "category", "rarity", "name_key", "asset_key", "is_default") VALUES
	('hair_none', 'hair', 'common', 'items.hair_none', 'hair/hair_none', true),
	('top_tee', 'top', 'common', 'items.top_tee', 'top/top_tee', true),
	('bottom_jeans', 'bottom', 'common', 'items.bottom_jeans', 'bottom/bottom_jeans', true),
	('shoes_sneakers', 'shoes', 'common', 'items.shoes_sneakers', 'shoes/shoes_sneakers', true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "inventory" ("player_id", "item_id", "source") SELECT "id", 'hair_none', 'default' FROM "players" ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "inventory" ("player_id", "item_id", "source") SELECT "id", 'top_tee', 'default' FROM "players" ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "inventory" ("player_id", "item_id", "source") SELECT "id", 'bottom_jeans', 'default' FROM "players" ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "inventory" ("player_id", "item_id", "source") SELECT "id", 'shoes_sneakers', 'default' FROM "players" ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM "inventory" WHERE "item_id" IN ('base_01', 'base_02', 'base_03', 'base_04', 'base_05', 'face_01', 'face_02', 'face_03', 'face_04', 'face_05', 'clothing_tee');
--> statement-breakpoint
DELETE FROM "items" WHERE "id" IN ('base_01', 'base_02', 'base_03', 'base_04', 'base_05', 'face_01', 'face_02', 'face_03', 'face_04', 'face_05', 'clothing_tee');
--> statement-breakpoint
UPDATE "items" SET "category" = 'top' WHERE "category" = 'clothing';
--> statement-breakpoint
UPDATE "items" SET "category" = 'hat' WHERE "id" IN ('accessory_headband', 'accessory_conical_hat', 'hat_crown');
--> statement-breakpoint
UPDATE "items" SET "asset_key" = "category" || '/' || "id";
