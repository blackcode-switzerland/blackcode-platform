'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { toast } from 'sonner'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Plus,
  MoreHorizontal,
  MessageSquare,
  Paperclip,
  Clock,
  AlertCircle,
  ChevronDown,
  Search,
  Filter,
  Calendar,
  User2,
  Tag,
  Undo2,
  X,
  LayoutGrid,
  List,
  Users,
  ExternalLink,
  Settings,
  GanttChartSquare,
} from 'lucide-react'
import { ProjectMembersPanel } from './project-members-panel'
import { CreateIssueModal } from './create-issue-modal'
import { useActiveWorkspace } from './listings/use-active-workspace'
import { RichTextEditor, RichTextDisplay } from '@blackcode/platform-ui/rich-text-editor'
import { formatDistanceToNow } from 'date-fns'

// Status configuration
const STATUSES = [
  { id: 'backlog', label: 'Backlog', color: 'gray' },
  { id: 'todo', label: 'To Do', color: 'blue' },
  { id: 'in_progress', label: 'In Progress', color: 'amber' },
  { id: 'blocked', label: 'Blocked', color: 'red' },
  { id: 'in_review', label: 'In Review', color: 'purple' },
  { id: 'done', label: 'Done', color: 'green' },
] as const

const PRIORITY_CONFIG = {
  1: { label: 'Urgent', color: 'text-red-500', bg: 'bg-red-500/10' },
  2: { label: 'High', color: 'text-amber-500', bg: 'bg-amber-500/10' },
  3: { label: 'Medium', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  4: { label: 'Low', color: 'text-gray-500', bg: 'bg-gray-500/10' },
  5: { label: 'None', color: 'text-gray-400', bg: 'bg-gray-400/10' },
} as const

interface Issue {
  id: number
  title: string
  description?: string
  status: string
  priority: number
  assignees?: Array<{ id: number; name: string | null; email: string; avatar_url: string | null }>
  task_id?: number
  task_name?: string
  labels?: string[]
  comment_count: number
  attachment_count: number
  created_at: string
  updated_at: string
}

interface Project {
  id: number
  name: string
  description?: string | null
}

interface KanbanData {
  [status: string]: Issue[]
}

interface User {
  id?: number
  name?: string | null
  email?: string | null
  image?: string | null
}

interface UndoAction {
  type: 'status_change'
  issueId: number
  previousStatus: string
  newStatus: string
  timestamp: number
}

export function KanbanBoard({
  project,
  initialKanban,
  user,
  view = 'kanban',
  onViewChange,
  onOpenSettings,
}: {
  project: Project
  initialKanban: KanbanData
  user: User
  view?: 'kanban' | 'timeline' | 'list'
  onViewChange?: (view: 'kanban' | 'timeline' | 'list') => void
  onOpenSettings?: () => void
}) {
  const [kanban, setKanban] = useState<KanbanData>(initialKanban)
  const [searchQuery, setSearchQuery] = useState('')
  const [showNewIssue, setShowNewIssue] = useState<string | null>(null)
  const [showRichCreateModal, setShowRichCreateModal] = useState(false)
  const [richCreateDefaultStatus, setRichCreateDefaultStatus] = useState('backlog')
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [showMembersPanel, setShowMembersPanel] = useState(false)
  const [priorityFilter, setPriorityFilter] = useState<number | null>(null)
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all') // 'all', 'unassigned', or specific user id
  const [undoStack, setUndoStack] = useState<UndoAction[]>([])
  const isUndoing = useRef(false)
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()

  // Fetch project members for filter dropdown
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

  // Fetch fresh data to keep kanban in sync
  useQuery({
    queryKey: ['project-issues', project.id, ws?.slug],
    enabled: !!ws?.slug,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues?project_id=${project.id}`)
      if (!res.ok) throw new Error('Failed to fetch issues')
      const json = await res.json()
      const issues: Issue[] = json.data

      // Group issues by status
      const grouped: KanbanData = {}
      for (const issue of issues) {
        if (!grouped[issue.status]) {
          grouped[issue.status] = []
        }
        grouped[issue.status].push(issue)
      }
      
      // Update local state with fresh data
      setKanban(grouped)
      return grouped
    },
    refetchOnWindowFocus: true,
    staleTime: 10000, // Consider data stale after 10 seconds
    // No refetchInterval: a timer kept the database awake for as long as a board
    // was open. It refreshes on window focus and after any status change.
  })

  const updateIssueStatus = useMutation({
    mutationFn: async ({ issueId, status }: { issueId: number; status: string }) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        console.error('Update failed:', errorData)
        throw new Error('Failed to update issue')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['ws-projects-listing'] })
      queryClient.invalidateQueries({ queryKey: ['ws-tasks-listing'] })
    },
    onError: (error) => {
      console.error('Mutation error:', error)
      toast.error('Failed to update issue')
      queryClient.invalidateQueries({ queryKey: ['project-issues', project.id] })
    },
  })

  const createIssue = useMutation({
    mutationFn: async (data: {
      title: string
      description?: string
      status: string
      priority?: number
      assignee_ids?: number[]
      task_id?: number
    }) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          project_id: project.id,
        }),
      })
      if (!res.ok) throw new Error('Failed to create issue')
      return res.json()
    },
    onSuccess: (newIssue, variables) => {
      // Optimistic update to local state
      setKanban((prev) => ({
        ...prev,
        [variables.status]: [...(prev[variables.status] || []), newIssue],
      }))
      setShowNewIssue(null)
      toast.success('Issue created!')
      // Invalidate all related caches to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['all-issues'] })
      queryClient.invalidateQueries({ queryKey: ['project-issues', project.id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: () => {
      toast.error('Failed to create issue')
    },
  })

  const handleDragEnd = useCallback((result: DropResult) => {
    const { source, destination, draggableId } = result

    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    const issueId = parseInt(draggableId)
    const sourceStatus = source.droppableId
    const destStatus = destination.droppableId

    // Optimistic update
    setKanban((prev) => {
      const newKanban = { ...prev }
      const sourceItems = [...(newKanban[sourceStatus] || [])]
      const destItems = sourceStatus === destStatus ? sourceItems : [...(newKanban[destStatus] || [])]

      const [movedItem] = sourceItems.splice(source.index, 1)
      movedItem.status = destStatus
      destItems.splice(destination.index, 0, movedItem)

      newKanban[sourceStatus] = sourceItems
      if (sourceStatus !== destStatus) {
        newKanban[destStatus] = destItems
      }

      return newKanban
    })

    // Update server and track for undo (only if not undoing)
    if (sourceStatus !== destStatus) {
      updateIssueStatus.mutate({ issueId, status: destStatus })

      // Add to undo stack only if this is not an undo operation
      if (!isUndoing.current) {
        setUndoStack((prev) => [
          ...prev.slice(-9), // Keep last 10 actions
          {
            type: 'status_change',
            issueId,
            previousStatus: sourceStatus,
            newStatus: destStatus,
            timestamp: Date.now(),
          },
        ])
      }
    }
  }, [updateIssueStatus])

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return

    const lastAction = undoStack[undoStack.length - 1]

    // Mark that we're undoing to prevent adding this to undo stack
    isUndoing.current = true

    // Optimistically update local state
    setKanban((prev) => {
      const newKanban = { ...prev }
      const sourceItems = [...(newKanban[lastAction.newStatus] || [])]
      const destItems = [...(newKanban[lastAction.previousStatus] || [])]

      const issueIndex = sourceItems.findIndex((i) => i.id === lastAction.issueId)
      if (issueIndex !== -1) {
        const [movedItem] = sourceItems.splice(issueIndex, 1)
        movedItem.status = lastAction.previousStatus
        destItems.push(movedItem)

        newKanban[lastAction.newStatus] = sourceItems
        newKanban[lastAction.previousStatus] = destItems
      }

      return newKanban
    })

    // Update server
    updateIssueStatus.mutate(
      { issueId: lastAction.issueId, status: lastAction.previousStatus },
      {
        onSettled: () => {
          isUndoing.current = false
        },
      }
    )

    // Remove from undo stack
    setUndoStack((prev) => prev.slice(0, -1))

    toast.success('Action undone', {
      description: `Issue moved back to ${STATUSES.find((s) => s.id === lastAction.previousStatus)?.label}`,
    })
  }, [undoStack, updateIssueStatus])

  // Filter issues by search query, priority, and assignee
  const filterIssues = (issues: Issue[]) => {
    return issues.filter((issue) => {
      // Search query filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        if (!issue.title.toLowerCase().includes(query) && !issue.id.toString().includes(query)) {
          return false
        }
      }
      
      // Priority filter
      if (priorityFilter !== null && issue.priority !== priorityFilter) {
        return false
      }
      
      // Assignee filter
      const issueAssigneeIds = (issue.assignees ?? []).map((a) => String(a.id))
      if (assigneeFilter === 'unassigned' && issueAssigneeIds.length > 0) {
        return false
      }
      if (assigneeFilter !== 'all' && assigneeFilter !== 'unassigned') {
        if (!issueAssigneeIds.includes(assigneeFilter)) {
          return false
        }
      }
      
      return true
    })
  }
  
  const activeFiltersCount = (priorityFilter !== null ? 1 : 0) + (assigneeFilter !== 'all' ? 1 : 0)

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-sm border-b border-border">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="p-2 hover:bg-secondary rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </Link>
              <div>
                <h1 className="text-xl font-bold">{project.name}</h1>
                <p className="text-sm text-muted-foreground">
                  #{project.id} • {Object.values(kanban).flat().length} issues
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* View Toggle */}
              {onViewChange && (
                <div className="flex items-center gap-1 bg-background border border-input rounded-lg p-1">
                  <button
                    onClick={() => onViewChange('kanban')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      view === 'kanban'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <LayoutGrid size={16} className="inline mr-1.5" />
                    Kanban
                  </button>
                  <button
                    onClick={() => onViewChange('list')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      view === 'list'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <List size={16} className="inline mr-1.5" />
                    List
                  </button>
                  <button
                    onClick={() => onViewChange('timeline')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      view === 'timeline'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <GanttChartSquare size={16} className="inline mr-1.5" />
                    Gantt
                  </button>
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="text"
                  placeholder="Search issues..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-ring sm:w-64"
                />
              </div>

              {/* Filters */}
              <div className="relative">
                <button 
                  onClick={() => setShowFilters(!showFilters)}
                  className={`flex items-center gap-2 px-3 py-2 bg-background border border-input rounded-lg text-sm hover:bg-secondary transition-colors ${activeFiltersCount > 0 ? 'border-primary' : ''}`}
                >
                  <Filter size={16} />
                  Filters
                  {activeFiltersCount > 0 && (
                    <span className="px-1.5 py-0.5 bg-primary text-primary-foreground text-xs rounded-full">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>
                
                {showFilters && (
                  <div className="absolute right-0 top-full mt-2 w-64 bg-card border border-border rounded-lg shadow-lg p-4 z-30">
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-medium text-sm">Filters</span>
                      {activeFiltersCount > 0 && (
                        <button
                          onClick={() => {
                            setPriorityFilter(null)
                            setAssigneeFilter('all')
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                    
                    {/* Priority filter */}
                    <div className="mb-3">
                      <label className="block text-xs text-muted-foreground mb-1.5">Priority</label>
                      <select
                        value={priorityFilter ?? ''}
                        onChange={(e) => setPriorityFilter(e.target.value ? parseInt(e.target.value) : null)}
                        className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-sm"
                      >
                        <option value="">All priorities</option>
                        <option value="1">Urgent</option>
                        <option value="2">High</option>
                        <option value="3">Medium</option>
                        <option value="4">Low</option>
                      </select>
                    </div>
                    
                    {/* Assignee filter */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1.5">Assignee</label>
                      <select
                        value={assigneeFilter}
                        onChange={(e) => setAssigneeFilter(e.target.value)}
                        className="w-full px-2 py-1.5 bg-background border border-input rounded-md text-sm"
                      >
                        <option value="all">All</option>
                        <option value="unassigned">Unassigned</option>
                        {members.map((m: any) => (
                          <option key={m.user_id} value={m.user_id.toString()}>
                            {m.name || m.email}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Team Members */}
              <button
                onClick={() => setShowMembersPanel(true)}
                className="flex items-center gap-2 px-3 py-2 bg-background border border-input rounded-lg text-sm hover:bg-secondary transition-colors"
              >
                <Users size={16} />
                Team
              </button>

              {/* Settings */}
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="p-2 bg-background border border-input rounded-lg hover:bg-secondary transition-colors"
                  title="Project Settings"
                >
                  <Settings size={16} />
                </button>
              )}

              {/* Undo */}
              <button
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                className={`flex items-center gap-2 px-3 py-2 bg-background border border-input rounded-lg text-sm transition-colors ${
                  undoStack.length > 0
                    ? 'hover:bg-secondary text-foreground'
                    : 'text-muted-foreground/50 cursor-not-allowed'
                }`}
                title={undoStack.length > 0 ? `Undo (${undoStack.length} action${undoStack.length > 1 ? 's' : ''})` : 'Nothing to undo'}
              >
                <Undo2 size={16} />
                Undo
                {undoStack.length > 0 && (
                  <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded-full">
                    {undoStack.length}
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Kanban board */}
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="p-6">
          <div className="flex gap-6 overflow-x-auto pb-6">
            {STATUSES.map((status) => (
              <Column
                key={status.id}
                status={status}
                issues={filterIssues(kanban[status.id] || [])}
                projectId={project.id}
                onNewIssue={() => setShowNewIssue(status.id)}
                showNewIssue={showNewIssue === status.id}
                onCancelNewIssue={() => setShowNewIssue(null)}
                onCreateIssue={(data) =>
                  createIssue.mutate({ ...data, status: status.id })
                }
                isCreating={createIssue.isPending}
                onSelectIssue={setSelectedIssue}
                onOpenRichCreate={() => {
                  setRichCreateDefaultStatus(status.id)
                  setShowRichCreateModal(true)
                }}
              />
            ))}
          </div>
        </div>
      </DragDropContext>

      {/* Issue detail modal */}
      <AnimatePresence>
        {selectedIssue && (
          <IssueDetailModal
            issue={selectedIssue}
            onClose={() => setSelectedIssue(null)}
          />
        )}
      </AnimatePresence>

      {/* Members Panel */}
      <AnimatePresence>
        {showMembersPanel && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMembersPanel(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-xs z-40"
            />

            {/* Panel */}
            <motion.div
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className="fixed right-0 top-0 h-full w-full max-w-md bg-card border-l border-border shadow-2xl z-50 overflow-y-auto"
            >
              {/* Header */}
              <div className="sticky top-0 bg-card/80 backdrop-blur-sm border-b border-border px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Team Members</h2>
                  <button
                    onClick={() => setShowMembersPanel(false)}
                    className="p-2 hover:bg-secondary rounded-lg transition-colors"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                <ProjectMembersPanel
                  projectId={project.id}
                  currentUserId={user.id || 0}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Rich Issue Creation Modal */}
      <AnimatePresence>
        {showRichCreateModal && (
          <CreateIssueModal
            projectId={project.id}
            defaultStatus={richCreateDefaultStatus}
            onClose={() => setShowRichCreateModal(false)}
            onSuccess={(newIssue) => {
              // Optimistic update to local state
              setKanban((prev) => ({
                ...prev,
                [newIssue.status]: [...(prev[newIssue.status] || []), newIssue],
              }))
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function Column({
  status,
  issues,
  projectId,
  onNewIssue,
  showNewIssue,
  onCancelNewIssue,
  onCreateIssue,
  isCreating,
  onSelectIssue,
  onOpenRichCreate,
}: {
  status: typeof STATUSES[number]
  issues: Issue[]
  projectId: number
  onNewIssue: () => void
  showNewIssue: boolean
  onCancelNewIssue: () => void
  onCreateIssue: (data: {
    title: string
    description?: string
    priority?: number
    assignee_ids?: number[]
    task_id?: number
  }) => void
  isCreating: boolean
  onSelectIssue: (issue: Issue) => void
  onOpenRichCreate: () => void
}) {
  const { data: ws } = useActiveWorkspace()
  const [newTitle, setNewTitle] = useState('')
  const [showExpanded, setShowExpanded] = useState(false)
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<number>(3)
  const [assigneeIds, setAssigneeIds] = useState<number[]>([])
  const [taskId, setTaskId] = useState<number | undefined>(undefined)

  const resetForm = () => {
    setNewTitle('')
    setDescription('')
    setPriority(3)
    setAssigneeIds([])
    setTaskId(undefined)
    setShowExpanded(false)
  }

  // Fetch project members and tasks
  const { data: members = [] } = useQuery({
    queryKey: ['project-members', projectId, ws?.slug],
    enabled: !!ws?.slug,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/projects/${projectId}/members`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data
    },
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', projectId, ws?.slug],
    enabled: !!ws?.slug,
    queryFn: async () => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/tasks?project_id=${projectId}`)
      if (!res.ok) return []
      const json = await res.json()
      return json.data
    },
  })

  const colorClasses = {
    gray: 'bg-gray-500',
    blue: 'bg-blue-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
    green: 'bg-green-500',
  }

  return (
    <div className="shrink-0 w-80">
      {/* Column header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${colorClasses[status.color]}`} />
          <span className="font-medium">{status.label}</span>
          <span className="text-sm text-muted-foreground ml-1">
            {issues.length}
          </span>
        </div>
        <button
          onClick={onNewIssue}
          className="p-1.5 hover:bg-secondary rounded-md transition-colors text-muted-foreground hover:text-foreground"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Droppable area */}
      <Droppable droppableId={status.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`kanban-column transition-colors ${
              snapshot.isDraggingOver ? 'bg-primary/5 border-primary/20 border-2 border-dashed' : ''
            }`}
          >
            {/* New issue form */}
            <AnimatePresence>
              {showNewIssue && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mb-3"
                >
                  <div className="bg-card rounded-lg border border-primary p-3 shadow-lg space-y-3">
                    <input
                      autoFocus
                      placeholder="Issue title..."
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey && newTitle.trim() && !showExpanded) {
                          e.preventDefault()
                          onCreateIssue({ title: newTitle.trim() })
                          resetForm()
                        }
                        if (e.key === 'Escape') {
                          resetForm()
                          onCancelNewIssue()
                        }
                      }}
                      className="w-full px-2 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                    />

                    {showExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="space-y-3"
                      >
                        <textarea
                          placeholder="Description (optional)..."
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          className="w-full px-2 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-ring resize-none"
                          rows={3}
                        />

                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={priority}
                            onChange={(e) => setPriority(parseInt(e.target.value))}
                            className="w-full px-2 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                          >
                            <option value={1}>Urgent</option>
                            <option value={2}>High</option>
                            <option value={3}>Medium</option>
                            <option value={4}>Low</option>
                          </select>

                          <select
                            value={assigneeIds[0] ?? ''}
                            onChange={(e) =>
                              setAssigneeIds(e.target.value ? [parseInt(e.target.value)] : [])
                            }
                            className="w-full px-2 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                          >
                            <option value="">Unassigned</option>
                            {members.map((m: any) => (
                              <option key={m.user_id} value={m.user_id}>
                                {m.name || m.email}
                              </option>
                            ))}
                          </select>
                        </div>

                        <select
                          value={taskId || ''}
                          onChange={(e) =>
                            setTaskId(e.target.value ? parseInt(e.target.value) : undefined)
                          }
                          className="w-full px-2 py-1.5 bg-background border border-input rounded-lg text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
                        >
                          <option value="">No task</option>
                          {tasks.map((m: any) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </motion.div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setShowExpanded(!showExpanded)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {showExpanded ? 'Less' : 'More options'}
                        </button>
                        <button
                          onClick={() => {
                            resetForm()
                            onCancelNewIssue()
                            onOpenRichCreate()
                          }}
                          className="text-xs text-primary hover:underline"
                        >
                          Full editor
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            resetForm()
                            onCancelNewIssue()
                          }}
                          className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            if (newTitle.trim()) {
                              onCreateIssue({
                                title: newTitle.trim(),
                                description: description.trim() || undefined,
                                priority,
                                assignee_ids: assigneeIds.length > 0 ? assigneeIds : undefined,
                                task_id: taskId,
                              })
                              resetForm()
                            }
                          }}
                          disabled={!newTitle.trim() || isCreating}
                          className="px-3 py-1 text-xs bg-primary text-primary-foreground rounded-md disabled:opacity-50"
                        >
                          {isCreating ? '...' : 'Create'}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Issues */}
            {issues.map((issue, index) => (
              <Draggable
                key={issue.id}
                draggableId={issue.id.toString()}
                index={index}
              >
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                  >
                    <IssueCard
                      issue={issue}
                      isDragging={snapshot.isDragging}
                      onClick={() => onSelectIssue(issue)}
                    />
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  )
}

function IssueCard({
  issue,
  isDragging,
  onClick,
}: {
  issue: Issue
  isDragging: boolean
  onClick: () => void
}) {
  const priority = PRIORITY_CONFIG[issue.priority as keyof typeof PRIORITY_CONFIG]

  return (
    <motion.div
      layout
      onClick={onClick}
      className={`kanban-card mb-3 ${isDragging ? 'shadow-xl ring-2 ring-primary' : ''}`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-xs text-muted-foreground font-mono">
          #{issue.id}
        </span>
        {priority && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${priority.bg} ${priority.color}`}>
            {priority.label}
          </span>
        )}
      </div>

      {/* Title */}
      <h4 className="font-medium text-sm mb-3 line-clamp-2">{issue.title}</h4>

      {/* Meta */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          {issue.comment_count > 0 && (
            <span className="flex items-center gap-1">
              <MessageSquare size={12} />
              {issue.comment_count}
            </span>
          )}
          {issue.attachment_count > 0 && (
            <span className="flex items-center gap-1">
              <Paperclip size={12} />
              {issue.attachment_count}
            </span>
          )}
        </div>

        {/* Assignees */}
        <span className="flex items-center">
          {(issue.assignees ?? []).slice(0, 2).map((a, idx) => (
            <span key={a.id} style={{ marginLeft: idx > 0 ? '-4px' : 0 }} title={a.name ?? a.email}>
              {a.avatar_url ? (
                <Image src={a.avatar_url} alt={a.name ?? 'Assignee'} width={20} height={20} className="rounded-full" />
              ) : (
                <div className="w-5 h-5 bg-primary/20 rounded-full flex items-center justify-center text-[10px] font-medium">
                  {(a.name ?? a.email).charAt(0)}
                </div>
              )}
            </span>
          ))}
        </span>
      </div>
    </motion.div>
  )
}

function IssueDetailModal({
  issue,
  onClose,
}: {
  issue: Issue
  onClose: () => void
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: ws } = useActiveWorkspace()
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Local state for editing
  const [title, setTitle] = useState(issue.title)
  const [description, setDescription] = useState(issue.description || '')
  const [status, setStatus] = useState(issue.status)
  const [priority, setPriority] = useState(issue.priority)
  const [assigneeIds, setAssigneeIds] = useState<number[]>((issue.assignees ?? []).map((a) => a.id))
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'idle'>('idle')

  // Fetch project members for assignee dropdown
  const { data: members = [] } = useQuery({
    queryKey: ['all-members'],
    queryFn: async () => {
      const res = await fetch('/api/users')
      if (!res.ok) return []
      return res.json()
    },
  })

  // Update issue mutation
  const updateIssue = useMutation({
    mutationFn: async (data: Partial<Issue>) => {
      const res = await fetch(`/api/workspaces/${ws!.slug}/issues/${issue.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Failed to update issue')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-issues'] })
      queryClient.invalidateQueries({ queryKey: ['all-issues'] })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    },
    onError: () => {
      toast.error('Failed to save')
      setSaveStatus('idle')
    },
  })

  // Auto-save with debounce for title and description
  const autoSave = useCallback((data: Partial<Issue>) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }
    setSaveStatus('saving')
    saveTimeoutRef.current = setTimeout(() => {
      updateIssue.mutate(data)
    }, 800)
  }, [updateIssue])

  // Image upload handler
  const handleFileUpload = async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: formData })
    if (!res.ok) throw new Error('Failed to upload image')
    const data = await res.json()
    return data.url
  }

  const handleTitleChange = (newTitle: string) => {
    setTitle(newTitle)
    if (newTitle.trim()) {
      autoSave({ title: newTitle.trim() })
    }
  }

  const handleDescriptionChange = (newDescription: string) => {
    setDescription(newDescription)
    autoSave({ description: newDescription })
  }

  const handleStatusChange = (newStatus: string) => {
    setStatus(newStatus)
    updateIssue.mutate({ status: newStatus })
  }

  const handlePriorityChange = (newPriority: number) => {
    setPriority(newPriority)
    updateIssue.mutate({ priority: newPriority })
  }

  const handleAssigneeChange = (newIds: number[]) => {
    setAssigneeIds(newIds)
    updateIssue.mutate({ assignee_ids: newIds } as any)
  }

  const handleOpenFullPage = () => {
    onClose()
    router.push(`/dashboard/issues/${issue.id}`)
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  const priorityConfig = PRIORITY_CONFIG[priority as keyof typeof PRIORITY_CONFIG]

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 z-40"
      />

      {/* Modal - Clean, Linear-style */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed inset-4 md:inset-8 lg:inset-12 bg-card rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col"
      >
        {/* Minimal Header */}
        <div className="shrink-0 flex items-center justify-between px-6 py-3 border-b border-border/50">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-muted-foreground">#{issue.id}</span>
            {saveStatus === 'saving' && (
              <span className="text-xs text-muted-foreground">Saving...</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-green-500">Saved</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleOpenFullPage}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
              title="Open full page"
            >
              <ExternalLink size={16} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-secondary rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-6 md:p-10">
            {/* Title - Inline editable, no border */}
            <input
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Issue title..."
              className="w-full text-2xl md:text-3xl font-bold bg-transparent border-none focus:outline-hidden placeholder:text-muted-foreground/40 mb-6"
            />

            {/* Properties Row - Compact, inline */}
            <div className="flex flex-wrap items-center gap-2 mb-8 text-sm">
              <select
                value={status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="bg-secondary/50 hover:bg-secondary border-none rounded-md px-3 py-1.5 text-sm cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-ring"
              >
                {STATUSES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>

              <select
                value={priority}
                onChange={(e) => handlePriorityChange(parseInt(e.target.value))}
                className={`bg-secondary/50 hover:bg-secondary border-none rounded-md px-3 py-1.5 text-sm cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-ring ${priorityConfig?.color || ''}`}
              >
                <option value={1}>Urgent</option>
                <option value={2}>High</option>
                <option value={3}>Medium</option>
                <option value={4}>Low</option>
              </select>

              <select
                value={assigneeIds[0] ?? ''}
                onChange={(e) => handleAssigneeChange(e.target.value ? [parseInt(e.target.value)] : [])}
                className="bg-secondary/50 hover:bg-secondary border-none rounded-md px-3 py-1.5 text-sm cursor-pointer focus:outline-hidden focus:ring-1 focus:ring-ring"
              >
                <option value="">Unassigned</option>
                {members.map((m: any) => (
                  <option key={m.id} value={m.id}>{m.name || m.email}</option>
                ))}
              </select>

              <span className="text-muted-foreground/60 text-xs ml-auto">
                {formatDistanceToNow(new Date(issue.created_at))} ago
              </span>
            </div>

            {/* Description - Clean rich text, no toolbar visible */}
            <div className="prose prose-invert max-w-none">
              <RichTextEditor
                content={description}
                onChange={handleDescriptionChange}
                placeholder="Add description…"
                onFileUpload={handleFileUpload}
                hideToolbar={true}
                minHeight="300px"
              />
            </div>
          </div>
        </div>
      </motion.div>
    </>
  )
}

