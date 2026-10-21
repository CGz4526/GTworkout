import { subscribeCloudSession } from '../api/cloudSession'
import { accountDatabase } from '../data/accountTraining'

/** Runs for the whole app, including when logout happens outside account-training pages. */
export function observeTrainingSession(): () => void {
  return subscribeCloudSession(reason => {
    if (reason === 'AUTHENTICATION_REQUIRED') return // Local drafts remain usable while login is renewed.
    const cached = localStorage.getItem('workout-account-training-id')
    localStorage.removeItem('workout-account-training-id')
    if (cached) {
      try { void accountDatabase(cached).meta.put({ key: 'enabled', value: 'false' }).catch(() => { /* Require online identity on the next entry. */ }) }
      catch { /* Ignore malformed local account references, never open another user's cache. */ }
    }
  })
}
