import { useQuery } from "@tanstack/react-query";
import { api } from "@/services/api";
import type { Page, Policy, PolicyFields, Resource } from "@/types/api";
import type { PolicyDetail, SimulateBody, SimulationResult } from "./types";

export const policyKeys = {
  list: ["policies", "list"] as const,
  fields: ["policies", "fields"] as const,
  detail: (id: string) => ["policies", "detail", id] as const,
};

export function usePolicies(enabled = true) {
  return useQuery({ queryKey: policyKeys.list, enabled, queryFn: async () => (await api.get<Policy[]>("/policies")).data });
}

export function usePolicyFields(enabled = true) {
  return useQuery({
    queryKey: policyKeys.fields, enabled, staleTime: 10 * 60_000,
    queryFn: async () => (await api.get<PolicyFields>("/policies/fields")).data,
  });
}

export function usePolicyDetail(id: string | null) {
  return useQuery({
    queryKey: policyKeys.detail(id ?? ""), enabled: !!id,
    queryFn: async () => (await api.get<PolicyDetail>(`/policies/${id}`)).data,
  });
}

/** Full resource catalogue (≤100) used by selects across policies, resources and access requests. */
export function useResourceCatalogue(enabled = true) {
  return useQuery({
    queryKey: ["resources", "catalogue"], enabled, staleTime: 60_000,
    queryFn: async () => (await api.get<Page<Resource>>("/resources", { params: { page_size: 100, sort: "name", order: "asc" } })).data.items,
  });
}

export async function simulate(body: SimulateBody) {
  return (await api.post<SimulationResult>("/policies/simulate", body)).data;
}
