// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useMemo, useRef, useState } from "react";
import { findDuplicateClients } from "../../../shared/client-files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ClientInput, ClientRecord } from "@/stores/client-store";

const fieldClass = "min-h-11";

interface NewClientDialogProps {
    open: boolean;
    mode: "create" | "edit";
    initial?: ClientInput;
    clients: ClientRecord[];
    exceptId?: string;
    onClose: () => void;
    onSubmit: (input: ClientInput, intent: "file" | "design") => void;
    onOpenExisting: (id: string) => void;
}

const empty: ClientInput = { firstName: "", lastName: "", dateOfBirth: "", reference: "", email: "", phone: "", notes: "" };

export function NewClientDialog({
    open,
    mode,
    initial,
    clients,
    exceptId,
    onClose,
    onSubmit,
    onOpenExisting,
}: NewClientDialogProps) {
    const [form, setForm] = useState<ClientInput>(initial ?? empty);
    const firstRef = useRef<HTMLInputElement>(null);
    const lastRef = useRef<HTMLInputElement>(null);
    const formKey = `${open}:${initial?.firstName ?? ""}:${initial?.lastName ?? ""}:${exceptId ?? ""}`;
    const [seenKey, setSeenKey] = useState(formKey);
    if (seenKey !== formKey) {
        setSeenKey(formKey);
        setForm(initial ?? empty);
    }

    const duplicates = useMemo(
        () => findDuplicateClients(clients, form, exceptId),
        [clients, form, exceptId],
    );

    const submit = (intent: "file" | "design") => {
        if (!form.firstName.trim()) {
            firstRef.current?.focus();
            return;
        }
        if (!form.lastName.trim()) {
            lastRef.current?.focus();
            return;
        }
        onSubmit(form, intent);
    };

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{mode === "edit" ? "Edit details" : "New client"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                        <Input ref={firstRef} className={fieldClass} placeholder="First name" aria-label="First name" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                        <Input ref={lastRef} className={fieldClass} placeholder="Last name" aria-label="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                    </div>
                    <Input className={fieldClass} type="date" aria-label="Date of birth" value={form.dateOfBirth ?? ""} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
                    <Input className={fieldClass} placeholder="Client ID / MRN" aria-label="Client ID" value={form.reference ?? ""} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
                    <div className="grid grid-cols-2 gap-2">
                        <Input className={fieldClass} placeholder="Phone" aria-label="Phone" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                        <Input className={fieldClass} placeholder="Email" aria-label="Email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </div>
                    <textarea
                        aria-label="Client notes"
                        placeholder="Notes"
                        maxLength={2000}
                        value={form.notes ?? ""}
                        onChange={(e) => setForm({ ...form, notes: e.target.value })}
                        className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    {duplicates.length > 0 ? (
                        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                            A client with this name and date of birth already exists.{" "}
                            <button type="button" className="min-h-11 font-medium underline" onClick={() => onOpenExisting(duplicates[0]!.id)}>
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
                                <Button type="button" className="min-h-11" data-testid="create-and-design" onClick={() => submit("design")}>
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
