To run the backend for development, run

```
pnpm start-db
pnpm serve
```

When you are done, run `pnpm stop-db` to stop it. You can also restart the database
with `pnpm restart-db` to load fresh sample data. 

Instructor ratings are not included in the sample data and the frontend hides them
when there aren't any. `pnpm fetch-ratings` fetches them from Rate My Professors, but
see the comment in `rmp-api/fetcher.ts` before running it.
