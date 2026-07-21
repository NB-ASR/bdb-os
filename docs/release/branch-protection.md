# Main branch protection requirements

## Purpose

`main` is the production branch. It must remain deployable and must not become the meeting place for unfinished design, finance or inventory work.

## Required GitHub ruleset

Apply these rules to `main`:

1. Require a pull request before merging.
2. Require at least one approving review from another founder or designated technical reviewer.
3. Dismiss stale approvals when new commits are pushed.
4. Require all review conversations to be resolved.
5. Require the branch to be up to date before merge.
6. Require these status checks:
   - `BDB OS V1 Validation / validate`
   - `BDB OS V1 Validation / public-browser`
7. Block force pushes.
8. Block branch deletion.
9. Apply the rules to repository administrators.
10. Allow emergency bypass only to a named Founder group, with a mandatory ClickUp incident record.

The authenticated-browser job is manual because it requires protected test credentials and a dedicated disposable workspace. A release candidate should run it before a paying pilot or any authentication-sensitive launch.

## Pull-request content

Every production pull request must state:

- Business problem.
- Owning department.
- Records affected.
- Offline impact.
- Migration and rollback plan.
- Testing evidence.
- Risks and known deferrals.
- ClickUp report location.

## Database rule

A committed migration is not permission to apply it. Production migrations require:

1. Review of SQL and rollback plan.
2. Test on a local or Supabase branch database.
3. Database security test pass.
4. Explicit founder approval for production application.
5. Post-application verification and ClickUp record.

## Team branch boundaries

- Niki's design branches remain isolated until the visual direction is approved and transferred through reviewed department pull requests.
- Matthew's Accounts, Banking and Inventory branches own their business models and must consume the shared command/offline contracts rather than creating parallel foundations.
- QA/security branches may add shared safeguards, tests and contracts but must not redesign client screens or financial workflows.
