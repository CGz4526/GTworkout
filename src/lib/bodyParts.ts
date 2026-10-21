import { Shield, Heart, ArrowBigUp, Footprints, Target, Zap, Flame } from 'lucide-react'
import type { BodyPart } from '../types'

/**
 * 训练部位的视觉标识：图标、渐变、主色。
 *
 * 这是**唯一来源**。之前 Home / TemplateDetail / Templates 各抄了一份一模一样的
 * BODY_PART_META，Stats 又单独维护了一份硬编码 hex，Exercises 用的是 emoji——
 * 同一个「肩」在四个页面有四种表现，配色自然谈不上协调。
 *
 * 色相沿用各部位原有的渐变起点色，和 Stats 图表里原本的 hex 一致，所以视觉上
 * 是延续而不是推翻。`text` 用 `-600 / dark:-400` 两档：-500 在白底上对比度不够。
 *
 * 注意这些必须是**完整字面量**的 Tailwind 类名。Tailwind 靠扫描源码生成类，
 * 拼接出来的字符串（`text-${x}-500`）不会进产物。
 */
export interface BodyPartMeta {
  /** 图标组件 */
  icon: React.ElementType
  /** 大色块 / 头像用的渐变 */
  gradient: string
  /** 主色 hex，图表这类需要真实色值的地方用 */
  hex: string
  /** 主色的淡底 */
  soft: string
  /** 主色的文字 */
  text: string
  /** 主色的细边 */
  border: string
}

export const BODY_PART_META: Record<BodyPart, BodyPartMeta> = {
  肩: {
    icon: Shield,
    gradient: 'from-orange-500 to-amber-500',
    hex: '#f59e0b',
    soft: 'bg-orange-500/10',
    text: 'text-orange-600 dark:text-orange-400',
    border: 'border-orange-500/25',
  },
  胸: {
    icon: Heart,
    gradient: 'from-red-500 to-rose-500',
    hex: '#ef4444',
    soft: 'bg-red-500/10',
    text: 'text-red-600 dark:text-red-400',
    border: 'border-red-500/25',
  },
  背: {
    icon: ArrowBigUp,
    gradient: 'from-blue-500 to-cyan-500',
    hex: '#3b82f6',
    soft: 'bg-blue-500/10',
    text: 'text-blue-600 dark:text-blue-400',
    border: 'border-blue-500/25',
  },
  腿: {
    icon: Footprints,
    gradient: 'from-purple-500 to-violet-500',
    hex: '#8b5cf6',
    soft: 'bg-purple-500/10',
    text: 'text-purple-600 dark:text-purple-400',
    border: 'border-purple-500/25',
  },
  二头: {
    icon: Target,
    gradient: 'from-pink-500 to-fuchsia-500',
    hex: '#ec4899',
    soft: 'bg-pink-500/10',
    text: 'text-pink-600 dark:text-pink-400',
    border: 'border-pink-500/25',
  },
  三头: {
    icon: Zap,
    gradient: 'from-teal-500 to-emerald-500',
    hex: '#14b8a6',
    soft: 'bg-teal-500/10',
    text: 'text-teal-600 dark:text-teal-400',
    border: 'border-teal-500/25',
  },
  核心: {
    icon: Flame,
    gradient: 'from-yellow-500 to-orange-500',
    hex: '#eab308',
    soft: 'bg-yellow-500/10',
    text: 'text-yellow-600 dark:text-yellow-400',
    border: 'border-yellow-500/25',
  },
}

/** 取某个部位的标识，未知部位退回「肩」，避免调用方到处写 ?? 兜底。 */
export function bodyPartMeta(bp: string): BodyPartMeta {
  const meta = BODY_PART_META[bp as BodyPart] ?? BODY_PART_META['肩']
  // 图表保留可区分的部位色值；表单图标和选择状态统一使用当前主题重点色。
  return { ...meta, gradient: 'from-blue-600 to-indigo-500', soft: 'bg-accent-soft', text: 'text-accent-light', border: 'border-accent/20' }
}
