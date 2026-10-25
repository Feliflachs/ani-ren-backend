-- Los reclamos anteriores conservan sus recompensas; no inventar puntos históricos.
ALTER TABLE "MissionClaim" ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0 CHECK ("points" >= 0);
