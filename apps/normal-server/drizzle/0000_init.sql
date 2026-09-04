CREATE TABLE "daily_logins" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"streak" integer DEFAULT 0 NOT NULL,
	"last_claim_date" date,
	"claimed_days" integer DEFAULT 0 NOT NULL,
	"month" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"game_id" text NOT NULL,
	"seat" integer NOT NULL,
	"player_id" uuid,
	"label" text NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"net" bigint NOT NULL,
	"won" boolean DEFAULT false NOT NULL,
	"best_category" integer,
	CONSTRAINT "game_players_game_id_seat_pk" PRIMARY KEY("game_id","seat")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"mode" text NOT NULL,
	"config" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"fee" bigint DEFAULT 0 NOT NULL,
	"cancelled" boolean DEFAULT false NOT NULL,
	"settlement_error" text
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"player_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"source" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_player_id_item_id_pk" PRIMARY KEY("player_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"rarity" text NOT NULL,
	"name_key" text NOT NULL,
	"asset_key" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_achievements" (
	"player_id" uuid NOT NULL,
	"achievement_id" text NOT NULL,
	"progress" bigint DEFAULT 0 NOT NULL,
	"unlocked_at" timestamp with time zone,
	CONSTRAINT "player_achievements_player_id_achievement_id_pk" PRIMARY KEY("player_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "player_stats" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"hands_played_holdem" integer DEFAULT 0 NOT NULL,
	"hands_won_holdem" integer DEFAULT 0 NOT NULL,
	"hands_played_blind" integer DEFAULT 0 NOT NULL,
	"hands_won_blind" integer DEFAULT 0 NOT NULL,
	"bot_hands" integer DEFAULT 0 NOT NULL,
	"current_win_streak" integer DEFAULT 0 NOT NULL,
	"best_win_streak" integer DEFAULT 0 NOT NULL,
	"current_lose_streak" integer DEFAULT 0 NOT NULL,
	"best_lose_streak" integer DEFAULT 0 NOT NULL,
	"best_hand_rank" integer DEFAULT 0 NOT NULL,
	"biggest_win" bigint DEFAULT 0 NOT NULL,
	"rooms_joined" integer DEFAULT 0 NOT NULL,
	"games_completed" integer DEFAULT 0 NOT NULL,
	"total_login_days" integer DEFAULT 0 NOT NULL,
	"login_streak" integer DEFAULT 0 NOT NULL,
	"best_login_streak" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" varchar(20) NOT NULL,
	"name_key" text NOT NULL,
	"balance" bigint DEFAULT 0 NOT NULL,
	"avatar_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"equipped_title" text,
	"equipped_badge" text,
	"last_relief_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_name_key_unique" UNIQUE("name_key"),
	CONSTRAINT "players_balance_non_negative" CHECK ("players"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "point_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"player_id" uuid,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"ref_id" text,
	"kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "daily_logins" ADD CONSTRAINT "daily_logins_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_achievements" ADD CONSTRAINT "player_achievements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_transactions" ADD CONSTRAINT "point_transactions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_players_player_idx" ON "game_players" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "games_room_started_idx" ON "games" USING btree ("room_id","started_at");--> statement-breakpoint
CREATE INDEX "items_category_rarity_idx" ON "items" USING btree ("category","rarity");--> statement-breakpoint
CREATE INDEX "point_transactions_player_created_idx" ON "point_transactions" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "point_transactions_reason_created_idx" ON "point_transactions" USING btree ("reason","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");