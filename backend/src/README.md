To run the backend for development, run

```
pnpm start-db
pnpm serve
```

When you are done, run `pnpm stop-db` to stop it. You can also restart the database
with `pnpm restart-db` to load fresh sample data.

Instructor ratings are not included in the sample data and the frontend hides them
when there aren't any. `pnpm fetch-ratings` fetches them from Rate My Professors, but
see the comment in `rmp-api/fetcher.ts` before running it. It also fetches every
matched instructor's reviews to score them per course, one request a second, so a
full run takes around 20 to 30 minutes. Per-course scores need the instructors'
teaching history, so run it against a database with every past term loaded.
