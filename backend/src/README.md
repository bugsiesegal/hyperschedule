To run the backend for development, run

```
pnpm start-db
pnpm serve
```

When you are done, run `pnpm stop-db` to stop it. You can also restart the database
with `pnpm restart-db` to load fresh sample data.

Instructor ratings are not included in the sample data and the frontend hides them
when there aren't any. The fetcher (`pnpm fetcher`, or `pnpm prod:fetcher` in
production) refreshes them from Rate My Professors on its own, as soon as it starts
if they've never been refreshed and then once a week. A refresh sends one request a
second, so it takes around 20 to 30 minutes, and ratings appear when it finishes.
Per-course scores need the instructors' teaching history, so they work best with
every past term in the database. See `rmp-api/scheduler.ts`.
