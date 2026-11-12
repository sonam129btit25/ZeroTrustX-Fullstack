import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Briefcase, Phone, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/Page";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { api, apiError } from "@/services/api";
import { fmtDate, timeAgo } from "@/utils/format";
import { Fact, Section } from "./shared";

const schema = z.object({
  full_name: z.string().trim().min(2, "At least 2 characters").max(150, "At most 150 characters"),
  phone: z.string().trim().max(40, "At most 40 characters")
    .refine((v) => v === "" || /^[+()\d\s.-]{5,40}$/.test(v), "Use digits, spaces and + ( ) - . only"),
  job_title: z.string().trim().max(100, "At most 100 characters"),
});
type Form = z.infer<typeof schema>;

export function ProfileTab() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { full_name: user?.full_name ?? "", phone: user?.phone ?? "", job_title: user?.job_title ?? "" },
  });

  useEffect(() => {
    if (user) reset({ full_name: user.full_name, phone: user.phone ?? "", job_title: user.job_title ?? "" });
  }, [user, reset]);

  if (!user) return null;

  const onSubmit = async (f: Form) => {
    try {
      await api.patch("/auth/me", { full_name: f.full_name, phone: f.phone || null, job_title: f.job_title || null });
      await refreshUser();
      toast.success("Profile updated");
    } catch (e) {
      const err = apiError(e);
      if (err.errors && Array.isArray(err.errors)) {
        for (const x of err.errors) {
          if (typeof x === "object" && x.field && ["full_name", "phone", "job_title"].includes(x.field)) setError(x.field as keyof Form, { message: x.message });
        }
      }
      toast.error("Could not update profile", err.message);
    }
  };

  return (
    <div className="space-y-4">
      <Section title="Account" description="Identity attributes managed by your administrators.">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <Avatar name={user.full_name || user.email} size={52} />
          <dl className="grid flex-1 grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label="Email"><span className="break-all">{user.email}</span></Fact>
            <Fact label="Status"><StatusBadge status={user.status} /></Fact>
            <Fact label="Roles">
              <span className="flex flex-wrap gap-1">
                {user.roles.length ? user.roles.map((r) => <Badge key={r.id} tone="lavender">{r.display_name}</Badge>) : <span className="text-subtle">None</span>}
              </span>
            </Fact>
            <Fact label="Department">{user.department ?? <span className="text-subtle">—</span>}</Fact>
            <Fact label="Last sign-in">{user.last_login_at ? <span title={fmtDate(user.last_login_at)}>{timeAgo(user.last_login_at)}</span> : "—"}</Fact>
            <Fact label="Member since">{fmtDate(user.created_at, { dateStyle: "medium" })}</Fact>
          </dl>
        </div>
        <p className="mt-5 border-t border-line/60 pt-4 text-xs text-subtle">Email, roles and status can only be changed by an administrator with identity management permissions.</p>
      </Section>

      <Section title="Personal details" description="Shown to administrators and on access requests you submit.">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Full name" required error={errors.full_name?.message} className="md:col-span-2">
              <Input autoComplete="name" leading={<UserRound className="h-4 w-4" />} invalid={!!errors.full_name} {...register("full_name")} />
            </Field>
            <Field label="Job title" error={errors.job_title?.message}>
              <Input autoComplete="organization-title" placeholder="e.g. Platform Engineer" leading={<Briefcase className="h-4 w-4" />} invalid={!!errors.job_title} {...register("job_title")} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input type="tel" autoComplete="tel" placeholder="+1 555 0100" leading={<Phone className="h-4 w-4" />} invalid={!!errors.phone} {...register("phone")} />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line/60 pt-4">
            <Button variant="ghost" disabled={!isDirty || isSubmitting}
              onClick={() => reset({ full_name: user.full_name, phone: user.phone ?? "", job_title: user.job_title ?? "" })}>Reset</Button>
            <Button type="submit" variant="primary" loading={isSubmitting} disabled={!isDirty}>Save changes</Button>
          </div>
        </form>
      </Section>
    </div>
  );
}
