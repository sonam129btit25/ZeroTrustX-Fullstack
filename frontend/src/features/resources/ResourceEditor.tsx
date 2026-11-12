import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { api, apiError } from "@/services/api";
import type { Resource } from "@/types/api";
import { useToast } from "@/context/ToastContext";
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/Form";
import { isCidr } from "@/features/policies/conditions";
import { RESOURCE_TYPES, SENSITIVITIES } from "./meta";
import { titleCase } from "@/utils/format";

const schema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(150),
  description: z.string().max(2000),
  resource_type: z.enum(RESOURCE_TYPES),
  sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
  required_permission: z.string().trim().max(100).regex(/^[a-z0-9:_-]*$/, "Lowercase letters, digits, ':', '_' and '-' only"),
  url: z.string().trim().max(500).refine((v) => !v || /^(https?:\/\/|\/)/.test(v), "URL must start with http(s):// or /"),
  requires_approval: z.boolean(),
  max_grant_hours: z.coerce.number({ invalid_type_error: "Enter a number" }).int().min(1, "1–720 hours").max(720, "1–720 hours"),
  allowed_ip_ranges: z.string().refine((v) => v.split(/[,\s]+/).filter(Boolean).every(isCidr), "Enter valid CIDRs separated by commas").refine((v) => v.split(/[,\s]+/).filter(Boolean).length <= 20, "At most 20 networks"),
  access_hours_start: z.string(),
  access_hours_end: z.string(),
  is_active: z.boolean(),
}).refine((v) => (v.access_hours_start === "") === (v.access_hours_end === ""), {
  path: ["access_hours_end"], message: "Set both start and end, or neither",
}).refine((v) => v.sensitivity === "public" || v.required_permission.length > 0, {
  path: ["required_permission"], message: "Non-public resources need a required permission",
});
type FormValues = z.infer<typeof schema>;

const toForm = (r?: Resource | null): FormValues => ({
  name: r?.name ?? "", description: r?.description ?? "", resource_type: (r?.resource_type as FormValues["resource_type"]) ?? "application",
  sensitivity: r?.sensitivity ?? "internal", required_permission: r?.required_permission ?? "", url: r?.url ?? "",
  requires_approval: r?.requires_approval ?? true, max_grant_hours: r?.max_grant_hours ?? 72,
  allowed_ip_ranges: (r?.allowed_ip_ranges ?? []).join(", "),
  access_hours_start: r?.access_hours_start == null ? "" : String(r.access_hours_start),
  access_hours_end: r?.access_hours_end == null ? "" : String(r.access_hours_end),
  is_active: r?.is_active ?? true,
});

export function ResourceEditor({ open, resource, onClose }: { open: boolean; resource: Resource | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, control, reset, watch, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toForm(resource) });
  useEffect(() => { if (open) { reset(toForm(resource)); setServerError(null); } }, [open, resource, reset]);

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const body = {
        name: v.name.trim(), description: v.description, resource_type: v.resource_type, sensitivity: v.sensitivity,
        required_permission: v.required_permission || null, url: v.url || null, requires_approval: v.requires_approval,
        max_grant_hours: v.max_grant_hours, allowed_ip_ranges: v.allowed_ip_ranges.split(/[,\s]+/).filter(Boolean),
        access_hours_start: v.access_hours_start === "" ? null : Number(v.access_hours_start),
        access_hours_end: v.access_hours_end === "" ? null : Number(v.access_hours_end),
        is_active: v.is_active, owner_id: resource?.owner?.id ?? null,
      };
      return resource ? (await api.put<Resource>(`/resources/${resource.id}`, body)).data : (await api.post<Resource>("/resources", body)).data;
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["resources"] }); toast.success(resource ? "Resource updated" : "Resource added", r.name); onClose(); },
    onError: (e) => setServerError(apiError(e).message),
  });

  const sens = watch("sensitivity");
  return (
    <Modal open={open} onClose={onClose} size="lg" title={resource ? `Edit ${resource.name}` : "Add protected resource"}
      description="Resources are reachable only through the Policy Enforcement Point; every access attempt is evaluated and recorded."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} onClick={handleSubmit((v) => { setServerError(null); save.mutate(v); })}>{resource ? "Save changes" : "Add resource"}</Button>
      </>}>
      <form className="space-y-4" noValidate onSubmit={handleSubmit((v) => save.mutate(v))}>
        {serverError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-xs text-danger"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{serverError}</div>}
        <Field label="Name" required error={errors.name?.message}><Input {...register("name")} invalid={!!errors.name} placeholder="e.g. Payroll System" /></Field>
        <Field label="Description" error={errors.description?.message}><Textarea {...register("description")} rows={2} className="min-h-[64px]" /></Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Type"><Select {...register("resource_type")}>{RESOURCE_TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}</Select></Field>
          <Field label="Sensitivity"><Select {...register("sensitivity")}>{SENSITIVITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field>
          <Field label="Required permission" required={sens !== "public"} error={errors.required_permission?.message} hint="Role permission that entitles users, e.g. resource:payroll:access">
            <Input {...register("required_permission")} className="font-mono" invalid={!!errors.required_permission} placeholder="resource:name:access" />
          </Field>
          <Field label="URL" error={errors.url?.message} hint="Shown only after access is granted"><Input {...register("url")} className="font-mono" invalid={!!errors.url} placeholder="https://app.internal.example" /></Field>
          <Field label="Max grant (hours)" error={errors.max_grant_hours?.message}><Input type="number" min={1} max={720} {...register("max_grant_hours")} className="num" invalid={!!errors.max_grant_hours} /></Field>
          <Field label="Allowed networks" error={errors.allowed_ip_ranges?.message} hint="Comma-separated CIDRs; empty = any network">
            <Input {...register("allowed_ip_ranges")} className="font-mono" invalid={!!errors.allowed_ip_ranges} placeholder="10.0.0.0/8, 192.168.0.0/16" />
          </Field>
          <Field label="Access window start" hint="Organisation timezone">
            <Select {...register("access_hours_start")}><option value="">No restriction</option>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select>
          </Field>
          <Field label="Access window end" error={errors.access_hours_end?.message}>
            <Select {...register("access_hours_end")} invalid={!!errors.access_hours_end}><option value="">No restriction</option>{Array.from({ length: 24 }, (_, h) => <option key={h + 1} value={h + 1}>{String(h + 1).padStart(2, "0")}:00</option>)}</Select>
          </Field>
        </div>
        <div className="space-y-3 rounded-lg border border-line bg-surface/40 p-3">
          <Controller control={control} name="requires_approval" render={({ field }) => (
            <Switch checked={field.value} onChange={field.onChange} label="Requires manual approval" description="Access requests wait for a reviewer even when the engine allows them." />
          )} />
          <Controller control={control} name="is_active" render={({ field }) => (
            <Switch checked={field.value} onChange={field.onChange} label="Active" description="Inactive resources are hidden from non-admins and always denied." />
          )} />
        </div>
        <button type="submit" hidden aria-hidden />
      </form>
    </Modal>
  );
}
