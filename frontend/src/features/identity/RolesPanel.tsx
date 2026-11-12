import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, Pencil, ServerCog, ShieldAlert, Users } from "lucide-react";
import { Card } from "@/components/ui/Page";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, Skeleton } from "@/components/ui/Data";
import { Modal } from "@/components/ui/Overlay";
import { Input } from "@/components/ui/Form";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import { cn, titleCase } from "@/utils/format";
import { groupBy, usePermissionCatalog, useRoles } from "./hooks";
import type { PermissionDef, RoleFull } from "./types";

export function RolesPanel() {
  const { can } = useAuth();
  const roles = useRoles();
  const [editing, setEditing] = useState<RoleFull | null>(null);
  const canWrite = can("roles:write");

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface/60 px-4 py-3 text-xs leading-relaxed text-muted sm:flex-row sm:items-center">
        <ServerCog className="h-4 w-4 shrink-0 text-accent" />
        <p>
          Role-based access control is <span className="text-fg">enforced server-side</span> on every API call; this view only reflects it.
          The <span className="text-fg">Super Admin</span> role is immutable, and administrators cannot grant permissions they do not hold
          or modify roles at or above their own privilege level.
        </p>
      </div>

      {roles.isLoading && (
        <div className="grid gap-4 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>
      )}
      {roles.isError && (
        <Card><EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="Could not load roles" description={apiError(roles.error).message}
          action={<Button size="sm" onClick={() => roles.refetch()}>Retry</Button>} /></Card>
      )}
      {roles.data && roles.data.length === 0 && <Card><EmptyState title="No roles defined" /></Card>}

      <div className="grid gap-4 lg:grid-cols-2">
        {roles.data?.map((r, i) => {
          const immutable = r.name === "super_admin";
          return (
            <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.04, 0.3) }}>
              <Card className="h-full p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[14px] font-semibold text-fg">{r.display_name}</h3>
                      {r.is_system && <Badge>System</Badge>}
                      {immutable && <Badge tone="lavender"><Lock className="h-2.5 w-2.5" />Immutable</Badge>}
                    </div>
                    <p className="mt-0.5 font-mono text-2xs text-subtle">{r.name}</p>
                  </div>
                  {canWrite && !immutable && (
                    <Button size="xs" variant="outline" icon={<Pencil className="h-3 w-3" />} onClick={() => setEditing(r)}>Edit permissions</Button>
                  )}
                </div>
                {r.description && <p className="mt-3 text-xs leading-relaxed text-muted">{r.description}</p>}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Metric label="Level" value={r.level} />
                  <Metric label="Users" value={r.user_count} icon={<Users className="h-3 w-3" />} />
                  <Metric label="Permissions" value={r.permissions.length} icon={<KeyRound className="h-3 w-3" />} />
                </div>
                <div className="mt-4 space-y-2.5">
                  {r.permissions.length === 0 && <p className="text-xs text-subtle">No permissions assigned.</p>}
                  {groupBy(r.permissions, (p) => p.category).map(([cat, perms]) => (
                    <div key={cat} className="flex flex-col gap-1.5 sm:flex-row sm:items-start">
                      <span className="label w-28 shrink-0 pt-1">{titleCase(cat)}</span>
                      <div className="flex flex-wrap gap-1">
                        {perms.map((p) => <span key={p.id} className="rounded-md border border-line bg-elevated/60 px-1.5 py-0.5 font-mono text-2xs text-muted">{p.code}</span>)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
      <EditPermissionsModal role={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function Metric({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line/70 bg-surface/50 px-3 py-2">
      <p className="label flex items-center gap-1">{icon}{label}</p>
      <p className="num mt-0.5 text-[15px] font-semibold text-fg">{value}</p>
    </div>
  );
}

function EditPermissionsModal({ role, onClose }: { role: RoleFull | null; onClose: () => void }) {
  const open = !!role;
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const catalog = usePermissionCatalog(open);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (role) { setSelected(new Set(role.permissions.map((p) => p.id))); setFilter(""); }
  }, [role]);

  const held = useMemo(() => new Set(user?.permissions ?? []), [user]);
  const isSuper = user?.roles.some((r) => r.name === "super_admin") ?? false;
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const items = (catalog.data ?? []).filter((p) => !f || p.code.includes(f) || (p.description ?? "").toLowerCase().includes(f) || p.category.includes(f));
    return groupBy(items, (p) => p.category);
  }, [catalog.data, filter]);

  const original = useMemo(() => new Set(role?.permissions.map((p) => p.id) ?? []), [role]);
  const added = [...selected].filter((x) => !original.has(x)).length;
  const removed = [...original].filter((x) => !selected.has(x)).length;

  const m = useMutation({
    mutationFn: async () => (await api.put<{ message: string; permissions: string[] }>(`/roles/${role!.id}/permissions`, { permission_ids: [...selected] })).data,
    onSuccess: (d) => {
      toast.success("Role permissions updated", `${role!.display_name} now has ${d.permissions.length} permissions.`);
      void qc.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (e) => toast.error("Could not update role", apiError(e).message),
  });

  const toggle = (p: PermissionDef) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
    return n;
  });
  const toggleGroup = (perms: PermissionDef[], on: boolean) => setSelected((s) => {
    const n = new Set(s);
    perms.forEach((p) => { if (on && (isSuper || held.has(p.code))) n.add(p.id); else if (!on) n.delete(p.id); });
    return n;
  });

  return (
    <Modal open={open} onClose={onClose} size="xl" title={role ? `Edit permissions — ${role.display_name}` : "Edit permissions"}
      description="Changes apply immediately to every user holding this role. All changes are recorded in the audit log."
      footer={<>
        <span className="mr-auto text-xs text-muted num">
          {selected.size} selected{(added || removed) ? <> · <span className="text-success">+{added}</span> <span className="text-danger">−{removed}</span></> : null}
        </span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={m.isPending} disabled={!added && !removed} onClick={() => m.mutate()}>Save permissions</Button>
      </>}>
      <div className="mb-4">
        <Input placeholder="Filter permissions…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {catalog.isLoading && <div className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>}
      {catalog.isError && <p className="text-xs text-danger">{apiError(catalog.error).message}</p>}
      {catalog.data && groups.length === 0 && <EmptyState title="No permissions match" />}
      <div className="grid gap-3 sm:grid-cols-2">
        {groups.map(([cat, perms]) => {
          const all = perms.every((p) => selected.has(p.id));
          return (
            <div key={cat} className="rounded-lg border border-line bg-surface/50">
              <div className="flex items-center justify-between border-b border-line/70 px-3 py-2">
                <span className="label">{titleCase(cat)}</span>
                <button type="button" className="text-2xs text-accent hover:underline" onClick={() => toggleGroup(perms, !all)}>{all ? "Clear" : "Select all"}</button>
              </div>
              <div className="space-y-1 p-2">
                {perms.map((p) => {
                  const disabled = !isSuper && !held.has(p.code) && !selected.has(p.id);
                  return (
                    <label key={p.id} title={disabled ? "You cannot grant a permission you do not hold" : undefined}
                      className={cn("flex items-start gap-2.5 rounded-md px-2 py-1.5", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-elevated/60")}>
                      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]" checked={selected.has(p.id)} disabled={disabled} onChange={() => toggle(p)} />
                      <span className="min-w-0">
                        <span className="block font-mono text-xs text-fg">{p.code}</span>
                        {p.description && <span className="block text-2xs leading-snug text-subtle">{p.description}</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
