// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Fail-closed boundary for vo2 order-person proof.
// Every ingress that exists today is caller assertion or an outbound signature.
// This module does not create a client, a design, a credential, or a verifier.

import { DOGFOOD_TENANT_ID } from "../auth/cad-operator.js";
import type { DogfoodOrderIdentityCode } from "./dogfood-saved-design.js";

/**
 * Routes on the integration handler. None of them carry a verified order-person proof.
 * Launch requires a design that already exists. design.exported is signed outbound.
 */
export const CURRENT_ORDER_PERSON_INGRESS = [
    "POST /api/integrations/v1/clients/upsert",
    "POST /api/integrations/v1/designs",
    "POST /api/integrations/v1/launch",
    "GET /api/integrations/v1/designs",
    "design.exported",
] as const;

export interface OrderPersonDecision {
    established: boolean;
    writes: "none" | "client" | "design";
    code: DogfoodOrderIdentityCode;
    ingress: (typeof CURRENT_ORDER_PERSON_INGRESS)[number] | "cad_operator_request" | "proof_shaped";
}

export type OrderPersonEvidence =
    | {
          kind: "cad_operator_request";
          externalOrderId: string;
          clientId?: string | null;
          externalClientId?: string | null;
          patientName?: string | null;
      }
    | {
          kind: "integration_client_upsert";
          source: string;
          tenantId: string;
          externalClientId: string;
          firstName: string;
          lastName: string;
      }
    | {
          kind: "integration_design_create";
          source: string;
          tenantId: string;
          clientId: string;
          externalOrderId: string;
      }
    | { kind: "integration_launch"; designId: string }
    | { kind: "design_exported"; externalOrderId: string; personId?: string | null }
    | { kind: "existing_client_link_only"; externalClientId: string; externalOrderId: string }
    | {
          kind: "proof_shaped";
          source: "vo2";
          tenantId: string;
          externalOrderId: string;
          externalPersonId: string;
          audience: string;
          proofId: string;
      }
    | { kind: "ambiguous_persons"; externalOrderId: string; personIds: readonly string[] }
    | {
          kind: "replayed_proof";
          proofId: string;
          externalOrderId: string;
          externalPersonId: string;
      }
    | {
          kind: "substituted_order";
          proofOrderId: string;
          requestedOrderId: string;
          externalPersonId: string;
      }
    | { kind: "cross_tenant_proof"; tenantId: string; externalOrderId: string; externalPersonId: string };

function refused(
    code: DogfoodOrderIdentityCode,
    ingress: OrderPersonDecision["ingress"],
): OrderPersonDecision {
    return { established: false, writes: "none", code, ingress };
}

/**
 * Classify evidence the dogfood path can actually see.
 * A matching shape is not a seal. No producer is registered here.
 */
export function classifyOrderPersonEvidence(evidence: OrderPersonEvidence): OrderPersonDecision {
    switch (evidence.kind) {
        case "cad_operator_request":
            return refused("order_person_unbound", "cad_operator_request");
        case "integration_client_upsert":
            return refused("order_person_unbound", "POST /api/integrations/v1/clients/upsert");
        case "integration_design_create":
            return refused("order_person_unbound", "POST /api/integrations/v1/designs");
        case "integration_launch":
            return refused("order_person_unbound", "POST /api/integrations/v1/launch");
        case "design_exported":
            return refused("order_person_unbound", "design.exported");
        case "existing_client_link_only":
            return refused("order_person_unbound", "cad_operator_request");
        case "proof_shaped":
            if (evidence.tenantId !== DOGFOOD_TENANT_ID || evidence.source !== "vo2") {
                return refused("order_client_cross_tenant", "proof_shaped");
            }
            return refused("order_person_unbound", "proof_shaped");
        case "ambiguous_persons":
            return refused("order_client_ambiguous", "proof_shaped");
        case "replayed_proof":
            return refused("order_person_unbound", "proof_shaped");
        case "substituted_order":
            return refused(
                evidence.proofOrderId === evidence.requestedOrderId
                    ? "order_person_unbound"
                    : "order_client_mismatch",
                "proof_shaped",
            );
        case "cross_tenant_proof":
            return refused(
                evidence.tenantId === DOGFOOD_TENANT_ID
                    ? "order_person_unbound"
                    : "order_client_cross_tenant",
                "proof_shaped",
            );
        default: {
            const unreachable: never = evidence;
            return unreachable;
        }
    }
}
