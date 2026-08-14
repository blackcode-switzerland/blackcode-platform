'use client'

import { useState, useRef, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import {
  X,
  Upload,
  Globe,
  Users,
  Lock,
  Trash2,
  AlertTriangle,
  Calendar,
  User,
} from 'lucide-react'
import { DatePicker } from '@blackcode/platform-ui/ui/date-picker'

interface Project {
  id: number
  name: string
  summary?: string | null
  description?: string | null
  status?: string | null
  owner_id?: number | null
  priority?: string | null
  visibility?: string | null
  color?: string | null
  icon_url?: string | null
  banner_url?: string | null
  start_date?: string | null
  due_date?: string | null
}

interface ProjectSettingsModalProps {
  project: Project
  onClose: () => void
  onUpdate?: (project: Project) => void
}

const PRIORITY_OPTIONS = [
  { id: 'P0', label: 'P0 - Critical', color: 'bg-red-500' },
  { id: 'P1', label: 'P1 - High', color: 'bg-amber-500' },
  { id: 'P2', label: 'P2 - Medium', color: 'bg-blue-500' },
  { id: 'P3', label: 'P3 - Low', color: 'bg-gray-500' },
] as const

const VISIBILITY_OPTIONS = [
  { id: 'private', label: 'Private', description: 'Only you can see', icon: Lock },
  { id: 'team', label: 'Team', description: 'Team members can access', icon: Users },
  { id: 'public', label: 'Public', description: 'Anyone can view', icon: Globe },
] as const

const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#14B8A6',
  '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#6B7280',
]

export function ProjectSettingsModal({
  project,
  onClose,
  onUpdate,
}: ProjectSettingsModalProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()

  // Form state initialized from project
  const [name, setName] = useState(project.name)
  const [summary, setSummary] = useState(project.summary || '')
  const [description, setDescription] = useState(project.description || '')
  const [priority, setPriority] = useState(project.priority || 'P2')
  const [visibility, setVisibility] = useState(project.visibility || 'team')
  const [color, setColor] = useState(project.color || '#007bd3')
  const [ownerId, setOwnerId] = useState<number | null>(project.owner_id || null)
  const [startDate, setStartDate] = useState(project.start_date || '')
  const [dueDate, setDueDate] = useState(project.due_date || '')
  const [iconPreview, setIconPreview] = useState<string | null>(project.icon_url || null)
  const [bannerPreview, setBannerPreview] = useState<string | null>(project.banner_url || null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  const iconInputRef = useRef<HTMLInputElement>(null)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  // Fetch project members for owner dropdown
  const { data: members = [] } = useQuery({
    queryKey: ['project-members', project.id, ws?.slug],
    enabled: !!ws?.slug,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${project.id}/members`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data
    },
  })

  // Image upload handler
  const uploadImage = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      throw new Error('Failed to upload image')
    }

    const data = await res.json()
    return data.url
  }, [])

  const handleIconSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Show preview immediately
      const reader = new FileReader()
      reader.onload = (e) => setIconPreview(e.target?.result as string)
      reader.readAsDataURL(file)

      // Upload and get URL
      try {
        const url = await uploadImage(file)
        setIconPreview(url)
      } catch (err) {
        toast.error('Failed to upload icon')
      }
    }
  }

  const handleBannerSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Show preview immediately
      const reader = new FileReader()
      reader.onload = (e) => setBannerPreview(e.target?.result as string)
      reader.readAsDataURL(file)

      // Upload and get URL
      try {
        const url = await uploadImage(file)
        setBannerPreview(url)
      } catch (err) {
        toast.error('Failed to upload banner')
      }
    }
  }

  // Update project mutation
  const updateProject = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          summary: summary.trim() || null,
          description: description.trim() || null,
          priority,
          visibility,
          color,
          // `lead_user_id`, NOT `owner_id`. The column is `owner_id`, so the
          // GET returns that name and this modal used to send it back —
          // `updateProject` only ever read `lead_user_id`, so every lead change
          // made here was silently discarded (fixed 2026-08-13). The rest of the
          // app (project detail, projects listing, the CLI) already used the
          // right name, which is why the bug survived: it reproduced in exactly
          // one place.
          lead_user_id: ownerId,
          start_date: startDate || null,
          due_date: dueDate || null,
          icon_url: iconPreview,
          banner_url: bannerPreview,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update project')
      }
      return res.json()
    },
    onSuccess: (updatedProject) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project', project.id] })
      toast.success('Project updated!')
      onUpdate?.(updatedProject)
      onClose()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to update project')
    },
  })

  // Delete project mutation
  const deleteProjectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${project.id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete project')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Project deleted')
      router.push('/dashboard')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete project')
    },
  })

  const handleSubmit = () => {
    if (!name.trim()) {
      toast.error('Project name is required')
      return
    }
    updateProject.mutate()
  }

  const handleDelete = () => {
    if (deleteConfirmText !== project.name) {
      toast.error('Please type the project name to confirm')
      return
    }
    deleteProjectMutation.mutate()
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-xs z-40"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 flex items-center justify-center z-50 p-4"
      >
        <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">
          {/* Banner preview area */}
          <div
            className="h-24 relative shrink-0"
            style={{
              background: bannerPreview
                ? `url(${bannerPreview}) center/cover`
                : `linear-gradient(135deg, ${color}40, ${color}10)`,
            }}
          >
            <input
              type="file"
              ref={bannerInputRef}
              onChange={handleBannerSelect}
              accept="image/*"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => bannerInputRef.current?.click()}
              className="absolute bottom-2 right-2 px-2 py-1 bg-black/50 text-white text-xs rounded hover:bg-black/70 transition-colors"
            >
              {bannerPreview ? 'Change banner' : 'Add banner'}
            </button>
            <button
              onClick={onClose}
              className="absolute top-2 right-2 p-1.5 bg-black/50 text-white rounded-lg hover:bg-black/70 transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Icon positioned over banner */}
          <div className="relative px-6 -mt-8">
            <input
              type="file"
              ref={iconInputRef}
              onChange={handleIconSelect}
              accept="image/*"
              className="hidden"
            />
            <button
              type="button"
              onClick={() => iconInputRef.current?.click()}
              className="w-16 h-16 rounded-xl border-4 border-card bg-card shadow-lg flex items-center justify-center overflow-hidden hover:opacity-80 transition-opacity"
              style={{ backgroundColor: !iconPreview ? color : undefined }}
            >
              {iconPreview ? (
                <Image src={iconPreview} alt="Icon" width={64} height={64} className="w-full h-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-white">{name.charAt(0).toUpperCase() || 'P'}</span>
              )}
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Project Settings</h2>
              <span className="text-xs text-muted-foreground">#{project.id}</span>
            </div>

            <form
              id="project-settings-form"
              onSubmit={(e) => {
                e.preventDefault()
                handleSubmit()
              }}
              className="space-y-5"
            >
              {/* Name */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Project Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My Awesome Project"
                  className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-hidden focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Summary */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Summary
                </label>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="A short plain-text summary shown in kanban cards and overviews…"
                  rows={2}
                  className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-hidden focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's this project about?"
                  rows={3}
                  className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-hidden focus:ring-2 focus:ring-ring resize-none"
                />
              </div>

              {/* Priority and Color in row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                    className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-hidden focus:ring-2 focus:ring-ring"
                  >
                    {PRIORITY_OPTIONS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    Color
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={`w-6 h-6 rounded-full transition-transform ${
                          color === c ? 'ring-2 ring-offset-2 ring-offset-card ring-primary scale-110' : 'hover:scale-110'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-sm font-medium mb-2">
                  Visibility
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {VISIBILITY_OPTIONS.map((v) => {
                    const Icon = v.icon
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setVisibility(v.id)}
                        className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
                          visibility === v.id
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input hover:bg-secondary'
                        }`}
                      >
                        <Icon size={18} />
                        <span className="text-sm font-medium">{v.label}</span>
                        <span className="text-[10px] text-muted-foreground">{v.description}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Owner */}
              <div>
                <label className="block text-sm font-medium mb-1.5">
                  <User size={14} className="inline mr-1" />
                  Project Owner
                </label>
                <select
                  value={ownerId || ''}
                  onChange={(e) => setOwnerId(e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-4 py-2 bg-background border border-input rounded-lg focus:outline-hidden focus:ring-2 focus:ring-ring"
                >
                  <option value="">No owner</option>
                  {members.map((m: any) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.name || m.email} {m.role === 'owner' ? '(current owner)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    <Calendar size={14} className="inline mr-1" />
                    Start Date
                  </label>
                  <DatePicker
                    variant="inline"
                    value={startDate || null}
                    onChange={(v) => setStartDate(v ?? '')}
                    placeholder="Set start date"
                    buttonClassName="flex w-full items-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-left text-sm hover:bg-secondary/40"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    <Calendar size={14} className="inline mr-1" />
                    End Date
                  </label>
                  <DatePicker
                    variant="inline"
                    value={dueDate || null}
                    onChange={(v) => setDueDate(v ?? '')}
                    placeholder="Set end date"
                    buttonClassName="flex w-full items-center gap-2 rounded-lg border border-input bg-background px-4 py-2 text-left text-sm hover:bg-secondary/40"
                  />
                </div>
              </div>

              {/* Danger Zone */}
              <div className="pt-4 border-t border-border">
                <h3 className="text-sm font-medium text-red-500 mb-3">Danger Zone</h3>

                {!showDeleteConfirm ? (
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-2 px-4 py-2 text-red-500 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={16} />
                    Delete Project
                  </button>
                ) : (
                  <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-red-500">
                          This action cannot be undone
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          This will permanently delete the project, all its issues, tasks, and comments.
                        </p>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">
                        Type <strong>{project.name}</strong> to confirm
                      </label>
                      <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder={project.name}
                        className="w-full px-3 py-2 bg-background border border-input rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowDeleteConfirm(false)
                          setDeleteConfirmText('')
                        }}
                        className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleteConfirmText !== project.name || deleteProjectMutation.isPending}
                        className="px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
                      >
                        {deleteProjectMutation.isPending ? 'Deleting...' : 'Delete Project'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </form>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="project-settings-form"
              disabled={!name.trim() || updateProject.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {updateProject.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  )
}
