# Public repository

Private canonical: `6th-Element-Labs/dispatch`  
Public release mirror: `6th-Element-Labs/dispatch-public`  
Private-development CI: `6th-Element-Labs/dispatch-ci`

Do not rename the private repository. `dispatch-ci` stays a swept CI sandbox.

## Human gates

- [x] Create public `6th-Element-Labs/dispatch-public`
- [x] Enable issues, disable wiki and projects
- [x] Enable secret scanning and private vulnerability reporting
- [x] Create the protected `release` environment, restricted to `v*` tags
- [ ] Set the nine release secrets interactively
- [ ] Export and push the `Release v0.1.0` snapshot
- [ ] Wait for public Linux and macOS CI
- [ ] Push annotated `v0.1.0` after public CI is green
- [ ] Complete clean-Mac and updater acceptance
- [ ] Publish the draft only after acceptance

## Secrets

Set these on `6th-Element-Labs/dispatch-public` in the `release` environment.
Commands are in `deploy/public/docs/RELEASING.md`. Never echo secret values.

## First snapshot and tag

Export from the private canonical tree into an empty directory. Commit
`Release v0.1.0` as StevenRidder. Push public `main`. Wait for public CI.
Create and push the annotated `v0.1.0` tag only after that CI is green.

Do not overwrite a published asset or tag. If a published release is faulty,
ship a new patch release.
