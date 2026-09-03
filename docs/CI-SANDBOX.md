# CI sandbox (`dispatch-ci`)

Dispatch keeps its canonical source on the **private** repo
[`6th-Element-Labs/dispatch`](https://github.com/6th-Element-Labs/dispatch). GitHub
Actions minutes are billed on private repos and free on public ones, so — exactly
as Helm and Switchboard already do — CI runs on a separate **public sandbox** that
holds the **full actual tree** and the **same workflows**.

| Repo | Role | Authority |
|---|---|---|
| `6th-Element-Labs/dispatch` | Canonical source, PRs, Switchboard merge webhook | `done` · `merge_provenance` · `code_truth` |
| `6th-Element-Labs/dispatch-ci` | Public CI sandbox — push branches here first | `verification_only` |

The sandbox is **not** a product mirror. It is not scrubbed, its feature branches
are ephemeral, and it can never prove Done. Only a merge on the canonical repo can
(Switchboard `repo_topology`, `switchboard.project_repo_topology.v1`).

## Reference implementations

| Project | Canonical | Public CI | Required status |
|---|---|---|---|
| Switchboard | `6th-Element-Labs/projectplanner` | `6th-Element-Labs/projectplanner-ci` | `Switchboard CI / VM gate` |
| Helm | `StevenRidder/Helm` | `StevenRidder/helm-ci` | `helm-ci/full-suite` |
| Dispatch | `6th-Element-Labs/dispatch` | `6th-Element-Labs/dispatch-ci` | `dispatch-ci/full-suite` |

Canonical `main` requires `dispatch-ci/full-suite`. The sandbox runs the exact source
SHA, and `ci-sandbox.sh prove` stamps that result on the matching private commit.
Only the private canonical repository owns source truth and merge provenance.

Switchboard uses the stricter variant: the canonical dispatcher mirrors an exact
SHA to a disposable `ci/**` tag and invokes a workflow that lives on the sandbox's
*trusted default branch*, so agent-authored workflow files on the mirrored branch
are never executed. Dispatch uses the simpler Helm-style flow until it has a
fleet of agents authoring workflow changes; the upgrade path is
[`verify.yml` on projectplanner](https://github.com/6th-Element-Labs/projectplanner/blob/master/.github/workflows/verify.yml).

## One-time setup

From a Dispatch checkout with `gh` authenticated as a user who can administer
repositories under `6th-Element-Labs`:

```bash
gh repo create 6th-Element-Labs/dispatch-ci --public --description "Public CI sandbox for Dispatch — full tree, GitHub Actions run here for free. Not a product mirror; feature branches are ephemeral."
```

Then wire the local checkout and seed the sandbox baseline:

```bash
scripts/ci-sandbox.sh setup && scripts/ci-sandbox.sh refresh-main
```

After the first main commit and sandbox run are green, run
`scripts/ci-sandbox.sh protect-main` once to require the exact-SHA sandbox proof.

## Typical branch loop

```bash
git checkout -b claude/FOUNDATION-1-scaffold
```

Edit, commit, then run the local gate before spending any CI minutes:

```bash
bash scripts/dispatch_ci.sh
```

Prove the checkout is wired correctly:

```bash
scripts/ci-sandbox.sh doctor
```

Then use the sandbox proof flow to push the exact SHA, stamp the canonical status,
and open the PR:

```bash
scripts/ci-sandbox.sh open-pr claude/FOUNDATION-1-scaffold
```

That command pushes to the sandbox, waits for green, pushes the exact SHA to
canonical, stamps `dispatch-ci/full-suite`, and opens the PR.

Sandbox branches are terminal-scoped, the same rule Switchboard's
`external_ci_mirror.py` enforces with `_cleanup_terminal_mirror_branch`: once the
run is terminal and the proof is stamped on the canonical SHA, the sandbox copy is
deleted automatically by `push`. A red run stays put for inspection; sweep leftovers
with:

```bash
scripts/ci-sandbox.sh prune     # delete merged sandbox branches
```

`prune` keeps any branch that still exists on the canonical repo. We squash-merge,
so a merged branch is deleted from `origin` and its original SHA is never an
ancestor of `main` — which makes "still on origin" the honest signal for "someone
may still be working on this". Deleting a live agent's sandbox branch mid-run
breaks their gate for no gain. `prune --all` overrides when you know the
remainder is abandoned.

After the PR merges, refresh the dispatch baseline:

```bash
scripts/ci-sandbox.sh refresh-main
```

The commands above are the loop, not the whole interface. Run the script with no
arguments for the full list — `wait`, `status`, `sync-main`, and `delete` are not
described here on purpose, because a second copy of a command list is a copy that
goes stale:

```bash
scripts/ci-sandbox.sh
```

## Why `workflow_dispatch` is mandatory

`ci-sandbox.sh push` dispatches each workflow in `SANDBOX_WORKFLOWS` by name and
then gates on `workflow_dispatch` runs whose `headSha` equals the exact local SHA.
A workflow without `workflow_dispatch:` can never be dispatched, so the proof never
completes and `prove` refuses to stamp. `ci-sandbox.sh doctor` fails on this.

## Public artifact boundary

Actions logs and artifacts in the sandbox are public. The sandbox may run source,
unit, contract, and browser verification. It must not publish signed installers,
credentials, private mail, account identifiers, or provider payloads.

## Current state

The initial service foundation is being established. This section must be updated
only after the exact-SHA public gate and canonical branch protection are verified.
