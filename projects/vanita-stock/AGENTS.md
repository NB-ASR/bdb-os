# Vanita project delivery workflow

These instructions apply to changes made to the Vanita Stock project in this workspace.

## Required release bookkeeping

After every completed Vanita change or update:

1. Test the affected workflow in proportion to its risk.
2. Update ClickUp task `869e4r65n` (`Vanita Stock System — Build and Pilot`) with the change, verification result, deployment status and any blocker.
3. Synchronize the audited Vanita source files to GitHub repository `NB-ASR/bdb-os` on branch `agent/vanita-stock-project` under `projects/vanita-stock/`.
4. Keep Vanita files isolated from the BDB OS application. Never commit Vanita files into the BDB OS application directories or directly to `main`.
5. Report the ClickUp update and GitHub commit/branch status in the final handoff. Never claim either is updated unless the corresponding write succeeded.

## Current GitHub safety blocker

The target repository is public. The Vanita source contains client-specific sample business records. Do not publish those records until the user either makes the repository private or explicitly approves public disclosure after being informed of the risk.
