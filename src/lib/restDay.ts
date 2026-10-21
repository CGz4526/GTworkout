// 自动补休息日：昨天一条记录都没有，就在打开 App 时给昨天补一条休息日。
//
// 有两条边界，都是为了「不要凭空造历史」：
// 1. 一次训练都还没记过的新库 / 刚清空的库，什么都不补——否则新装 App
//    第二天打开就有一条查无实据的「休息日」。
// 2. 不从用户第一条记录之前的日子补起，只补「用户已经在用的那段时间」里
//    漏掉的昨天。
//
// 幂等：补完昨天就有记录了，下次打开检查发现已有记录，不会再补一条。
// 日期存本地正午（见 lib/date 的说明），不会因为时区滑到前一天。
import { db } from '../db'
import { localDateKeyOf, localNoonOf, toLocalDateKey } from './date'

export async function ensureAutoRestDay(): Promise<'added' | 'skipped'> {
  const all = await db.sessions.toArray()

  const firstFinished = all
    .filter((s) => s.finished && localDateKeyOf(s.date))
    .sort((a, b) => localDateKeyOf(a.date).localeCompare(localDateKeyOf(b.date)))[0]
  if (!firstFinished) return 'skipped'

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const key = toLocalDateKey(yesterday)
  if (!key || key < localDateKeyOf(firstFinished.date)) return 'skipped'

  // 那天已经有任何记录（含没结束的训练）就不再补
  if (all.some((s) => localDateKeyOf(s.date) === key)) return 'skipped'

  await db.sessions.put({
    id: `rest-${key}`,
    templateName: '休息日',
    date: localNoonOf(key).toISOString(),
    duration: 0,
    exercises: [],
    finished: true,
    aerobic: false,
  })
  return 'added'
}
