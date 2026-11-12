import { lazy, Suspense, type ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { AppLayout } from "@/layouts/AppLayout";
import { GuestOnly, RequireAuth, RequirePermission } from "@/routes/guards";
import { Skeleton } from "@/components/ui/Data";
import Login from "@/pages/auth/Login";
import { NotFound, SessionExpired } from "@/pages/auth/StatusPages";
import { useAuth } from "@/context/AuthContext";

const Register = lazy(() => import("@/pages/auth/Register"));
const ForgotPassword = lazy(() => import("@/pages/auth/ForgotPassword"));
const ResetPassword = lazy(() => import("@/pages/auth/ResetPassword"));
const MfaVerify = lazy(() => import("@/pages/auth/MfaVerify"));
const Dashboard = lazy(() => import("@/pages/app/Dashboard"));
const MyOverview = lazy(() => import("@/pages/app/MyOverview"));
const Identity = lazy(() => import("@/pages/app/identity/Identity"));
const UserDetail = lazy(() => import("@/pages/app/identity/UserDetail"));
const Devices = lazy(() => import("@/pages/app/Devices"));
const AccessRequests = lazy(() => import("@/pages/app/AccessRequests"));
const Policies = lazy(() => import("@/pages/app/Policies"));
const Resources = lazy(() => import("@/pages/app/Resources"));
const Sessions = lazy(() => import("@/pages/app/Sessions"));
const Threats = lazy(() => import("@/pages/app/Threats"));
const Incidents = lazy(() => import("@/pages/app/Incidents"));
const IncidentDetail = lazy(() => import("@/pages/app/IncidentDetail"));
const AuditLogs = lazy(() => import("@/pages/app/AuditLogs"));
const Settings = lazy(() => import("@/pages/app/Settings"));

function PageFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}</div>
      <Skeleton className="h-80" />
    </div>
  );
}

const S = ({ children }: { children: ReactNode }) => <Suspense fallback={<PageFallback />}>{children}</Suspense>;
const P = ({ perm, children }: { perm: string | string[]; children: ReactNode }) => <RequirePermission perm={perm}><S>{children}</S></RequirePermission>;

function Overview() {
  const { can } = useAuth();
  return <S>{can("dashboard:read") ? <Dashboard /> : <MyOverview />}</S>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><S><Register /></S></GuestOnly>} />
      <Route path="/forgot-password" element={<GuestOnly><S><ForgotPassword /></S></GuestOnly>} />
      <Route path="/reset-password" element={<S><ResetPassword /></S>} />
      <Route path="/mfa" element={<GuestOnly><S><MfaVerify /></S></GuestOnly>} />
      <Route path="/session-expired" element={<SessionExpired />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={<Overview />} />
        <Route path="identity" element={<P perm="users:read"><Identity /></P>} />
        <Route path="identity/users/:id" element={<P perm="users:read"><UserDetail /></P>} />
        <Route path="devices" element={<P perm="devices:read"><Devices /></P>} />
        <Route path="access-requests" element={<S><AccessRequests /></S>} />
        <Route path="policies" element={<P perm="policies:read"><Policies /></P>} />
        <Route path="resources" element={<P perm="resources:read"><Resources /></P>} />
        <Route path="sessions" element={<P perm="sessions:read_all"><Sessions /></P>} />
        <Route path="threats" element={<P perm="threats:read"><Threats /></P>} />
        <Route path="incidents" element={<P perm="incidents:read"><Incidents /></P>} />
        <Route path="incidents/:id" element={<P perm="incidents:read"><IncidentDetail /></P>} />
        <Route path="audit-logs" element={<P perm="audit:read"><AuditLogs /></P>} />
        <Route path="settings" element={<S><Settings /></S>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
