// 本地日期的唯一来源。
//
// 为什么需要它：`session.date` 存的是 `new Date().toISOString()`（UTC 时刻），
// 而「今天 / 昨天 / 某一天」这些概念在 UI 里一律按**本地日期**算
// （History 分组、日历、体重按天一条）。拿 ISO 字符串前 10 位当日期键是错的：
// 东八区凌晨 1 点训练的 ISO 日期会比本地日期晚一天，体重和休息日会对不上。
//
// 所以：存键一律用这里的 toLocalDateKey（本地年月日），读 ISO 一律过 localDateKeyOf。

const pad = (n: number) => n.toString().padStart(2, '0')

/** 日期的本地 'YYYY-MM-DD' 键 */
export const toLocalDateKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** ISO 字符串 → 本地日期键。坏日期返回 ''（调用方自己决定怎么处理） */
export const localDateKeyOf = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : toLocalDateKey(d)
}

/** 本地日期键 → 当天本地时间 12:00 的 Date。
 *  取正午而不是 0 点，是为了避开时区边界：存成 ISO 时不会滑到前一天。 */
export const localNoonOf = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0)
  return Number.isNaN(date.getTime()) ? new Date() : date
}
