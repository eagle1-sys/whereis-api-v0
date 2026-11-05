# Contributing

Anyone can send a pull request. Merging, deploying, and verifying against live shipments are
maintainer actions.

## Branches

- `develop` — integration branch. Features and fixes branch from here and merge back here.
- `main` — release branch. A maintainer merges `develop` into it when a release is cut.
- `hotfix/*` — for an urgent production bug: branch from `main`, then merge into both `main`
  and `develop`.

Deployment follows DEV (local Docker) → TEST (`whereis-api-v0-test`) → PROD
(`whereis-api-v0`). The background is in [discussion #82](https://github.com/orgs/eagle1-sys/discussions/82);
where that discussion and this file differ, this file describes current practice.

## How a change gets merged

1. **Prepare.** Branch from `develop`, keep the diff small, and add or extend a test.
2. **Open a PR.** Target `develop` and explain the problem, the fix, and how you verified it.
3. **Review.** Reviewers leave comments on the PR. Answer each point and fix inside the same
   PR; do not open a follow-up PR for review feedback.
4. **Merge (maintainers).** Reviewer feedback is resolved first. A push to `develop` then
   deploys PROD `whereis-api-v0` through CI.
5. **Deploy and verify (maintainers).** CI handles the PROD app. `make fly-deploy` deploys from
   a workstation instead, using the untracked local `fly.toml`; it targets the app named there
   (here `whereis-api-v0`), which is how the TEST app or a rollback is pushed. After either
   path, confirm the change against live shipments.

## Review conventions

- A PR body written by the DSH coding agent ends with:

  ```
  ---
  Prepared by DSH (DeepSeek Harness) — code, tests, and verification.
  ```

- A review written by Claude ends with `— Code reviewed by Claude`. Both agents post as the
  same GitHub account, so the sign-off is how they are told apart.
- CodeRabbit suggestions are part of the review: verify each reported bug, and for an
  improvement that is not adopted, open an issue or give a reason before merging
  ([discussion #266](https://github.com/orgs/eagle1-sys/discussions/266)).

## Checks

CI runs on every PR:

```bash
deno lint
deno check .
deno test -A tests/sfex-mapping-test.ts
deno task mcp:test
```

`deno task test` adds `tests/main-test.ts` to the check, which needs `.env` and the live API;
`make test` runs `deno task test` and `deno task mcp:test` inside the API container.
