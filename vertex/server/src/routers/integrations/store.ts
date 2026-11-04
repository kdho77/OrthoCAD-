// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

export const INTEGRATION_SOURCES = ["vo2", "orthocloud"] as const;
export type IntegrationSource = (typeof INTEGRATION_SOURCES)[number];

export const SHOE_SYSTEMS = ["US_M", "US_W", "EU"] as const;
export type ShoeSystem = (typeof SHOE_SYSTEMS)[number];

export const SHOE_WIDTHS = ["narrow", "medium", "wide"] as const;
export type ShoeWidth = (typeof SHOE_WIDTHS)[number];

export const SCAN_SIDES = ["left", "right", "combined"] as const;
export type ScanSide = (typeof SCAN_SIDES)[number];

export const SCAN_FORMATS = ["stl", "obj", "ply"] as const;
export type ScanFormat = (typeof SCAN_FORMATS)[number];

export const DESIGN_SIDES = ["pair", "left", "right"] as const;
export type DesignSides = (typeof DESIGN_SIDES)[number];

export const DESIGN_TYPES = ["insole", "afo"] as const;
export type DesignType = (typeof DESIGN_TYPES)[number];

export const SCAN_BYTES_MAX = 100 * 1024 * 1024;
export const UPLOAD_URL_TTL_MS = 30 * 60 * 1000;
export const LAUNCH_TTL_MS = 5 * 60 * 1000;

export interface ShoeSize {
    system: ShoeSystem;
    size: number;
    left: number | null;
    right: number | null;
    width: ShoeWidth;
}

export interface ChartState {
    declared: boolean;
    shoe: ShoeSize;
}

export interface CredentialRecord {
    id: string;
    label: string;
    keyHash: string;
    tenantIds: string[];
    webhookUrl: string | null;
    webhookSecretCiphertext: string | null;
    revokedAt: string | null;
}

export interface UserRecord {
    id: string;
    tenantId: string | null;
    role: string;
    email: string;
}

export interface ClientRecord {
    id: string;
    tenantId: string;
    ownerId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    chart: ChartState;
}

export interface ClientLinkRecord {
    id: string;
    source: IntegrationSource;
    tenantId: string;
    externalClientId: string;
    clientId: string;
    orderShoe: ShoeSize;
    shoeSizeMismatch: boolean;
}

export interface DesignRecord {
    id: string;
    clientId: string;
    tenantId: string;
    ownerId: string;
    kind: DesignType;
    name: string;
    notes: string;
    updatedAt: string;
}

export interface DesignLinkRecord {
    id: string;
    source: IntegrationSource;
    tenantId: string;
    externalOrderId: string;
    designId: string;
    clientId: string;
    kind: DesignType;
    sides: DesignSides;
    rxText: string | null;
    notes: string | null;
    orderReference: string | null;
    orderedByAccount: string | null;
    parentExternalOrderId: string | null;
    parentDesignId: string | null;
    shoe: ShoeSize;
    shoeSizeMismatch: boolean;
}

export interface UploadRecord {
    id: string;
    designLinkId: string;
    side: ScanSide;
    storageKey: string;
    uploadUrl: string;
    expiresAt: string;
    completedAt: string | null;
    format: ScanFormat | null;
    fileName: string | null;
    sizeBytes: number | null;
}

export interface LaunchRecord {
    tokenHash: string;
    tenantId: string;
    designId: string;
    actorKind: "clinic" | "vertex_staff";
    actorUserId: string | null;
    actorRole: string;
    expiresAt: string;
    usedAt: string | null;
}

export interface ScanRecord {
    id: string;
    designId: string;
    tenantId: string;
    side: "left" | "right";
    fileName: string;
    storageKey: string;
    format: string;
    sizeBytes: number;
}

export interface WebhookEventRecord {
    id: string;
    type: "design.exported";
    tenantId: string;
    designId: string;
    payload: unknown;
    attemptCount: number;
    nextAttemptAt: string | null;
    deliveredAt: string | null;
}

export class StoreConflict extends Error {
    constructor() {
        super("unique conflict");
        this.name = "StoreConflict";
    }
}

export interface CreateClientInput {
    client: ClientRecord;
    link: ClientLinkRecord;
}

export interface CreateDesignInput {
    design: DesignRecord;
    link: DesignLinkRecord;
}

export interface IntegrationStore {
    countTenants(): Promise<number>;
    tenantExists(id: string): Promise<boolean>;
    findCredentialByHash(hash: string): Promise<CredentialRecord | null>;
    insertCredential(row: CredentialRecord): Promise<void>;
    findUser(id: string): Promise<UserRecord | null>;
    ownerForTenant(tenantId: string): Promise<UserRecord | null>;
    findClient(id: string): Promise<ClientRecord | null>;
    findClientLink(key: {
        source: IntegrationSource;
        tenantId: string;
        externalClientId: string;
    }): Promise<ClientLinkRecord | null>;
    findClientLinkByClient(
        source: IntegrationSource,
        tenantId: string,
        clientId: string,
    ): Promise<ClientLinkRecord | null>;
    createClientWithLink(input: CreateClientInput): Promise<void>;
    updateClientIdentity(
        clientId: string,
        patch: { firstName: string; lastName: string; dateOfBirth: string | null },
    ): Promise<void>;
    fillChart(clientId: string, shoe: ShoeSize): Promise<void>;
    setClientLinkShoe(linkId: string, shoe: ShoeSize, mismatch: boolean): Promise<void>;
    findDesignLink(key: {
        source: IntegrationSource;
        tenantId: string;
        externalOrderId: string;
    }): Promise<DesignLinkRecord | null>;
    findDesignLinkByDesignId(designId: string): Promise<DesignLinkRecord | null>;
    getDesign(id: string): Promise<DesignRecord | null>;
    createDesignWithLink(input: CreateDesignInput): Promise<void>;
    replaceOpenUploads(designLinkId: string, uploads: UploadRecord[]): Promise<void>;
    listUploads(designLinkId: string): Promise<UploadRecord[]>;
    completeUpload(
        uploadId: string,
        patch: { format: ScanFormat; fileName: string; sizeBytes: number; completedAt: string },
    ): Promise<void>;
    findScanByStorageKey(storageKey: string): Promise<ScanRecord | null>;
    insertScan(row: ScanRecord): Promise<void>;
    countScans(designId: string): Promise<number>;
    insertLaunch(row: LaunchRecord): Promise<void>;
    findLaunchByHash(hash: string): Promise<LaunchRecord | null>;
    markLaunchUsed(hash: string, usedAt: string): Promise<boolean>;
    insertWebhookEvent(row: WebhookEventRecord): Promise<void>;
}
