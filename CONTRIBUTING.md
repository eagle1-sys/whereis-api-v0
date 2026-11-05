# Contributing

## How a change gets merged

1. **Prepare.** Branch from `develop`, keep the diff small, and add or extend a test.
2. **Open a PR.** Target `develop` and explain the problem, the fix, and how you verified it.
3. **Review.** Reviewers leave comments on the PR. Answer each point and fix inside the same
   PR; do not open a follow-up PR for review feedback.
4. **Merge.** A maintainer merges into `develop`. `main` moves only when a maintainer says so.
5. **Deploy and verify.** After the merge: rebuild locally (`make update`), deploy with
   `make fly-deploy`, then confirm the change against live shipments.

## PR conventions

- One change per PR, titled in the `type(scope): summary` form (`fix(sfex): ...`, `docs: ...`).
- Describe the verification: what you ran, what you observed, and any limitation that remains.
- Do not reformat code you did not change.
- PR bodies written by the DSH coding agent end with:

  ```
  ---
  Prepared by DSH (DeepSeek Harness) — code, tests, and verification.
  ```

## Checks

- `deno lint` and `deno test` must pass.
- `make test` runs the API and MCP suites inside the API container.
