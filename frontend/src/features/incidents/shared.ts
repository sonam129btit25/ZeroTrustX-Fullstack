import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { Incident } from "@/types/api";

export type IncidentStatus = Incident["status"];
export interface Assignee { id: string; email: string; full_name: string }

export const INCIDENT_FLOW: IncidentStatus[] = ["open", "investigating", "contained", "resolved", "closed"];

/** Mirrors backend `TRANSITIONS` in app/api/routes/threats.py. */
export const TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ["investigating", "contained", "resolved", "closed"],
  investigating: ["contained", "resolved", "open"],
  contained: ["investigating", "resolved"],
  resolved: ["closed", "investigating"],
  closed: ["investigating"],
};

export const STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "Open", investigating: "Investigating", contained: "Contained", resolved: "Resolved", closed: "Closed",
};

export const STATUS_HINT: Record<IncidentStatus, string> = {
  open: "Reported, awaiting triage",
  investigating: "Analyst is gathering evidence",
  contained: "Impact limited, threat isolated",
  resolved: "Root cause addressed",
  closed: "Post-incident review complete",
};

/** Verb used on the button that moves an incident from `from` to `to`. */
export function transitionLabel(from: IncidentStatus, to: IncidentStatus): string {
  switch (to) {
    case "investigating": return from === "open" ? "Start investigation" : "Reopen investigation";
    case "contained": return "Mark contained";
    case "resolved": return "Resolve";
    case "closed": return "Close incident";
    case "open": return "Return to open";
  }
}

export function useAssignees(enabled = true) {
  return useQuery({
    queryKey: ["incidents", "assignees"],
    queryFn: async () => (await api.get<Assignee[]>("/incidents/assignees")).data,
    staleTime: 5 * 60_000,
    enabled,
  });
}
