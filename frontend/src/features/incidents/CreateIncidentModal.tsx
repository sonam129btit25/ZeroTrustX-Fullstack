import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Siren } from "lucide-react";
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Form";
import { api, apiError } from "@/services/api";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { SEVERITIES, SEVERITY_LABEL } from "@/features/threats/shared";
import { useAssignees } from "@/features/incidents/shared";
import type { Incident } from "@/types/api";

const schema = z.object({
  title: z.string().trim().min(5, "Title must be at least 5 characters").max(200, "Keep the title under 200 characters"),
  description: z.string().max(5000, "Description is limited to 5,000 characters"),
  severity: z.enum(["critical", "high", "medium", "low", "informational"]),
  assignee_id: z.string(),
});
type Form = z.infer<typeof schema>;

export function CreateIncidentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const assignees = useAssignees(open);
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { title: "", description: "", severity: "medium", assignee_id: "" },
  });

  useEffect(() => { if (open) reset({ title: "", description: "", severity: "medium", assignee_id: "" }); }, [open, reset]);

  const create = useMutation({
    mutationFn: async (f: Form) => (await api.post<Incident>("/incidents", {
      title: f.title.trim(), description: f.description.trim(), severity: f.severity, assignee_id: f.assignee_id || null,
    })).data,
    onSuccess: (inc) => {
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Incident ${inc.reference} opened`, inc.assignee ? `Assigned to ${inc.assignee.full_name}` : "Awaiting assignment");
      onClose();
      nav(`/incidents/${inc.id}`);
    },
    onError: (e) => toast.error("Could not open incident", apiError(e).message),
  });

  const assigneeId = watch("assignee_id");
  const desc = watch("description") ?? "";

  return (
    <Modal open={open} onClose={onClose} size="md"
      title={<span className="flex items-center gap-2"><Siren className="h-4 w-4 text-accent" />Open incident</span>}
      description="Create an investigation record. Link alerts by escalating them from Threat Detection."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={create.isPending} onClick={handleSubmit((f) => create.mutate(f))}>Open incident</Button>
      </>}>
      <form className="space-y-4" noValidate onSubmit={handleSubmit((f) => create.mutate(f))}>
        <Field label="Title" required error={errors.title?.message}>
          <Input placeholder="e.g. Suspected credential stuffing against finance accounts" invalid={!!errors.title} data-autofocus {...register("title")} />
        </Field>
        <Field label="Description" error={errors.description?.message}
          hint={<span className="num">{desc.length.toLocaleString()} / 5,000</span>}>
          <Textarea rows={5} placeholder="Scope, affected identities and systems, initial observations…" invalid={!!errors.description} {...register("description")} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Severity" required>
            <Select {...register("severity")}>
              {SEVERITIES.map((s) => <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>)}
            </Select>
          </Field>
          <Field label="Investigator" hint={assigneeId ? "Assigned incidents start in Investigating." : "Unassigned incidents start in Open."}>
            <Select disabled={assignees.isLoading} {...register("assignee_id")}>
              <option value="">Unassigned</option>
              {assignees.data?.map((a) => (
                <option key={a.id} value={a.id}>{a.full_name}{a.id === user?.id ? " (you)" : ""}</option>
              ))}
            </Select>
          </Field>
        </div>
        {assignees.isError && <p className="text-xs text-danger">Could not load investigators: {apiError(assignees.error).message}</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
