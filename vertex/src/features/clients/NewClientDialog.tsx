// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ClientInput, ClientRecord } from "@/stores/client-store";
import { findDuplicateClients, formatClientName, resolveClientIdentity } from "../../../shared/client-files";

const fieldClass = "min-h-11";

interface NewClientDialogProps {
    open: boolean;
    mode: "create" | "edit";
    initial?: ClientInput;
    clients: ClientRecord[];
    exceptId?: string;
    storePhi?: boolean;
    onClose: () => void;
    onSubmit: (input: ClientInput, intent: "file" | "design") => void;
    onOpenExisting: (id: string) => void;
}

const empty: ClientInput = {
    displayName: "",
    firstName: "",
    lastName: "",
    dateOfBirth: "",
    reference: "",
    mrn: "",
    email: "",
    phone: "",
    notes: "",
};

export function NewClientDialog({
    open,
    mode,
    initial,
    clients,
    exceptId,
    storePhi = false,
    onClose,
    onSubmit,
    onOpenExisting,
}: NewClientDialogProps) {
    const [form, setForm] = useState<ClientInput>(initial ?? empty);
    const nameRef = useRef<HTMLInputElement>(null);
    const referenceRef = useRef<HTMLInputElement>(null);
    const formKey = `${open}:${initial?.displayName ?? ""}:${initial?.firstName ?? ""}:${initial?.lastName ?? ""}:${exceptId ?? ""}`;
    const [seenKey, setSeenKey] = useState(formKey);
    if (seenKey !== formKey) {
        setSeenKey(formKey);
        setForm(
            initial
                ? { ...empty, ...initial, displayName: initial.displayName || formatClientName(initial) }
                : empty,
        );
    }

    const duplicates = useMemo(
        () => findDuplicateClients(clients, form, exceptId, storePhi),
        [clients, form, exceptId, storePhi],
    );

    const submit = (intent: "file" | "design") => {
        try {
            resolveClientIdentity(form);
        } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (message.includes("reference")) referenceRef.current?.focus();
            else nameRef.current?.focus();
            return;
        }
        const next = storePhi ? form : { ...form, dateOfBirth: "", mrn: "", email: "", phone: "", notes: "" };
        onSubmit(next, intent);
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{mode === "edit" ? "Edit details" : "New client"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                    <Input
                        ref={nameRef}
                        className={fieldClass}
                        placeholder="Display name or initials"
                        aria-label="Display name or initials"
                        value={form.displayName ?? ""}
                        onChange={(e) =>
                            setForm({ ...form, displayName: e.target.value, firstName: "", lastName: "" })
                        }
                    />
                    <Input
                        ref={referenceRef}
                        className={fieldClass}
                        placeholder="Client reference"
                        aria-label="Client reference"
                        value={form.reference ?? ""}
                        onChange={(e) => setForm({ ...form, reference: e.target.value })}
                    />
                    {storePhi ? (
                        <>
                            <Input
                                className={fieldClass}
                                type="date"
                                aria-label="Date of birth"
                                value={form.dateOfBirth ?? ""}
                                onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                            />
                            <Input
                                className={fieldClass}
                                placeholder="MRN"
                                aria-label="MRN"
                                value={form.mrn ?? ""}
                                onChange={(e) => setForm({ ...form, mrn: e.target.value })}
                            />
                            <div className="grid grid-cols-2 gap-2">
                                <Input
                                    className={fieldClass}
                                    placeholder="Phone"
                                    aria-label="Phone"
                                    value={form.phone ?? ""}
                                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                                />
                                <Input
                                    className={fieldClass}
                                    placeholder="Email"
                                    aria-label="Email"
                                    value={form.email ?? ""}
                                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                                />
                            </div>
                            <textarea
                                aria-label="Client notes"
                                placeholder="Notes"
                                maxLength={2000}
                                value={form.notes ?? ""}
                                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            />
                        </>
                    ) : null}
                    {duplicates.length > 0 ? (
                        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                            {storePhi
                                ? "A client with this name and date of birth already exists. "
                                : "A client with this name and reference already exists. "}
                            <button
                                type="button"
                                className="min-h-11 font-medium underline"
                                onClick={() => onOpenExisting(duplicates[0]!.id)}
                            >
                                Open existing
                            </button>
                        </p>
                    ) : null}
                    <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-end">
                        {mode === "edit" ? (
                            <Button type="button" className="min-h-11" onClick={() => submit("file")}>
                                Save
                            </Button>
                        ) : (
                            <>
                                <Button type="button" className="min-h-11" onClick={() => submit("file")}>
                                    Create client
                                </Button>
                                <Button
                                    type="button"
                                    className="min-h-11"
                                    data-testid="create-and-design"
                                    onClick={() => submit("design")}
                                >
                                    Create & start design
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
