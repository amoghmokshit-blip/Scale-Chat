# Branch protection — one-time setup

Authored 2026-05-26. **Repo admin (Surya) must run these commands** — they require
the `admin` permission on `Surya-slaychat/Scale-Chat`, which non-admin contributors
(including Mokshith / Claude sessions) don't have.

## What we're enforcing

Per founder direction (2026-05-26): **no code lands on `master`, `dev`, `qa`, or
`prod` without approval from BOTH `@amoghmokshit-blip` AND `@Surya-slaychat`.**

Mechanically:

- Direct pushes to the 4 protected branches are disabled.
- Every change must arrive as a PR.
- Every PR must have approving reviews from both required reviewers (driven by
  `.github/CODEOWNERS`).
- Stale reviews are dismissed when new commits are pushed.
- Force-push and branch deletion are disabled.

## One-shot setup — run these from any machine with `gh` admin auth

```bash
# Replace OWNER/REPO if you fork; for the canonical repo keep Surya-slaychat/Scale-Chat.
REPO="Surya-slaychat/Scale-Chat"

for BRANCH in master dev qa prod; do
  gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" \
    --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 2,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON
done
```

### Why each field

- `enforce_admins: true` — even admins must go through PR review. Removes the
  "I'm in a hurry, let me direct-push" temptation.
- `required_approving_review_count: 2` — both reviewers must approve.
- `require_code_owner_reviews: true` — combined with `CODEOWNERS`, this means
  the 2 approvals must be from the two named owners (not any 2 randoms).
- `dismiss_stale_reviews: true` — pushing new commits invalidates prior
  approvals. Forces re-review after material changes.
- `require_last_push_approval: true` — even the most recent commit needs
  re-approval; stops "approve early then push silently".
- `required_conversation_resolution: true` — every PR comment must be resolved
  before merge.
- `allow_force_pushes: false` + `allow_deletions: false` — preserves history;
  no one can `--force` rewrite or delete the branch.

## Verify protection is on

```bash
for BRANCH in master dev qa prod; do
  echo "=== $BRANCH ==="
  gh api "repos/Surya-slaychat/Scale-Chat/branches/$BRANCH/protection" \
    --jq '{
      reviews: .required_pull_request_reviews.required_approving_review_count,
      codeowners: .required_pull_request_reviews.require_code_owner_reviews,
      enforceAdmins: .enforce_admins.enabled,
      forcePush: .allow_force_pushes.enabled,
      deletions: .allow_deletions.enabled
    }'
done
```

Expected output per branch:

```json
{
  "reviews": 2,
  "codeowners": true,
  "enforceAdmins": true,
  "forcePush": false,
  "deletions": false
}
```

## Branch flow (devs)

```
                 (PR + 2 reviews)        (PR + 2 reviews)        (PR + 2 reviews)
feature-branch ─────────────────→ dev ─────────────────→ qa ─────────────────→ prod
                                   │
                                   └─→ master (active development line, same
                                       rules as dev — left as the default
                                       branch for now)
```

- **`feature/*` branches** — open from `dev` (or `master`), free push.
- **`dev`** — protected; PRs target it; both approvals required.
- **`qa`** — protected; release candidate after dev burn-in.
- **`prod`** — protected; deployed to users.
- **`master`** — protected; canonical development line. (Convention TBD: some
  teams retire `master` once `dev` is established. Keep both for now and revisit
  once the workflow settles.)

## Adding more reviewers later

Edit `.github/CODEOWNERS`. The `require_code_owner_reviews: true` flag means
GitHub auto-requests reviews from whoever's listed there. Adding a third
reviewer doesn't change the `2` count — at least 2 of the listed owners must
approve.

To require ALL listed owners (so e.g. all 3 of a 3-person team must approve),
bump `required_approving_review_count` to 3 in the JSON above and re-run the
loop.
