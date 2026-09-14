-- Five saved outfits per player (Plan 11, design §5.3 — same contract Plan 10 §5.4 speced), plus the
-- one data change avatar config v3 needs that v1 -> v2 did not: a new *required* slot.
--
-- Hand-written, in `0001_avatar_v2.sql`'s style. Two things happen here, in this order:
--   1. the new table, for the five saved outfits;
--   2. `outfit_casual01` — the one default `loadItemCatalog` insists every account can wear — must
--      exist in `items` and be granted to every *existing* player before anyone reads their avatar:
--      `seed()` upserts the catalogue on every boot but grants nothing, and `isDefault` only reaches
--      new accounts (`AuthService`), so without this an account that registered before Plan 11 would
--      migrate to an avatar wearing an outfit it does not own — `readAvatarConfig` would still show
--      it (that path has no ownership check), but the same player saving that exact figure back
--      through `PUT /api/me/avatar` would be refused `NOT_OWNED` for the very outfit they are shown
--      wearing.
--
-- Idempotent throughout: re-running inserts nothing new and grants nothing already granted.
CREATE TABLE IF NOT EXISTS "avatar_outfits" (
	"player_id" uuid NOT NULL,
	"slot" smallint NOT NULL,
	"name" varchar(24) NOT NULL,
	"config" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avatar_outfits_player_id_slot_pk" PRIMARY KEY("player_id","slot"),
	CONSTRAINT "avatar_outfits_slot_range" CHECK ("avatar_outfits"."slot" BETWEEN 1 AND 5)
);
--> statement-breakpoint
ALTER TABLE "avatar_outfits" ADD CONSTRAINT "avatar_outfits_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "items" ("id", "category", "rarity", "name_key", "asset_key", "is_default") VALUES
	('outfit_casual01', 'outfit', 'common', 'items.outfit_casual01', 'outfit/outfit_casual01', true)
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
INSERT INTO "inventory" ("player_id", "item_id", "source") SELECT "id", 'outfit_casual01', 'default' FROM "players" ON CONFLICT DO NOTHING;
