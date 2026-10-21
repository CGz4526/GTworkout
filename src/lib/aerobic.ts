// 有氧项目的名称。
//
// 这里必须是**唯一**的名字来源：Stats 的「有氧训练」按 `session.templateName`
// 分组统计（见 Stats.tsx 的 aerobicStats.byType），名字差一个字就会被算成两个
// 项目。首页的有氧入口（Home.tsx 的 AEROBIC_ENTRIES）和「添加记录」页的快选
// 都从这里取。
//
// 注意「爬楼梯」和「爬坡」是两项，不是一项：首页把它们合成一张卡片，点开再让
// 用户选具体是哪一种，但存进记录的仍然是这里的一个具体名字。
export const AEROBIC_TYPES = ['跑步', '游泳', '羽毛球', '爬楼梯', '爬坡'] as const

export type AerobicType = (typeof AEROBIC_TYPES)[number]

// 首页「爬楼梯/爬坡」那张卡片展开后要选的两项。
export const CLIMB_CHOICES: string[] = [...AEROBIC_TYPES.slice(3)]
