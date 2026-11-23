// Only an explicit rate-limit response confirms that Scalency refused the request.
export async function submitBatchDraft(send, onPause, isActive, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  for (let attempt = 0; ; attempt++) {
    if (!isActive()) throw new Error('Envoi interrompu.')
    try {
      return await send()
    } catch (error) {
      const seconds = error.retryAfterSeconds
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300 || attempt >= 2) throw error
      onPause(seconds)
      await sleep(seconds * 1000)
    }
  }
}
