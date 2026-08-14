'use client'

// Curated set of lucide icons projects can use, plus a renderer. The stored
// value is the icon key (the lucide name as a string); `color` tints it.

import {
  Activity,
  Award,
  BarChart3,
  Beaker,
  Bell,
  BookOpen,
  Box,
  Boxes,
  Briefcase,
  Bug,
  Building2,
  Calendar,
  Camera,
  Car,
  Clock,
  Cloud,
  Code2,
  Coffee,
  Compass,
  Cpu,
  CreditCard,
  Database,
  DollarSign,
  Film,
  Flag,
  FlaskConical,
  Folder,
  FolderGit2,
  Gamepad2,
  Gift,
  Globe,
  GraduationCap,
  Hammer,
  Heart,
  Image as ImageIcon,
  Key,
  Layers,
  Leaf,
  Lightbulb,
  Lock,
  Map,
  Mail,
  MessageSquare,
  Microscope,
  Monitor,
  Moon,
  Music,
  Package,
  Palette,
  PenTool,
  Phone,
  PieChart,
  Plane,
  Rocket,
  Server,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  Target,
  Terminal,
  TrendingUp,
  Trees,
  Trophy,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react'

export const PROJECT_ICON_MAP: Record<string, LucideIcon> = {
  Folder,
  FolderGit2,
  Rocket,
  Target,
  Flag,
  Zap,
  Star,
  Heart,
  Sparkles,
  Bug,
  Wrench,
  Hammer,
  Code2,
  Terminal,
  Cpu,
  Database,
  Server,
  Cloud,
  Globe,
  Layers,
  Box,
  Boxes,
  Package,
  Briefcase,
  Building2,
  Palette,
  PenTool,
  ImageIcon,
  Camera,
  Music,
  Film,
  BookOpen,
  GraduationCap,
  Lightbulb,
  Beaker,
  FlaskConical,
  Microscope,
  Shield,
  Lock,
  Key,
  Bell,
  Calendar,
  Clock,
  Map,
  Compass,
  Plane,
  Car,
  ShoppingCart,
  CreditCard,
  DollarSign,
  TrendingUp,
  BarChart3,
  PieChart,
  Activity,
  Users,
  MessageSquare,
  Mail,
  Phone,
  Smartphone,
  Monitor,
  Gamepad2,
  Trophy,
  Award,
  Gift,
  Coffee,
  Leaf,
  Trees,
  Sun,
  Moon,
}

export const PROJECT_ICON_KEYS = Object.keys(PROJECT_ICON_MAP)

// Friendly search aliases so e.g. "task" finds Target, "money" finds DollarSign.
const SEARCH_ALIASES: Record<string, string> = {
  Target: 'goal task aim',
  Flag: 'task mark',
  Rocket: 'launch ship startup',
  Bug: 'issue defect',
  Code2: 'dev engineering programming',
  Terminal: 'cli console shell',
  DollarSign: 'money finance billing revenue',
  TrendingUp: 'growth analytics metrics',
  BarChart3: 'analytics metrics chart',
  PieChart: 'analytics chart',
  Users: 'team people members',
  MessageSquare: 'chat comment support',
  Shield: 'security',
  Lock: 'security private',
  Beaker: 'research experiment lab',
  FlaskConical: 'research experiment lab',
  GraduationCap: 'learning education docs',
  ShoppingCart: 'commerce shop store',
  Building2: 'company org office',
  Briefcase: 'work business',
  Sparkles: 'ai magic new',
}

export function searchProjectIcons(query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return PROJECT_ICON_KEYS
  return PROJECT_ICON_KEYS.filter((key) => {
    const hay = `${key} ${SEARCH_ALIASES[key] ?? ''}`.toLowerCase()
    return hay.includes(q)
  })
}

interface ProjectIconProps {
  icon?: string | null
  /**
   * An uploaded logo. When set it REPLACES the icon+color tile — the same
   * precedence a workspace logo has over its coloured initial, so a project
   * that has one looks like itself everywhere it appears.
   */
  iconUrl?: string | null
  color?: string | null
  name?: string | null
  size?: number
  className?: string
  rounded?: boolean
}

// Renders the project's identity in a square tile, in this order:
//   1. the uploaded logo (`iconUrl`), if there is one
//   2. the chosen lucide icon, tinted by `color`
//   3. the first letter of the name
//
// The three are one component rather than three call-site conditionals so that
// adding a logo cannot make a project look different in listings than it does
// in its own header — which is what happened while `icon_url` was being saved
// nowhere and rendered nowhere (fixed 2026-08-13).
export function ProjectIcon({
  icon,
  iconUrl,
  color,
  name,
  size = 36,
  className = '',
  rounded = true,
}: ProjectIconProps) {
  const tint = color ?? '#3B82F6'
  const Icon = icon ? PROJECT_ICON_MAP[icon] : undefined
  const iconSize = Math.round(size * 0.55)
  const shape = `inline-flex shrink-0 items-center justify-center ${rounded ? 'rounded-lg' : ''} ${className}`

  if (iconUrl) {
    return (
      <span className={`${shape} overflow-hidden`} style={{ width: size, height: size }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={iconUrl} alt="" className="size-full object-cover" />
      </span>
    )
  }

  return (
    <span
      className={shape}
      style={{
        width: size,
        height: size,
        backgroundColor: tint + '1f', // ~12% alpha tint
        color: tint,
      }}
    >
      {Icon ? (
        <Icon size={iconSize} />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.42), fontWeight: 600, lineHeight: 1 }}>
          {(name?.trim()?.[0] ?? '?').toUpperCase()}
        </span>
      )}
    </span>
  )
}
