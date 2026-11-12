# ZeroTrustX frontend conventions

Stack: React 18 + TypeScript (strict) + Vite + Tailwind 3 + Framer Motion + TanStack Query 5 + React Router 6 +
React Hook Form + Zod 3 + Recharts 2 + lucide-react.

## Design language
- Premium dark graphite / deep navy; accents blue `accent` (#6C8FF5), `lavender` (#9B8AFB), subtle `cyan`.
  **No neon, no glow-heavy effects, no new hex colours.** Use only the Tailwind tokens defined in
  `tailwind.config.ts` / `src/index.css`: `bg-base`, `bg-surface`, `bg-card`, `bg-elevated`, `border-line`,
  `border-line-strong`, `text-fg`, `text-muted`, `text-subtle`, `accent`, `lavender`, `cyan`, `success`,
  `warning`, `danger` (all support `/opacity`). Light theme works automatically through the same tokens.
- Typography: body `text-[13px]`, secondary `text-xs`, labels `.label` class, numbers `.num` (tabular).
  Page titles come from `PageHeader`. Monospace (`font-mono`) for IDs, IPs, decisions, hashes, actions.
- Surfaces: `Card` (`@/components/ui/Page`) with `CardHeader`; spacing `p-4`/`p-5`, grids `gap-4`.
- Motion: subtle. Framer Motion for entrances (opacity + 4–8px y), spring layout transitions. Respect reduced motion
  (global CSS already neutralises durations).

## Building blocks (import, don't re-implement)
| Import | Exports |
| --- | --- |
| `@/components/ui/Button` | `Button` (variant: primary/secondary/outline/ghost/subtle/danger; size: xs/sm/md/lg/icon; `loading`, `icon`) |
| `@/components/ui/Form` | `Input` (`leading`, `invalid`), `Textarea`, `Select`, `Field` (label/hint/error), `Switch`, `Checkbox` |
| `@/components/ui/Badge` | `Badge` (tone), `SeverityBadge`, `TrustBadge`, `DecisionBadge`, `StatusBadge`, `DemoTag`, `DECISION_LABEL` |
| `@/components/ui/Overlay` | `Modal`, `Drawer`, `ConfirmDialog` |
| `@/components/ui/Data` | `DataTable` (columns, rows, loading, rowKey, onRowClick, sort/onSort, empty), `Pagination`, `Skeleton`, `EmptyState`, `Tabs`, `KeyValue` |
| `@/components/ui/Page` | `PageHeader` (title, description, breadcrumbs, actions), `Card`, `CardHeader`, `Toolbar`, `Avatar` |
| `@/components/ui/StatCard` | `StatCard` |
| `@/components/security/DecisionView` | `DecisionIndicator` (animated), `DecisionTrace` (explainable timeline), `DecisionSummary` |
| `@/components/security/Risk` | `RiskMeter`, `RiskRing` |
| `@/components/security/Assistant` | `ExplainButton` (advisory assistant drawer; takes a GET endpoint), `AssistantResult` |
| `@/components/security/PasswordStrength` | `PasswordStrength`, `passwordChecks`, `usePasswordPolicy` |
| `@/pages/auth/MfaVerify` | `OtpInput` (named export) |
| `@/services/api` | `api` (axios, auth handled), `apiError(e)` → `{status, code, message, errors}`, `downloadFile`, `cleanParams` |
| `@/context/AuthContext` | `useAuth()` → `user`, `can(...perms)`, `canAny`, `hasRole`, `refreshUser`, `applyTokens`, `logout` |
| `@/context/ToastContext` | `useToast()` → `success/error/info/warning(title, description?)` |
| `@/context/RealtimeContext` | `useRealtime()` (state), `useRealtimeEvent(types, fn)` |
| `@/context/PreferencesContext` | `usePreferences()` theme/cursor/sidebar/dashboard widgets |
| `@/utils/format` | `cn`, `fmtDate`, `timeAgo`, `titleCase`, `riskLevel`, `fmtNum` |
| `@/types/api` | Shared API types (Page, UserSummary, Device, SessionRow, Policy, Resource, AccessRequest, ThreatAlert, Incident, AuditLog, …) |

## Data fetching
- TanStack Query. **Query keys must start with the resource segment** so WebSocket events auto-invalidate them:
  `["sessions", …]`, `["devices", …]`, `["access-requests", …]`, `["threats", …]`, `["incidents", …]`,
  `["audit-logs", …]`, `["dashboard", …]`, `["notifications", …]`, `["users", …]`, `["policies", …]`, `["resources", …]`.
- Lists are paginated: `{items,total,page,page_size}`; params `page`, `page_size` (≤100), `sort`, `order`, `q`.
- Errors: backend returns `{detail:{code,message,errors?}}`; show `apiError(e).message` in a toast or inline.
- Mutations: invalidate the relevant keys on success, toast success.

## Rules
- Every visible control must do something real (no dead buttons / fake links). Destructive actions use `ConfirmDialog`.
- Hide actions the user lacks permission for (`can("perm")`) — the API enforces RBAC regardless.
- Always handle loading (skeletons), empty (`EmptyState`) and error states.
- Responsive to 360px wide: toolbars wrap, tables scroll horizontally, use `hideBelow` for secondary columns.
- Seeded demo records carry `is_demo: true` → show `<DemoTag />`.
- Be honest in copy: device identity is a browser identifier / manual registration (no endpoint agent); detections
  are rule-based (no ML, no threat-intel feeds); the assistant is advisory and deterministic.
