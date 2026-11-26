import {addDays, clockMinutes, parisDate, parisToUtc, timeLabel} from './publicationPlan.js'
import {validDay} from './publications.js'
import {lotSchedule} from './lotSchedule.js'

export function reservedDay(job, now = Date.now()) {
  const due = Date.parse(job.not_before)
  return parisDate(Number.isFinite(due) ? Math.max(now, due) : now)
}

export function replacementWindow(window, count, now = Date.now()) {
  const {day, from, to} = window || {}
  const today = parisDate(now)
  if (!validDay(day) || day < today || day > addDays(today, 30)) throw Error('Choisis un jour dans les 30 prochains jours.')
  if (!Number.isInteger(count) || count < 1 || count > 100) throw Error('Sélectionne de 1 à 100 annonces.')
  const minute = clockMinutes(from)
  if (minute === null) throw Error('Choisis une heure de départ.')
  const start = parisToUtc(day, minute)
  if (timeLabel(start) !== from) throw Error('Cette heure n’existe pas à Paris ce jour-là.')
  if (start <= now) throw Error('Choisis une heure de départ à venir.')
  if (count === 1) {
    const end = parisToUtc(day, 23 * 60 + 59) + 59999
    return {times: [new Date(start).toISOString()], end: new Date(end).toISOString()}
  }
  const plan = lotSchedule({day, from, to}, count)
  const everyMinutes = Math.floor((Date.parse(plan.times[count - 1]) - start) / (60000 * (count - 1)))
  return {everyMinutes, end: plan.end, times: Array.from({length: count}, (_, i) => new Date(start + i * everyMinutes * 60000).toISOString())}
}
