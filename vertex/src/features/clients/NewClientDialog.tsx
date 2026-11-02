// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ClientInput, ClientRecord } from "@/stores/client-store";
import {
    CHART_SHOE_SIZE_MESSAGE,
    CHART_SHOE_WIDTHS,
    type ChartShoeWidth,
    defaultShoeChart,
    findDuplicateClients,
    formatClientName,
    resolveClientIdentity,
    shoeChartFromInput,
    validateClientChartInput,
} from "../../../shared/client-files";

const fieldClass = "min-h-11";

const WIDTH_LABELS: Record<ChartShoeWidth, string> = {
    narrow: "Narrow",
    medium: "Medium",
    wide: "Wide",
    extra_wide: "Extra wide",
};

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
    ...defaultShoeChart(),
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
    const [identityError, setIdentityError] = useState("");
    const [chartError, setChartError] = useState("");
    const nameRef = useRef<HTMLInputElement>(null);
    const referenceRef = useRef<HTMLInputElement>(null);
    const formKey = `${open}:${initial?.displayName ?? ""}:${initial?.firstName ?? ""}:${initial?.lastName ?? ""}:${exceptId ?? ""}`;
    const [seenKey, setSeenKey] = useState(formKey);
    if (seenKey !== formKey) {
        setSeenKey(formKey);
        setIdentityError("");
        setChartError("");
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

    const chartValidation = mode === "create" ? validateClientChartInput(form) : null;
    const identityOk = useMemo(() => {
        try {
            resolveClientIdentity(form);
            return true;
        } catch {
            return false;
        }
    }, [form]);
    const canSave = identityOk && !chartValidation;

    const submit = (intent: "file" | "design") => {
        setIdentityError("");
        setChartError("");
        try {
            resolveClientIdentity(form);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Display name or initials are required";
            setIdentityError(message);
            nameRef.current?.focus();
            return;
        }
        if (mode === "create") {
            const message = validateClientChartInput(form);
            if (message) {
                setChartError(message);
                return;
            }
        }
        const chart = shoeChartFromInput(form);
        const next = storePhi
            ? { ...form, ...chart }
            : {
                  ...form,
                  ...chart,
                  dateOfBirth: "",
                  mrn: "",
                  email: "",
                  phone: "",
                  notes: "",
              };
        onSubmit(next, intent);
    };

    const setChart = (patch: Partial<ClientInput>) => setForm((current) => ({ ...current, ...patch }));

    return (
        <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
            <DialogContent className="max-w-lg">
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
                        onChange={(e) => {
                            setIdentityError("");
                            setForm({ ...form, displayName: e.target.value, firstName: "", lastName: "" });
                        }}
                    />
                    {identityError ? (
                        <p className="text-xs text-red-300" data-testid="client-name-error">
                            {identityError}
                        </p>
                    ) : null}
                    <Input
                        ref={referenceRef}
                        className={fieldClass}
                        placeholder="Client reference (optional)"
                        aria-label="Client reference"
                        value={form.reference ?? ""}
                        onChange={(e) => setForm({ ...form, reference: e.target.value })}
                    />
                    {mode === "create" ? (
                        <CreateClientShoeFields
                            form={form}
                            chartError={chartError || chartValidation}
                            onChange={setChart}
                        />
                    ) : null}
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
                                <Button
                                    type="button"
                                    className="min-h-11"
                                    disabled={!canSave}
                                    onClick={() => submit("file")}
                                >
                                    Save
                                </Button>
                                <Button
                                    type="button"
                                    className="min-h-11"
                                    data-testid="create-and-design"
                                    disabled={!canSave}
                                    onClick={() => submit("design")}
                                >
                                    Save &amp; Launch Design
                                </Button>
                            </>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

function CreateClientShoeFields({
    form,
    chartError,
    onChange,
}: {
    form: ClientInput;
    chartError: string | null;
    onChange: (patch: Partial<ClientInput>) => void;
}) {
    const split = form.shoeSizesSplit === true;
    const preview = validateClientChartInput(form) ? null : shoeChartFromInput(form);
    return (
        <div className="rounded-md border border-border p-3" data-testid="create-client-shoe">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Shoe size</span>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        data-testid="shoe-size-split"
                        checked={split}
                        onChange={(event) => {
                            const shoeSizesSplit = event.target.checked;
                            onChange({
                                shoeSizesSplit,
                                shoeSizeLeftUs: form.shoeSizeUs,
                                shoeSizeRightUs: form.shoeSizeUs,
                            });
                        }}
                    />
                    Separate left and right sizes
                </label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {split ? (
                    <>
                        <DraftSizeField
                            label="Left size"
                            testId="shoe-size-left"
                            value={form.shoeSizeLeftUs}
                            onChange={(shoeSizeLeftUs) => onChange({ shoeSizeLeftUs })}
                        />
                        <DraftSizeField
                            label="Right size"
                            testId="shoe-size-right"
                            value={form.shoeSizeRightUs}
                            onChange={(shoeSizeRightUs) => onChange({ shoeSizeRightUs })}
                        />
                    </>
                ) : (
                    <DraftSizeField
                        label="Shoe size (US men's)"
                        testId="shoe-size"
                        value={form.shoeSizeUs}
                        onChange={(shoeSizeUs) =>
                            onChange({ shoeSizeUs, shoeSizeLeftUs: shoeSizeUs, shoeSizeRightUs: shoeSizeUs })
                        }
                    />
                )}
                <label className="text-xs text-muted-foreground">
                    Width
                    <select
                        data-testid="shoe-width"
                        aria-label="Width"
                        className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                        value={form.shoeWidth ?? "medium"}
                        onChange={(event) => onChange({ shoeWidth: event.target.value as ChartShoeWidth })}
                    >
                        {CHART_SHOE_WIDTHS.map((width) => (
                            <option key={width} value={width}>
                                {WIDTH_LABELS[width]}
                            </option>
                        ))}
                    </select>
                </label>
            </div>
            {chartError ? (
                <p className="mt-2 text-xs text-red-300" data-testid="shoe-size-error">
                    {chartError}
                </p>
            ) : preview ? (
                <p className="mt-2 text-xs text-muted-foreground">
                    Generated size US men's{" "}
                    {preview.shoeSizesSplit ? preview.shoeSizeLeftUs : preview.shoeSizeUs}. Width{" "}
                    {WIDTH_LABELS[preview.shoeWidth]}.
                </p>
            ) : (
                <p className="mt-2 text-xs text-muted-foreground">{CHART_SHOE_SIZE_MESSAGE}</p>
            )}
        </div>
    );
}

function DraftSizeField({
    label,
    testId,
    value,
    onChange,
}: {
    label: string;
    testId: string;
    value: number | undefined;
    onChange: (value: number | undefined) => void;
}) {
    return (
        <label className="text-xs text-muted-foreground">
            {label}
            <input
                data-testid={testId}
                aria-label={label}
                type="number"
                min={1}
                max={16}
                step={0.5}
                value={value ?? ""}
                className="mt-1 block min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                onChange={(event) => {
                    const raw = event.target.value.trim();
                    if (!raw) {
                        onChange(undefined);
                        return;
                    }
                    const next = Number(raw);
                    onChange(Number.isFinite(next) ? next : undefined);
                }}
            />
        </label>
    );
}
