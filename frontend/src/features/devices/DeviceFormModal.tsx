import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Info, Search, X } from "lucide-react";
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Avatar } from "@/components/ui/Page";
import { Skeleton } from "@/components/ui/Data";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import type { Device, Page, UserSummary } from "@/types/api";
import { titleCase } from "@/utils/format";
import { useDebounced } from "@/features/identity/hooks";
import { DEVICE_TYPES, TRUST_STATUSES } from "./meta";

const schema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(150),
  device_type: z.enum(DEVICE_TYPES),
  os: z.string().trim().max(60).optional(),
  os_version: z.string().trim().max(60).optional(),
  device_identifier: z.string().trim().max(128).regex(/^[A-Za-z0-9_-]*$/, "Letters, digits, '-' and '_' only").optional(),
  trust_status: z.string().optional(),
  notes: z.string().max(2000).optional(),
});
type FormValues = z.infer<typeof schema>;
type AssignedUser = { id: string; email: string; full_name: string } | null;

const opt = (s?: string) => (s && s.trim() ? s.trim() : null);

/** Register a new device (device = undefined) or edit an existing one. */
export function DeviceFormModal({ open, onClose, device, onSaved }: { open: boolean; onClose: () => void; device?: Device; onSaved?: (d: Device) => void }) {
  const editing = !!device;
  const qc = useQueryClient();
  const toast = useToast();
  const [assigned, setAssigned] = useState<AssignedUser>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setAssigned(device?.user ?? null);
    reset({
      name: device?.name ?? "", device_type: (DEVICE_TYPES as readonly string[]).includes(device?.device_type ?? "") ? device!.device_type as FormValues["device_type"] : "laptop",
      os: device?.os ?? "", os_version: device?.os_version ?? "", device_identifier: "", trust_status: "pending_verification", notes: device?.notes ?? "",
    });
  }, [open, device, reset]);

  const m = useMutation({
    mutationFn: async (f: FormValues) => {
      const common = { name: f.name.trim(), device_type: f.device_type, os: opt(f.os), os_version: opt(f.os_version), user_id: assigned?.id ?? null, notes: opt(f.notes) };
      if (editing) return (await api.patch<Device>(`/devices/${device!.id}`, common)).data;
      return (await api.post<Device>("/devices", { ...common, device_identifier: opt(f.device_identifier), trust_status: f.trust_status || "pending_verification" })).data;
    },
    onSuccess: (d) => {
      toast.success(editing ? "Device updated" : "Device registered", d.name);
      void qc.invalidateQueries({ queryKey: ["devices"] });
      onSaved?.(d);
      onClose();
    },
    onError: (e) => { const err = apiError(e); setServerError(err.message); toast.error(editing ? "Could not update device" : "Could not register device", err.message); },
  });

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? "Edit device" : "Register device"}
      description={editing ? device!.device_identifier : "Manually register a device. Without an endpoint agent, OS details are recorded as provided and are not verified."}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" form="device-form" loading={m.isPending}>{editing ? "Save changes" : "Register device"}</Button>
      </>}>
      <form id="device-form" className="space-y-4" noValidate onSubmit={handleSubmit((f) => { setServerError(null); m.mutate(f); })}>
        {serverError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{serverError}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <Field label="Device name" required error={errors.name?.message}><Input placeholder="Finance MacBook Pro" invalid={!!errors.name} {...register("name")} data-autofocus /></Field>
          <Field label="Type" error={errors.device_type?.message}>
            <Select {...register("device_type")}>{DEVICE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Operating system" error={errors.os?.message}><Input placeholder="macOS" {...register("os")} /></Field>
          <Field label="OS version" error={errors.os_version?.message}><Input placeholder="15.1" {...register("os_version")} /></Field>
        </div>
        {!editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Identifier" hint="Optional. Generated if left blank." error={errors.device_identifier?.message}>
              <Input className="font-mono" placeholder="asset-tag-00412" invalid={!!errors.device_identifier} {...register("device_identifier")} />
            </Field>
            <Field label="Initial trust status">
              <Select {...register("trust_status")}>{TRUST_STATUSES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</Select>
            </Field>
          </div>
        )}
        <UserPicker value={assigned} onChange={setAssigned} />
        <Field label="Notes" error={errors.notes?.message}><Textarea placeholder="Asset tag, owner context, verification performed…" {...register("notes")} /></Field>
      </form>
    </Modal>
  );
}

function UserPicker({ value, onChange }: { value: AssignedUser; onChange: (u: AssignedUser) => void }) {
  const { can } = useAuth();
  const [term, setTerm] = useState("");
  const q = useDebounced(term.trim(), 250);
  const allowed = can("users:read");
  const res = useQuery({
    queryKey: ["users", "picker", q],
    queryFn: async () => (await api.get<Page<UserSummary>>("/users", { params: { q, page_size: 6, sort: "full_name", order: "asc" } })).data,
    enabled: allowed && !value && q.length >= 1,
  });

  if (value) {
    return (
      <Field label="Assigned user">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface/70 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2.5"><Avatar name={value.full_name} size={24} />
            <span className="min-w-0"><span className="block truncate text-[13px] text-fg">{value.full_name}</span><span className="block truncate text-2xs text-muted">{value.email}</span></span></span>
          {allowed && <Button size="xs" variant="ghost" icon={<X className="h-3 w-3" />} onClick={() => { onChange(null); setTerm(""); }}>Unassign</Button>}
        </div>
      </Field>
    );
  }
  if (!allowed) {
    return <p className="flex items-center gap-1.5 text-xs text-subtle"><Info className="h-3.5 w-3.5" />Assigning a user requires the users:read permission.</p>;
  }
  return (
    <Field label="Assigned user" hint="Optional. Search by name or email.">
      <div>
        <Input leading={<Search className="h-4 w-4" />} placeholder="Search users…" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search users to assign" />
        {q.length >= 1 && (
          <div className="mt-1.5 overflow-hidden rounded-lg border border-line bg-surface">
            {res.isLoading && <div className="space-y-2 p-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>}
            {res.isError && <p className="p-3 text-xs text-danger">{apiError(res.error).message}</p>}
            {res.data?.items.length === 0 && <p className="p-3 text-xs text-subtle">No users match “{q}”.</p>}
            {res.data?.items.map((u) => (
              <button key={u.id} type="button" onClick={() => onChange({ id: u.id, email: u.email, full_name: u.full_name })} data-cursor="hover"
                className="flex w-full items-center gap-2.5 border-b border-line/60 px-3 py-2 text-left last:border-0 hover:bg-elevated/60">
                <Avatar name={u.full_name} size={22} />
                <span className="min-w-0"><span className="block truncate text-[13px] text-fg">{u.full_name}</span><span className="block truncate text-2xs text-muted">{u.email}</span></span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
