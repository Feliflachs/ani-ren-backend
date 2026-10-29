# Local avatars and world demo

The `Avatar` table contains collection, character name, local URL, source page,
active flag and ordering. Image files live in `public/avatars` and are served at
`/media/avatars`. The reviewed 41-image selection is recorded in
`scripts/avatar-catalog.json`, including each original download URL.

```sh
npm run db:deploy
npm run db:generate
npm run avatars:download   # only needed to restore the local image files
npm run seed:avatars
npm run seed:world
npm run seed:popular       # extra enthusiastic reviews for the four popular series
```

Stop the local API before regenerating Prisma on Windows if its engine DLL is
locked. Restart the API afterwards.

`seed:avatars` upserts the catalog and refreshes the image URL of users who chose
that avatar. It does not change which avatar they selected. Selecting `null`
through `PATCH /api/me/profile` restores the Ani-Ren mascot. Inactive entries are
excluded from `GET /api/avatars` and cannot be newly selected.

`seed:world` requires the anime records from the original `seed:demo`. It adds
60 fictional accounts (`demo_world_1` through `demo_world_60`) across 30 countries.
They use the existing `DEMO_PASSWORD` from `scripts/demo/data.ts`.
The workload is 240 reviews, 120 posts, 420 rating events total, 60 comments,
and social connections. Ratings, reviews and social actions go through the real
API, including library state and automatic Aura rewards. Historical timestamps
are based on a persisted anchor. Posts do not invent country ratings: geographic
statistics come from rating events with a country code.

Repeated runs reuse IDs and idempotency keys, preserve manual edits and do not
duplicate posts/reviews. Existing original demo profiles receive an avatar only
if they have neither an avatar selection nor an image URL. Personal accounts are
not changed by the seed. Sessions created for seeding are revoked afterwards.

The assets are references for this personal/local project; original sources are
retained in the manifest. This catalog does not claim redistribution rights.

`seed:popular` adds one new review per demo account for One Piece, Naruto,
Frieren and Attack on Titan. With the 80 demo accounts, this is 320 reviews:
256 at 5 stars, 32 at 4.5 and 32 at 4. Previous reviews remain intact; already
watched titles are recorded as rewatches. It uses each demo account's existing
country and the real review API. Stable operation keys make repeat runs skip
previously completed entries without overwriting manual edits.
