// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type {
    ClientLinkRecord,
    ClientRecord,
    CreateClientInput,
    CreateDesignInput,
    CredentialRecord,
    DesignLinkRecord,
    DesignRecord,
    IntegrationStore,
    LaunchRecord,
    ScanFormat,
    ScanRecord,
    ShoeSize,
    UploadRecord,
    UserRecord,
    WebhookEventRecord,
} from "./store.js";
import { StoreConflict } from "./store.js";

export interface TenantSeed {
    id: string;
    name: string;
}

export interface MemoryIntegrationStore extends IntegrationStore {
    addTenant(tenant: TenantSeed): void;
    addUser(user: UserRecord): void;
    setDeclared(clientId: string, declared: boolean): void;
}

export function createMemoryIntegrationStore(): MemoryIntegrationStore {
    const tenants = new Map<string, TenantSeed>();
    const users = new Map<string, UserRecord>();
    const credentials = new Map<string, CredentialRecord>();
    const clients = new Map<string, ClientRecord>();
    const clientLinks = new Map<string, ClientLinkRecord>();
    const designs = new Map<string, DesignRecord>();
    const designLinks = new Map<string, DesignLinkRecord>();
    const uploads = new Map<string, UploadRecord>();
    const launches = new Map<string, LaunchRecord>();
    const scans = new Map<string, ScanRecord>();
    const events: WebhookEventRecord[] = [];

    function clientKey(link: Pick<ClientLinkRecord, "source" | "tenantId" | "externalClientId">): string {
        return `${link.source}\0${link.tenantId}\0${link.externalClientId}`;
    }
    function designKey(link: Pick<DesignLinkRecord, "source" | "tenantId" | "externalOrderId">): string {
        return `${link.source}\0${link.tenantId}\0${link.externalOrderId}`;
    }

    return {
        addTenant(tenant) {
            tenants.set(tenant.id, tenant);
        },
        addUser(user) {
            users.set(user.id, user);
        },
        setDeclared(clientId, declared) {
            const row = clients.get(clientId);
            if (!row) return;
            clients.set(clientId, { ...row, chart: { ...row.chart, declared } });
        },
        async countTenants() {
            return tenants.size;
        },
        async tenantExists(id) {
            return tenants.has(id);
        },
        async findCredentialByHash(hash) {
            for (const row of credentials.values()) {
                if (row.keyHash === hash) return row;
            }
            return null;
        },
        async insertCredential(row) {
            credentials.set(row.id, row);
        },
        async findUser(id) {
            return users.get(id) ?? null;
        },
        async ownerForTenant(tenantId) {
            const matches = [...users.values()].filter(
                (user) => user.tenantId === tenantId && user.role !== "super_admin",
            );
            return matches[0] ?? null;
        },
        async findClient(id) {
            return clients.get(id) ?? null;
        },
        async findClientLink(key) {
            return clientLinks.get(clientKey(key)) ?? null;
        },
        async findClientLinkByClient(source, tenantId, clientId) {
            for (const link of clientLinks.values()) {
                if (link.source === source && link.tenantId === tenantId && link.clientId === clientId)
                    return link;
            }
            return null;
        },
        async createClientWithLink(input: CreateClientInput) {
            const key = clientKey(input.link);
            if (clientLinks.has(key)) throw new StoreConflict();
            clients.set(input.client.id, input.client);
            clientLinks.set(key, input.link);
        },
        async updateClientIdentity(clientId, patch) {
            const row = clients.get(clientId);
            if (!row) return;
            clients.set(clientId, { ...row, ...patch });
        },
        async fillChart(clientId, shoe: ShoeSize) {
            const row = clients.get(clientId);
            if (!row) return;
            clients.set(clientId, { ...row, chart: { declared: true, shoe } });
        },
        async setClientLinkShoe(linkId, shoe, mismatch) {
            for (const [key, link] of clientLinks) {
                if (link.id === linkId)
                    clientLinks.set(key, { ...link, orderShoe: shoe, shoeSizeMismatch: mismatch });
            }
        },
        async findDesignLink(key) {
            return designLinks.get(designKey(key)) ?? null;
        },
        async findDesignLinkByDesignId(designId) {
            for (const link of designLinks.values()) {
                if (link.designId === designId) return link;
            }
            return null;
        },
        async getDesign(id) {
            return designs.get(id) ?? null;
        },
        async createDesignWithLink(input: CreateDesignInput) {
            const key = designKey(input.link);
            if (designLinks.has(key)) throw new StoreConflict();
            designs.set(input.design.id, input.design);
            designLinks.set(key, input.link);
        },
        async replaceOpenUploads(designLinkId, next) {
            for (const [id, row] of uploads) {
                if (row.designLinkId === designLinkId && !row.completedAt) uploads.delete(id);
            }
            for (const row of next) uploads.set(row.id, row);
        },
        async listUploads(designLinkId) {
            return [...uploads.values()].filter((row) => row.designLinkId === designLinkId);
        },
        async completeUpload(
            uploadId,
            patch: { format: ScanFormat; fileName: string; sizeBytes: number; completedAt: string },
        ) {
            const row = uploads.get(uploadId);
            if (!row) return;
            uploads.set(uploadId, { ...row, ...patch });
        },
        async findScanByStorageKey(storageKey) {
            for (const row of scans.values()) {
                if (row.storageKey === storageKey) return row;
            }
            return null;
        },
        async insertScan(row) {
            scans.set(row.id, row);
        },
        async countScans(designId) {
            let count = 0;
            for (const row of scans.values()) if (row.designId === designId) count += 1;
            return count;
        },
        async insertLaunch(row) {
            launches.set(row.tokenHash, row);
        },
        async findLaunchByHash(hash) {
            return launches.get(hash) ?? null;
        },
        async markLaunchUsed(hash, usedAt) {
            const row = launches.get(hash);
            if (!row || row.usedAt) return false;
            launches.set(hash, { ...row, usedAt });
            return true;
        },
        async insertWebhookEvent(row) {
            events.push(row);
        },
    };
}
