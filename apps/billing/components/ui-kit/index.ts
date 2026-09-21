// The app's shared building blocks. Generic on purpose: nothing here knows
// what an invoice is beyond a status string and an amount string.
export { Section, FieldList, type SectionProps } from './section'
export { StatTile, StatGrid, type StatTileProps } from './stat-tile'
export { DataTable, type Column, type DataTableProps } from './data-table'
export { EmptyState, ErrorState, LoadingState, ticks, type EmptyStateProps, type ErrorStateProps, type LoadingStateProps } from './states'
export { StatusBadge, type StatusBadgeProps } from './status-badge'
export { Money, type MoneyProps } from './money'
export { DateText, formatDate, type DateTextProps } from './date-text'
export { FormField, FormGrid, Label, Hint, Select, Textarea, ReadOnlyValue, type FormFieldProps } from './form'
export { CodeBlock, type CodeBlockProps } from './code-block'
export { Toolbar, ToolbarSpacer, Segmented, type SegmentOption } from './toolbar'
