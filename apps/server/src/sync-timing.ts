// How often each user's PRs sync with GitHub. Edit the numbers here to change it.
//
// It's per account, not per device: using the app on any device counts, and one sync
// serves all of them. The first rule that fits wins:
//
//   1. Used the app in the last `activeForMinutes`:  every `activeEveryMinutes`
//   2. In the user's quiet hours:                    every `quietEveryMinutes`
//   3. The Mac menu bar app is running:              every `desktopEveryMinutes`
//   4. Hasn't used the app in `awayAfterDays`:       every `awayEveryMinutes`
//   5. Anyone else:                                  every `defaultEveryMinutes`
//
// Syncs are dispatched once a minute, so intervals are whole minutes. Pull to refresh and
// "Refresh now" always sync right away.
export const SYNC_TIMING = {
  activeForMinutes: 60,
  activeEveryMinutes: 2,
  quietEveryMinutes: 15,
  desktopEveryMinutes: 2,
  awayAfterDays: 14,
  awayEveryMinutes: 30,
  defaultEveryMinutes: 5,
  // How often using the app is saved, at most. Coming back after this long also syncs
  // right away, if the last sync is older than `activeEveryMinutes`.
  activeSaveEveryMinutes: 10,
};
