/**
 * Daily-note timeline planner. Pure functions only: the same input always
 * produces the same plan, so the Host computes it on every read and nothing
 * derived is persisted.
 *
 * A note's own words may carry scheduling hints:
 *   date      今天 / 明天 / 后天 / 周五 / 下周一 / 11月28日 / 11-28 / 2026-11-28 / @11-28
 *             today / tomorrow / fri / next mon
 *   deadline  the same date preceded by 截止 / by / due, or followed by 前 / 之前
 *   estimate  ~2h / 1.5小时 / 45m / 30分钟 / 半小时 / 半天
 *   priority  ! / !! / !!! / 紧急 / 重要
 * A date the person picks explicitly always wins over a parsed one.
 */

export const DEFAULT_ESTIMATE_MIN = 30
const DAY = 86400_000
const WEEKDAYS_ZH = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
const WEEKDAYS_EN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

/** Local calendar date of a Date as YYYY-MM-DD. */
export function isoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = parseDay(value)
  return isoDate(parsed) === value
}
function parseDay(value) { const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d, 12) }
export function addDays(day, count) { const date = parseDay(day); date.setDate(date.getDate() + count); return isoDate(date) }
export function weekday(day) { return parseDay(day).getDay() }
export function diffDays(a, b) { return Math.round((parseDay(b) - parseDay(a)) / DAY) }

/** Next date with the given weekday, strictly after today unless `allowToday`. */
function nextWeekday(today, target, nextWeek) {
  const current = weekday(today)
  let delta = (target - current + 7) % 7
  if (nextWeek) {
    // "下周X" means the X of the following calendar week (weeks start Monday).
    const toMonday = ((8 - current) % 7) || 7
    delta = toMonday + ((target + 6) % 7)
  }
  return addDays(today, delta)
}

function explicitDate(today, year, month, date) {
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`
  if (!isIsoDate(candidate)) return undefined
  return candidate
}

/** Read scheduling hints from a note's text relative to `today` (YYYY-MM-DD). */
export function parseHints(text, today) {
  const hints = {}
  if (typeof text !== 'string' || !text.trim()) return hints
  const source = text.toLowerCase()

  // Priority
  const bangs = /(?:^|\s)(!{1,3})(?=\s|$)/.exec(text)
  let priority = bangs ? bangs[1].length : 0
  if (/紧急|urgent|asap/.test(source)) priority = Math.max(priority, 2)
  else if (/重要|important/.test(source)) priority = Math.max(priority, 1)
  if (priority) hints.priority = priority

  // Estimate
  let estimate
  const hours = /~?\s*(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?|小时|个小时)(?![a-z])/i.exec(text)
  const minutes = /~?\s*(\d+)\s*(?:m|min|mins|minutes?|分钟)(?![a-z])/i.exec(text)
  if (hours) estimate = Math.round(Number(hours[1]) * 60)
  if (minutes) estimate = (estimate ?? 0) + Number(minutes[1])
  if (estimate === undefined && /半小时/.test(text)) estimate = 30
  if (estimate === undefined && /半天/.test(text)) estimate = 240
  if (estimate === undefined && /一天|全天/.test(text)) estimate = 480
  if (estimate !== undefined && estimate > 0) hints.estimateMin = Math.min(estimate, 960)

  // Date
  let date, index = -1, length = 0
  const take = (value, match) => { if (value && date === undefined) { date = value; index = match.index; length = match[0].length } }
  const year = Number(today.slice(0, 4))
  let match
  if ((match = /@?(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text))) take(explicitDate(today, Number(match[1]), Number(match[2]), Number(match[3])), match)
  if (date === undefined && (match = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/.exec(text))) {
    let value = explicitDate(today, year, Number(match[1]), Number(match[2]))
    if (value && value < addDays(today, -60)) value = explicitDate(today, year + 1, Number(match[1]), Number(match[2]))
    take(value, match)
  }
  if (date === undefined && (match = /(?:^|[\s@])(\d{1,2})[-/](\d{1,2})(?=$|[\s,，。.!])/.exec(text))) {
    let value = explicitDate(today, year, Number(match[1]), Number(match[2]))
    if (value && value < addDays(today, -60)) value = explicitDate(today, year + 1, Number(match[1]), Number(match[2]))
    take(value, match)
  }
  if (date === undefined && (match = /(下)?(?:周|星期|礼拜)([一二三四五六日天])/.exec(text))) take(nextWeekday(today, WEEKDAYS_ZH[match[2]], Boolean(match[1])), match)
  if (date === undefined && (match = /\b(next\s+)?(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(source))) take(nextWeekday(today, WEEKDAYS_EN[match[2]], Boolean(match[1])), match)
  if (date === undefined && (match = /大后天/.exec(text))) take(addDays(today, 3), match)
  if (date === undefined && (match = /后天|day after tomorrow/.exec(source))) take(addDays(today, 2), match)
  if (date === undefined && (match = /明天|明日|tomorrow/.exec(source))) take(addDays(today, 1), match)
  if (date === undefined && (match = /今天|今日|今晚|today|tonight/.exec(source))) take(today, match)
  if (date !== undefined) {
    const before = text.slice(Math.max(0, index - 4), index).toLowerCase()
    const after = text.slice(index + length, index + length + 3)
    const deadline = /截止|(?:^|\s)(?:by|due)\s*$|deadline/.test(before) || /^\s*(?:之前|以前|前)/.test(after)
    if (deadline) hints.deadline = date
    else hints.date = date
  }
  return hints
}

/** Open notes only: done and dropped notes never schedule. */
export const isOpen = (note) => (note.state ?? (note.done ? 'done' : 'open')) === 'open'

/** Which notes are schedulable work: open leaves or linked notes, never inside another task. */
export function tasksOf(notes) {
  const children = new Map()
  for (const note of notes) {
    const key = note.parentId ?? ''
    if (!children.has(key)) children.set(key, [])
    children.get(key).push(note)
  }
  const tasks = []
  const walk = (parent) => {
    for (const note of (children.get(parent) ?? []).sort((a, b) => a.order - b.order)) {
      if (!isOpen(note) || (note.kind ?? 'note') !== 'note') continue
      const kids = (children.get(note.id) ?? []).filter((child) => child.text?.trim() && (child.kind ?? 'note') === 'note')
      if (note.sessionId || kids.length === 0) { if (note.text?.trim()) tasks.push(note); continue }
      walk(note.id)
    }
  }
  walk('')
  return tasks
}

/** Lane of a note: work handed to an Agent costs you only its review. */
export const laneOf = (note) => note.plan?.lane ?? (note.sessionId ? 'agent' : 'me')

/**
 * Lay tasks onto days in two lanes.
 * - me: costs its estimate of your time.
 * - agent: costs `reviewCostMin` of your time and one of the day's `agentSlots`.
 * A linked, still-open Agent note is in flight and stays on today unless a date was picked.
 * @param {object[]} notes - every stored note.
 * @param {object} options - today, capacityMin, reviewCostMin, agentSlots, horizonDays, skipWeekends.
 * @returns {{ today: string, days: object[], later: object[] }}
 */
export function plan(notes, { today, capacityMin = 240, reviewCostMin = 15, agentSlots = 2, horizonDays = 7, skipWeekends = false } = {}) {
  const end = addDays(today, horizonDays - 1)
  const days = []
  for (let i = 0; i < horizonDays; i++) {
    const date = addDays(today, i)
    const weekend = [0, 6].includes(weekday(date))
    const off = skipWeekends && weekend && i > 0
    days.push({ date, items: [], usedMin: 0, capacityMin: off ? 0 : capacityMin, agentUsed: 0, agentSlots: off ? 0 : agentSlots, weekend })
  }
  const byDate = new Map(days.map((day) => [day.date, day]))
  const later = []
  const fixed = [], flexible = []
  for (const note of tasksOf(notes)) {
    const hints = parseHints(note.text, note.day && note.day <= today ? note.day : today)
    const manual = note.plan?.date
    const lane = laneOf(note)
    const estimateMin = note.plan?.estimateMin ?? hints.estimateMin ?? DEFAULT_ESTIMATE_MIN
    const entry = { id: note.id, lane, estimateMin, costMin: lane === 'agent' ? reviewCostMin : estimateMin,
      inFlight: lane === 'agent' && Boolean(note.sessionId), priority: hints.priority ?? 0, deadline: hints.deadline,
      rollovers: note.rollovers ?? 0, createdAt: note.createdAt ?? '' }
    if (manual === 'later') later.push({ ...entry, source: 'manual' })
    else if (manual) fixed.push({ ...entry, date: manual, source: 'manual' })
    else if (hints.date) fixed.push({ ...entry, date: hints.date, source: 'parsed' })
    else if (entry.inFlight) fixed.push({ ...entry, date: today, source: 'in-flight' })
    else flexible.push({ ...entry, source: 'auto' })
  }
  const place = (day, entry) => { day.items.push(entry); day.usedMin += entry.costMin; if (entry.lane === 'agent') day.agentUsed++ }
  const fits = (day, entry) => day.capacityMin > 0 && day.usedMin + entry.costMin <= day.capacityMin && (entry.lane !== 'agent' || day.agentUsed < day.agentSlots)
  for (const entry of fixed) {
    const rolled = entry.date < today
    const date = rolled ? today : entry.date
    if (date > end) { later.push({ ...entry, date }); continue }
    place(byDate.get(date), { ...entry, date, ...(rolled ? { rolledFrom: entry.date } : {}) })
  }
  flexible.sort((a, b) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  for (const entry of flexible) {
    const limit = entry.deadline && entry.deadline < end ? entry.deadline : end
    const day = days.find((candidate) => candidate.date <= limit && fits(candidate, entry))
    if (day) { place(day, { ...entry, date: day.date }); continue }
    if (entry.deadline && entry.deadline <= end) {
      const date = entry.deadline < today ? today : entry.deadline
      place(byDate.get(date), { ...entry, date, overbooked: true })
      continue
    }
    later.push(entry)
  }
  const rank = (entry) => ({ 'in-flight': 0, manual: 1, parsed: 2, auto: 3 })[entry.source] ?? 4
  for (const day of days) {
    day.items.sort((a, b) => b.priority - a.priority || rank(a) - rank(b) || (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999'))
    day.overbooked = day.usedMin > day.capacityMin || day.agentUsed > day.agentSlots
  }
  return { today, days, later }
}

export { DAY }
