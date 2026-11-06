// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Implementation lives in vertex/shared so the production server can import it.

export {
    addPatientNameEnabled,
    composeBottomEngraveLines,
    composeMarkingTextForSide,
    extraTextForSide,
    hasActiveComposedTextMarking,
    markingWithComposedText,
    migrateLegacyPatientNameInText,
    patientDisplayNameFromParts,
    sanitizeExtraText,
} from "../../../../shared/bottom-text-marking";
