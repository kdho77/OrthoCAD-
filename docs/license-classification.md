# License classification

Proprietary notice wording is **pending counsel review**. This document is an engineering provenance record, not a legal opinion.

Header text used on confirmed Vertex-owned files:

```
Copyright Vertex Orthopedic. All rights reserved.
Wording pending counsel review.
```

## How a file was classified

A Chili3D/AGPL banner is not provenance. The monorepo agent guide required that banner on TypeScript, and the same two lines were copied onto later OrthoCAD sources.

- **Chili3D-derived code.** History descends from the Chili3D publish (`chili-core` renamed into `packages/`, `cpp/` OpenCascade WASM, `plugins/`, the root Chili3D app shell, WASM release scripts, and the OCCT MCP guide). Removed. Not reheadered.
- **Original Vertex/OrthoCAD code.** Authored in this repository for the orthotic product (vertex app, root orthotic tests, and the Python manufacturing service). No Chili3D import and no copied Chili3D expression. Banner replaced.
- **Substantially rewritten Vertex code.** `geometry-kernel.ts` and `KernelLoadingBanner.tsx` used to wrap the Chili3D/OCCT kernel. PRs #218-#220 already replaced that expression with the procedural Three.js kernel and an empty banner hook. This change only replaces the banner. It does not rewrite the files again.
- **Third-party code.** No affected source file is a vendored third-party work. Dependencies and the Inter font stay under their own licenses (below). Chili3D's bundled shell assets (web font, icon font, OCCT via `cpp/`) were removed with the shell and were not relicensed.

## Production dependency check

Render production is `vertex/` (web + API) and `python-service/` (manufacturing). Neither imports `packages/`, `cpp/`, or `plugins/`. The Python service was added 2026-06-08 as the OrthoCAD hybrid manufacturing pipeline. It is original Vertex code with a copied banner, so it is reheadered and kept. Deleting it would remove a production service that is not Chili3D-derived.

No production path was found to be Chili3D-derived. Work was not stopped.

## Summary

| Classification | Action | Files |
| --- | --- | ---: |
| Chili3D-derived code | deleted | 611 |
| Chili3D-derived code | replaced | 2 |
| original Vertex/OrthoCAD code | proprietary-header | 451 |
| substantially rewritten Vertex code | proprietary-header | 2 |
| **Total** |  | **1066** |

Proprietary banners written: 453.

## Third-party licenses that remain

These are dependencies or assets, not files in the table above. Versions follow the manifests. License names were checked against package metadata where installed.

| Component | Where | License |
| --- | --- | --- |
| React, React DOM, Three.js, three-mesh-bvh, Zustand, Zod, Radix UI, opentype.js, clsx, tailwind-merge, superjson, tRPC, TanStack Query, `@react-three/fiber`, `@react-three/drei`, `@supabase/supabase-js`, tsx | `vertex/package.json` | MIT |
| jszip | `vertex/package.json` | MIT OR GPL-3.0-or-later (used under MIT) |
| Prisma client, manifold-3d, class-variance-authority | `vertex/package.json` | Apache-2.0 |
| clipper2-ts | `vertex/package.json` | BSL-1.0 |
| `@kninnug/constrainautor`, delaunator, lucide-react | `vertex/package.json` | ISC |
| Inter | `vertex/public/fonts/OFL.txt` | SIL Open Font License 1.1 |
| FastAPI, Uvicorn, Pydantic, HTTPX, trimesh | `python-service/requirements.txt` | MIT |
| NumPy, SciPy, Shapely | `python-service/requirements.txt` | BSD |

The repository license file does not grant the Affero GPL or the Lesser GPL.

## Per-file table

| File | Classification | Action |
| --- | --- | --- |
| `AGENTS.md` | Chili3D-derived code | deleted |
| `Dockerfile` | Chili3D-derived code | deleted |
| `LICENSE` | Chili3D-derived code | replaced |
| `README.md` | Chili3D-derived code | replaced |
| `cpp/CMakeLists.txt` | Chili3D-derived code | deleted |
| `cpp/CMakePresets.json` | Chili3D-derived code | deleted |
| `cpp/LICENSE-chili-wasm.txt` | Chili3D-derived code | deleted |
| `cpp/README.md` | Chili3D-derived code | deleted |
| `cpp/src/converter.cpp` | Chili3D-derived code | deleted |
| `cpp/src/factory.cpp` | Chili3D-derived code | deleted |
| `cpp/src/geometry.cpp` | Chili3D-derived code | deleted |
| `cpp/src/mesher.cpp` | Chili3D-derived code | deleted |
| `cpp/src/opencascade.cpp` | Chili3D-derived code | deleted |
| `cpp/src/shape.cpp` | Chili3D-derived code | deleted |
| `cpp/src/shared.cpp` | Chili3D-derived code | deleted |
| `cpp/src/shared.hpp` | Chili3D-derived code | deleted |
| `cpp/src/transient.cpp` | Chili3D-derived code | deleted |
| `cpp/src/utils.cpp` | Chili3D-derived code | deleted |
| `cpp/src/utils.hpp` | Chili3D-derived code | deleted |
| `cpp/test/index.html` | Chili3D-derived code | deleted |
| `docs/MCP_SETUP.md` | Chili3D-derived code | deleted |
| `packages/app/package.json` | Chili3D-derived code | deleted |
| `packages/app/src/application.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/arc.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/boolean.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/box.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/circle.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/cone.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/cylinder.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/ellipse.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/extrude.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/face.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/fuse.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/index.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/line.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/pipe.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/point.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/polygon.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/pyramid.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/rect.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/regularPolygon.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/revolve.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/sphere.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/sweep.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/utils/BendTypeConverter.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/utils/WireFilletBuilder.ts` | Chili3D-derived code | deleted |
| `packages/app/src/bodys/wire.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/application/index.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/application/newDocument.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/application/openDocument.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/application/performanceTest.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/application/saveDocument.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/application/toFile.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/application/toggleDynamicWorkplane.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/application/wechatGroup.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/boolean.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/arc.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/arc2point.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/arc3point.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/arcUtils.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/bezier.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/box.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/circle.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/cone.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/converter.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/copySubShape.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/curveProjection.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/cylinder.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/ellipse.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/extrude.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/group.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/index.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/line.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/loft.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/offset.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/pipe.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/point.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/polygon.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/pyramid.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/rect.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/regularPolygon.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/revolve.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/section.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/sphere.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/sweep.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/create/thickSolid.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/createActCommand.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/createCommand.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/delete.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/folder.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/importExport.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/index.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/measure/angle.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/measure/index.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/measure/length.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/measure/select.module.css` | Chili3D-derived code | deleted |
| `packages/app/src/commands/measure/select.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/array.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/break.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/brush.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/chamfer.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/explode.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/fillet.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/index.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/mirror.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/move.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/removeFeature.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/removeSubShapes.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/rotate.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/sew.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/simplify.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/split.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/transformedCommand.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/modify/trim.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/multistepCommand.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/redo.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/undo.ts` | Chili3D-derived code | deleted |
| `packages/app/src/commands/workingPlane.ts` | Chili3D-derived code | deleted |
| `packages/app/src/document.ts` | Chili3D-derived code | deleted |
| `packages/app/src/index.ts` | Chili3D-derived code | deleted |
| `packages/app/src/pluginManager.ts` | Chili3D-derived code | deleted |
| `packages/app/src/selection.ts` | Chili3D-derived code | deleted |
| `packages/app/src/services/commandService.ts` | Chili3D-derived code | deleted |
| `packages/app/src/services/hotkeyService.ts` | Chili3D-derived code | deleted |
| `packages/app/src/services/index.ts` | Chili3D-derived code | deleted |
| `packages/app/src/showPropertyEventHandler.ts` | Chili3D-derived code | deleted |
| `packages/app/src/utils.ts` | Chili3D-derived code | deleted |
| `packages/app/test/command.test.ts` | Chili3D-derived code | deleted |
| `packages/app/test/document.test.ts` | Chili3D-derived code | deleted |
| `packages/builder/package.json` | Chili3D-derived code | deleted |
| `packages/builder/src/appBuilder.ts` | Chili3D-derived code | deleted |
| `packages/builder/src/defaultDataExchange.ts` | Chili3D-derived code | deleted |
| `packages/builder/src/index.ts` | Chili3D-derived code | deleted |
| `packages/builder/src/ribbon.ts` | Chili3D-derived code | deleted |
| `packages/core/package.json` | Chili3D-derived code | deleted |
| `packages/core/src/application.ts` | Chili3D-derived code | deleted |
| `packages/core/src/command/command.ts` | Chili3D-derived code | deleted |
| `packages/core/src/command/commandData.ts` | Chili3D-derived code | deleted |
| `packages/core/src/command/commandKeys.ts` | Chili3D-derived code | deleted |
| `packages/core/src/command/commandStore.ts` | Chili3D-derived code | deleted |
| `packages/core/src/command/decorator.ts` | Chili3D-derived code | deleted |
| `packages/core/src/command/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/command/shortcutProfiles.ts` | Chili3D-derived code | deleted |
| `packages/core/src/config.ts` | Chili3D-derived code | deleted |
| `packages/core/src/constants.ts` | Chili3D-derived code | deleted |
| `packages/core/src/dataExchange.ts` | Chili3D-derived code | deleted |
| `packages/core/src/document.ts` | Chili3D-derived code | deleted |
| `packages/core/src/editor.ts` | Chili3D-derived code | deleted |
| `packages/core/src/eventHandlers/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/eventHandlers/nodeSelectionEventHandler.ts` | Chili3D-derived code | deleted |
| `packages/core/src/eventHandlers/selectionEventHandler.ts` | Chili3D-derived code | deleted |
| `packages/core/src/eventHandlers/shapeSelectionEventHandler.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/asyncController.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/binding.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/collection.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/comparers/NumberEqualityComparer.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/comparers/XYZEqualityComparer.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/comparers/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/converter.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/deepObserver.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/disposable.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/dto/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/equalityComparer.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/gc.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/history.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/id.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/lazy.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/linkedList.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/logger.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/messageType.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/objectStorage.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/observer.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/precision.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/pubsub.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/result.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/storage.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/transaction.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/utils/debounce.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/utils/download.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/utils/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/foundation/utils/readFileAsync.ts` | Chili3D-derived code | deleted |
| `packages/core/src/i18n/i18n.ts` | Chili3D-derived code | deleted |
| `packages/core/src/i18n/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/i18n/keys.ts` | Chili3D-derived code | deleted |
| `packages/core/src/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/material.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/boundingBox.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/line.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/lineSegment.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/mathUtils.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/matrix4.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/plane.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/planeAngle.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/quaternion.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/ray.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/xy.ts` | Chili3D-derived code | deleted |
| `packages/core/src/math/xyz.ts` | Chili3D-derived code | deleted |
| `packages/core/src/model/component.ts` | Chili3D-derived code | deleted |
| `packages/core/src/model/facebaseNode.ts` | Chili3D-derived code | deleted |
| `packages/core/src/model/folderNode.ts` | Chili3D-derived code | deleted |
| `packages/core/src/model/geometryNode.ts` | Chili3D-derived code | deleted |
| `packages/core/src/model/groupNode.ts` | Chili3D-derived code | deleted |
| `packages/core/src/model/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/model/meshNode.ts` | Chili3D-derived code | deleted |
| `packages/core/src/model/node.ts` | Chili3D-derived code | deleted |
| `packages/core/src/model/shapeNode.ts` | Chili3D-derived code | deleted |
| `packages/core/src/model/visualNode.ts` | Chili3D-derived code | deleted |
| `packages/core/src/modelManager.ts` | Chili3D-derived code | deleted |
| `packages/core/src/navigation.ts` | Chili3D-derived code | deleted |
| `packages/core/src/plugin/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/plugin/manager.ts` | Chili3D-derived code | deleted |
| `packages/core/src/plugin/manifest.ts` | Chili3D-derived code | deleted |
| `packages/core/src/plugin/plugin.ts` | Chili3D-derived code | deleted |
| `packages/core/src/property.ts` | Chili3D-derived code | deleted |
| `packages/core/src/selection.ts` | Chili3D-derived code | deleted |
| `packages/core/src/selectionFilter.ts` | Chili3D-derived code | deleted |
| `packages/core/src/serialize/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/serialize/serializer.ts` | Chili3D-derived code | deleted |
| `packages/core/src/service.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/curve.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/geometry.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/geometryUtils.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/lineType.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/meshData.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/shape.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/shapeConverter.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/shapeFactory.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/shapeType.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/stlWriter.ts` | Chili3D-derived code | deleted |
| `packages/core/src/shape/surface.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/dimension.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/handlers/angleSnapEventHandler.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/handlers/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/handlers/lengthSnapEventHandler.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/handlers/pointSnapEventHandler.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/handlers/snapEventHandler.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/snap.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/snaps/axisSnap.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/snaps/baseSnap.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/snaps/featurePointStrategy.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/snaps/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/snaps/objectSnap.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/snaps/planeSnap.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/snaps/pointOnCurveSnap.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/snaps/surfaceSnap.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/tracking/axis.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/tracking/axisTracking.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/tracking/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/tracking/objectTracking.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/tracking/trackingBase.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snap/tracking/trackingSnap.ts` | Chili3D-derived code | deleted |
| `packages/core/src/snapType.ts` | Chili3D-derived code | deleted |
| `packages/core/src/step/angleStep.ts` | Chili3D-derived code | deleted |
| `packages/core/src/step/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/step/lengthStep.ts` | Chili3D-derived code | deleted |
| `packages/core/src/step/pointStep.ts` | Chili3D-derived code | deleted |
| `packages/core/src/step/selectStep.ts` | Chili3D-derived code | deleted |
| `packages/core/src/step/step.ts` | Chili3D-derived code | deleted |
| `packages/core/src/ui/button.ts` | Chili3D-derived code | deleted |
| `packages/core/src/ui/combobox.ts` | Chili3D-derived code | deleted |
| `packages/core/src/ui/dialog.ts` | Chili3D-derived code | deleted |
| `packages/core/src/ui/floatPanel.ts` | Chili3D-derived code | deleted |
| `packages/core/src/ui/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/ui/ribbon.ts` | Chili3D-derived code | deleted |
| `packages/core/src/ui/window.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/act.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/cameraController.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/cursorType.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/detectedData.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/eventHandler.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/highlighter.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/index.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/meshExporter.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/meshUtils.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/textGenerator.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/view.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/viewGizmo.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/viewUtils.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/viewport.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/visual.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/visualContext.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/visualFactory.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/visualObject.ts` | Chili3D-derived code | deleted |
| `packages/core/src/visual/visualShape.ts` | Chili3D-derived code | deleted |
| `packages/core/test/act.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/application.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/asyncController.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/binding.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/boundingBox.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/collection.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/combobox.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/command.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/component.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/config.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/debounce.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/decorator.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/deepObserver.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/disposable.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/facebaseNode.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/gc.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/geometryNode.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/groupNode.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/history.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/i18n.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/id.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/lazy.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/line.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/linesegment.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/linkedList.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/localStorageMock.ts` | Chili3D-derived code | deleted |
| `packages/core/test/logger.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/material.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/mathUtils.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/matrix.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/meshData.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/meshUtils.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/modelManager.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/navigation.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/node.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/nodeList.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/objectStorage.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/observer.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/plane.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/planeAngle.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/precision.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/property.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/pubsub.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/quaternion.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/ray.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/result.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/selectionFilter.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/serializer.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/shapeNode.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/shapeType.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/snapType.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/stlWriter.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/task.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/testDocument.ts` | Chili3D-derived code | deleted |
| `packages/core/test/transaction.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/visual.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/visualNode.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/xy.test.ts` | Chili3D-derived code | deleted |
| `packages/core/test/xyz.test.ts` | Chili3D-derived code | deleted |
| `packages/element/package.json` | Chili3D-derived code | deleted |
| `packages/element/src/collection.ts` | Chili3D-derived code | deleted |
| `packages/element/src/converters/colorConverter.ts` | Chili3D-derived code | deleted |
| `packages/element/src/converters/index.ts` | Chili3D-derived code | deleted |
| `packages/element/src/converters/numberConverter.ts` | Chili3D-derived code | deleted |
| `packages/element/src/converters/stringConverter.ts` | Chili3D-derived code | deleted |
| `packages/element/src/converters/urlConverter.ts` | Chili3D-derived code | deleted |
| `packages/element/src/converters/xyzConverter.ts` | Chili3D-derived code | deleted |
| `packages/element/src/elements.ts` | Chili3D-derived code | deleted |
| `packages/element/src/expander/expander.module.css` | Chili3D-derived code | deleted |
| `packages/element/src/expander/expander.ts` | Chili3D-derived code | deleted |
| `packages/element/src/expander/index.ts` | Chili3D-derived code | deleted |
| `packages/element/src/htmlProps.ts` | Chili3D-derived code | deleted |
| `packages/element/src/index.ts` | Chili3D-derived code | deleted |
| `packages/element/src/radioGroup.module.css` | Chili3D-derived code | deleted |
| `packages/element/src/radioGroup.ts` | Chili3D-derived code | deleted |
| `packages/element/src/utils.ts` | Chili3D-derived code | deleted |
| `packages/element/test/collection.test.ts` | Chili3D-derived code | deleted |
| `packages/element/test/converter.test.ts` | Chili3D-derived code | deleted |
| `packages/element/test/expander.test.ts` | Chili3D-derived code | deleted |
| `packages/element/test/radioGroup.test.ts` | Chili3D-derived code | deleted |
| `packages/element/test/styleMock.js` | Chili3D-derived code | deleted |
| `packages/element/test/urlConverter.test.ts` | Chili3D-derived code | deleted |
| `packages/global.d.ts` | Chili3D-derived code | deleted |
| `packages/i18n/package.json` | Chili3D-derived code | deleted |
| `packages/i18n/src/en.ts` | Chili3D-derived code | deleted |
| `packages/i18n/src/index.ts` | Chili3D-derived code | deleted |
| `packages/i18n/src/pt-br.ts` | Chili3D-derived code | deleted |
| `packages/i18n/src/zh-cn.ts` | Chili3D-derived code | deleted |
| `packages/mcp/package.json` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/bridge.ts` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/demo-box.ts` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/demo-loop.ts` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/gen-cube.ts` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/live-bellcrank.ts` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/live-cube.ts` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/live-gear.ts` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/live-measure.ts` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/live-send.ts` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/live-stdio-send.ts` | Chili3D-derived code | deleted |
| `packages/mcp/scripts/stdio-check.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/bridge/controller.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/bridge/protocol.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/bridge/server.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/globals.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/headless.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/index.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/mcpServer.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/pipeline.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/program/interpreter.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/program/schema.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/render/png.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/render/preview.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/render/raster.ts` | Chili3D-derived code | deleted |
| `packages/mcp/src/server.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/bridge.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/fuse.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/headless.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/live-bridge.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/ops.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/png.test.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/program.test.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/program.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/raster.test.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/render.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/mcp/test/server.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/storage/package.json` | Chili3D-derived code | deleted |
| `packages/storage/src/index.ts` | Chili3D-derived code | deleted |
| `packages/storage/src/indexedDBStorage.ts` | Chili3D-derived code | deleted |
| `packages/three/package.json` | Chili3D-derived code | deleted |
| `packages/three/src/cameraController.ts` | Chili3D-derived code | deleted |
| `packages/three/src/constants.ts` | Chili3D-derived code | deleted |
| `packages/three/src/highlightable.ts` | Chili3D-derived code | deleted |
| `packages/three/src/index.ts` | Chili3D-derived code | deleted |
| `packages/three/src/materials.ts` | Chili3D-derived code | deleted |
| `packages/three/src/meshExporter.ts` | Chili3D-derived code | deleted |
| `packages/three/src/outlinePass.js` | Chili3D-derived code | deleted |
| `packages/three/src/texture_points.jpg` | Chili3D-derived code | deleted |
| `packages/three/src/threeGeometry.ts` | Chili3D-derived code | deleted |
| `packages/three/src/threeGeometryFactory.ts` | Chili3D-derived code | deleted |
| `packages/three/src/threeHelper.ts` | Chili3D-derived code | deleted |
| `packages/three/src/threeHighlighter.ts` | Chili3D-derived code | deleted |
| `packages/three/src/threeView.module.css` | Chili3D-derived code | deleted |
| `packages/three/src/threeView.ts` | Chili3D-derived code | deleted |
| `packages/three/src/threeViewEventHandler.ts` | Chili3D-derived code | deleted |
| `packages/three/src/threeVisual.ts` | Chili3D-derived code | deleted |
| `packages/three/src/threeVisualContext.ts` | Chili3D-derived code | deleted |
| `packages/three/src/threeVisualFactory.ts` | Chili3D-derived code | deleted |
| `packages/three/src/threeVisualObject.ts` | Chili3D-derived code | deleted |
| `packages/three/src/viewGizmo.ts` | Chili3D-derived code | deleted |
| `packages/three/test/cameraControls.ts` | Chili3D-derived code | deleted |
| `packages/three/test/testDocument.ts` | Chili3D-derived code | deleted |
| `packages/three/test/testEdge.ts` | Chili3D-derived code | deleted |
| `packages/three/test/testView.ts` | Chili3D-derived code | deleted |
| `packages/three/test/three.test.ts` | Chili3D-derived code | deleted |
| `packages/three/test/viewGizmo.ts` | Chili3D-derived code | deleted |
| `packages/ui/package.json` | Chili3D-derived code | deleted |
| `packages/ui/src/cursor/draw.cur` | Chili3D-derived code | deleted |
| `packages/ui/src/cursor/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/dialog.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/dialog.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/editor.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/editor.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/floatPanel.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/floatPanel.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/home/home.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/home/home.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/home/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/home/languageSelector.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/home/navigation3DSelector.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/home/themeSelector.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/mainWindow.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/mainWindow.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/okCancel.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/okCancel.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/permanent.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/permanent.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/project/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/project/projectView.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/project/projectView.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/project/toolBar.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/project/toolBar.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/project/tree/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/project/tree/tree.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/project/tree/tree.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/project/tree/treeItem.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/project/tree/treeItem.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/project/tree/treeItemGroup.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/project/tree/treeItemGroup.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/project/tree/treeModel.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/project/tree/treeModel.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/basicPropertyControl.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/check.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/colorPorperty.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/property/colorProperty.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/common.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/property/complexPropertyUtils.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/input.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/property/input.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/material/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/material/materialDataContent.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/material/materialEditor.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/property/material/materialEditor.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/materialProperty.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/property/materialProperty.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/matrixProperty.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/propertyBase.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/property/propertyBase.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/propertyView.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/property/propertyView.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/property/textureProperty.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/property/textureProperty.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/commandContext.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/commandContext.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/dropdownController.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbon.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbon.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonButton.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonButton.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonGroup.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonGroup.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonPulldownButton.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonPulldownButton.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonSplitButton.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonSplitButton.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonStack.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonStack.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonToggleButton.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/ribbon/ribbonToggleButton.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/statusbar/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/statusbar/snapConfig.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/statusbar/snapConfig.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/statusbar/statusbar.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/statusbar/statusbar.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/toast/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/toast/toast.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/toast/toast.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/flyout/flyout.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/flyout/flyout.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/flyout/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/flyout/input.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/flyout/input.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/flyout/tip.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/flyout/tip.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/index.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/layoutViewport.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/layoutViewport.ts` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/viewport.module.css` | Chili3D-derived code | deleted |
| `packages/ui/src/viewport/viewport.ts` | Chili3D-derived code | deleted |
| `packages/ui/test/utils.test.ts` | Chili3D-derived code | deleted |
| `packages/wasm/lib/chili-wasm.d.ts` | Chili3D-derived code | deleted |
| `packages/wasm/lib/chili-wasm.js` | Chili3D-derived code | deleted |
| `packages/wasm/lib/chili-wasm.wasm` | Chili3D-derived code | deleted |
| `packages/wasm/package.json` | Chili3D-derived code | deleted |
| `packages/wasm/src/converter.ts` | Chili3D-derived code | deleted |
| `packages/wasm/src/curve.ts` | Chili3D-derived code | deleted |
| `packages/wasm/src/factory.ts` | Chili3D-derived code | deleted |
| `packages/wasm/src/geometry.ts` | Chili3D-derived code | deleted |
| `packages/wasm/src/helper.ts` | Chili3D-derived code | deleted |
| `packages/wasm/src/index.ts` | Chili3D-derived code | deleted |
| `packages/wasm/src/shape.ts` | Chili3D-derived code | deleted |
| `packages/wasm/src/surface.ts` | Chili3D-derived code | deleted |
| `packages/wasm/src/wasm.ts` | Chili3D-derived code | deleted |
| `packages/wasm/test/box.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/wasm/test/stl.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/wasm/test/vertex-insole.wasm.test.ts` | Chili3D-derived code | deleted |
| `packages/web/package.json` | Chili3D-derived code | deleted |
| `packages/web/src/index.ts` | Chili3D-derived code | deleted |
| `packages/web/src/live.ts` | Chili3D-derived code | deleted |
| `packages/web/src/loading.ts` | Chili3D-derived code | deleted |
| `plugins/helloworld-js/.gitignore` | Chili3D-derived code | deleted |
| `plugins/helloworld-js/README.md` | Chili3D-derived code | deleted |
| `plugins/helloworld-js/icons/hello.svg` | Chili3D-derived code | deleted |
| `plugins/helloworld-js/importMap.json` | Chili3D-derived code | deleted |
| `plugins/helloworld-js/manifest.json` | Chili3D-derived code | deleted |
| `plugins/helloworld-js/package.json` | Chili3D-derived code | deleted |
| `plugins/helloworld-js/src/extension.js` | Chili3D-derived code | deleted |
| `plugins/helloworld-js/src/module1.js` | Chili3D-derived code | deleted |
| `plugins/helloworld-js/src/module2.js` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/.gitignore` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/README.md` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/icons/hello.svg` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/importmap.json` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/manifest.json` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/package-lock.json` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/package.json` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/rspack.config.ts` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/src/commands/hello.ts` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/src/index.ts` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/src/modules/module1.ts` | Chili3D-derived code | deleted |
| `plugins/helloworld-ts/tsconfig.json` | Chili3D-derived code | deleted |
| `plugins/macro/icons/macro.svg` | Chili3D-derived code | deleted |
| `plugins/macro/manifest.json` | Chili3D-derived code | deleted |
| `plugins/macro/package-lock.json` | Chili3D-derived code | deleted |
| `plugins/macro/package.json` | Chili3D-derived code | deleted |
| `plugins/macro/rspack.config.ts` | Chili3D-derived code | deleted |
| `plugins/macro/src/commands/macro.ts` | Chili3D-derived code | deleted |
| `plugins/macro/src/css.d.ts` | Chili3D-derived code | deleted |
| `plugins/macro/src/index.ts` | Chili3D-derived code | deleted |
| `plugins/macro/src/macro/macro.module.css` | Chili3D-derived code | deleted |
| `plugins/macro/src/macro/macroEditor.ts` | Chili3D-derived code | deleted |
| `plugins/macro/src/macro/macroManager.ts` | Chili3D-derived code | deleted |
| `plugins/macro/src/macro/macroRunner.ts` | Chili3D-derived code | deleted |
| `plugins/macro/src/macro/macroStorage.ts` | Chili3D-derived code | deleted |
| `plugins/macro/tsconfig.json` | Chili3D-derived code | deleted |
| `plugins/scripts/package-plugin.mjs` | Chili3D-derived code | deleted |
| `public/favicon.svg` | Chili3D-derived code | deleted |
| `public/fonts/fzhei.json` | Chili3D-derived code | deleted |
| `public/iconfont.js` | Chili3D-derived code | deleted |
| `public/images/wechat.jpg` | Chili3D-derived code | deleted |
| `public/index.css` | Chili3D-derived code | deleted |
| `public/index.html` | Chili3D-derived code | deleted |
| `public/plugins/plugins.json` | Chili3D-derived code | deleted |
| `rspack.config.ts` | Chili3D-derived code | deleted |
| `rstest-setup.ts` | Chili3D-derived code | deleted |
| `rstest.wasm.config.ts` | Chili3D-derived code | deleted |
| `screenshots/screenshot.png` | Chili3D-derived code | deleted |
| `scripts/add_copyright.mjs` | Chili3D-derived code | deleted |
| `scripts/common.mjs` | Chili3D-derived code | deleted |
| `scripts/generate_types.mjs` | Chili3D-derived code | deleted |
| `scripts/release.mjs` | Chili3D-derived code | deleted |
| `scripts/setup_wasm_deps.mjs` | Chili3D-derived code | deleted |
| `tsconfig.json` | Chili3D-derived code | deleted |
| `python-service/app/main.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/models/requests.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/models/responses.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/belt_stitch.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/belt_transformer.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/belt_wall_slice.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/gcode_metrology.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/geometry_utils.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/gyroid_infill.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/planar_mesh.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/presets.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/print_recipe.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/slicer.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/solid_generator.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/app/services/stl_loader.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/scripts/calibrate_gyroid_lut.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/test_e2e_real_base.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/test_print_recipe_gyroid.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/tests/test_a1_gyroid_fill_fraction.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/tests/test_belt_stitch.py` | original Vertex/OrthoCAD code | proprietary-header |
| `python-service/tests/test_belt_wall_slice.py` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/arch-dome-smoothness.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/arch-heel-blend.verify.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/arch-wall-falloff.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/bottom-pattern-cad-render.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/bottom-wall-rim-conformity.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/band.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/design-state.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/dialect.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/drop-cutter.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/errors.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/fixtures.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/helpers.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/placement.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/preview.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/profile.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/cnc/spiral.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/default-glb-native-thickness.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/dump-a2f7cc61-baselines.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/forefoot-display.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/forefoot-width.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/hardness-regions.gates.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/heel-cup-composition-order.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/heel-cup-composition-qa-console.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/heel-cup-depth.export-solid.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/heel-cup-depth.realmesh.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/heel-narrow-render.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/heel-narrow-wall-profile.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/heel-skive-kirby.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/helpers/load-production-default-glb.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/helpers/load-sample-top-glb.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/helpers/render-png.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/min-chord-bridge.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/procedural-wall-procedural-guard.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/procedural-wall-s0-parity.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/procedural-wall-s1-default-procedural.optional.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/procedural-wall-s1-parity.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/procedural-wall-style.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/rim-conformity-matrix.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/sidewall-smoothness.verify.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/sink-export.smoke.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/sink-fold-gate.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/sink-preview-gate.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/sink-viewport.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/split-elements-ui.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/synced-bottom-shell-field.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/text-marking-acceptance.optional.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/text-marking-acceptance.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/text-marking-wall-place.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/toprim-extraction.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/track5b-shape-finish-gates.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/two-pointer-walk-steering.phase3.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/wall-banding.verify.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `tests/width-position-group-laplacian.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/api/trpc/[[...trpc]].ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/scripts/assert-server-esm-boot.mjs` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/scripts/check-vertexslice-orca.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/scripts/cleanup-manufacturing-temp.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/scripts/verify-default-glb-manifold.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/context.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/admin-tenant-store.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/admin-tenant-store.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/dev-auth.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/dev-auth.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/ensure-user.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/env.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/glb-validation.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/glb-validation.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/grant-admin-tokens.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/grant-admin-tokens.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/manufacturing-client.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/manufacturing-stl-lifecycle.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/prisma.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/prisma.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/rate-limit.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/rate-limit.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/storage.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/lib/supabase-db.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/load-env.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/prisma-cli.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/routers/admin-access.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/routers/admin-tenants.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/routers/library.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/server/src/routers/stock.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/shared/admin/admin-domain.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/shared/admin/admin-domain.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/shared/print-recipe/hardness-class-table.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/shared/print-recipe/hardness-region.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/shared/print-recipe/hardness-to-infill-pct.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/shared/print-recipe/print-recipe.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/shared/print-recipe/print-recipe.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/ErrorBoundary.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/clinical/CaseOrderSummary.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/clinical/CaseSummaryBar.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/clinical/ClinicalStepRail.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/clinical/ConfirmDeleteDialog.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/layout/AccountMenu.test.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/layout/AccountMenu.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/layout/SessionRecoveryDialog.test.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/layout/SessionRecoveryDialog.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/layout/TopNav.test.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/ui/slider-field.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/BottomPatternEditTools.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/ElementHardnessPopup.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/ElementSurfaceMeshes.selection.test.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/ElementSurfaceMeshes.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/MeshEditTools.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/PrintLoftSplash.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/ScanMarkerPlacement.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/ScanMeshes.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/ScanPlaneSliceTool.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/ScanRotateTool.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/ScanTransformTool.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/SplitElementOverlays.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/TextPlacementGuide.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/TrimlineEditTools.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/Viewer3D.print-selection.test.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/viewer/element-markers-no-coin.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/admin/AdminApp.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/admin/AdminAuditPage.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/admin/AdminModals.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/admin/AdminTenantDetailPage.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/admin/AdminTenantsPage.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/admin/admin-client.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/admin/admin-client.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/admin/admin-nav.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/admin/admin-nav.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/admin/admin-ui.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/auth/session-profile.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/auth/session-profile.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/clinical/ActiveFootSideBar.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/clinical/ClinicalPrintStepPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/clinical/ClinicalScanStepPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/clinical/HardnessRegionList.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/clinical/HardnessStepPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/clinical/SplitSettingsPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/corrections/CorrectionsPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/corrections/skive-derived-display.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/corrections/skive-derived-display.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/elements/ElementHardnessSelector.test.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/elements/ElementHardnessSelector.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/elements/ElementScaleControls.test.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/elements/ElementScaleControls.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/elements/HardnessPicker.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/exports/CncMillingPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/exports/PrintingPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/exports/TextMarkingPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/exports/TextSummary.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/exports/export-user-message.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/exports/export-user-message.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/exports/procedural-wall-preview-controls.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/exports/text-guide-store.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/library/SaveCustomDialog.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/mill/MillOrbitCanvas.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/mill/MillStepPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/mill/MillTableView.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/mill/use-mill-workpieces.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/scans/ScanCleanupPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/scans/ScanImport.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/shape-finish/ClinicalPrintAdvancedShapeFinishSlot.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/shape-finish/ClinicalShapeFinishSlot.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/shape-finish/ShapeFinishPanel.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/shape-finish/ShapeFinishQcBlock.tsx` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/features/shape-finish/shape-finish-mount.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/hooks/useAuthBootstrap.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/hooks/useKeyboardShortcuts.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/hooks/useViewportMode.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/hooks/useViewportMode.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/clinical/active-foot-side.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/clinical/case-summary.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/clinical/case-summary.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/clinical/clinical-step-gates.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/clinical/clinical-step-gates.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/clinical/correction-presets.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/band.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/compose.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/contour.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/drop-cutter.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/envelope.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/export.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/gcode.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/heightmap.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/index.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/parse.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/placement.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/polygon.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/preview.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/profile.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/simulate.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/spiral.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/types.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/cnc/workpiece.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/dev-auth.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/arch-grind.shape-finish.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/arch-section.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/arch-skive.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/base-asset.side.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/base-asset.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/base-bounds.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/base-modifier.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/base-modifier.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/bottom-mesh-clean.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/bottom-mesh-clean.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/bridge-manifold.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/clinical-constraints.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/clinical-constraints.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/corrections-posting-wedge.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/custom-element-bounds.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/default-glb.integration.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/apply-elements.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/display-mesh.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/display-mesh.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/element-asset.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/height-grid.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/library-assets.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/library-element-visible.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/library-thumbs.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/no-flow-blend.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/orientation.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/sidecar-feather-notch.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/sizing.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-assets/types.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-geometry-key.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-scale.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-scale.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-visualization.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/element-visualization.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/elements.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/elements.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/export-geometry.routing.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/export-geometry.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/fit-arch-from-scan.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/fit-arch-from-scan.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/fit-scan-clinical-params.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/fit-scan-clinical-params.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/glb-rim-close.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/heel-cup-depth.verify.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/heel-cup-width.verify.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/heel-lift-taper.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/heel-lift.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/heel-skive.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/heel-skive.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/kabsch.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/kabsch.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/marker-frame.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/marker-frame.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/match-design-from-scan.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/match-design-from-scan.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/measure-foot-from-scan.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/measure-foot-from-scan.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/mesh-close.cap-diagonal.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/mesh-close.integration.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/mesh-close.parity.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/mesh-close.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/mesh-close.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/migrate-corrections.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/migrate-corrections.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/native-shell-thickness.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/operator-graph.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/orphan-detection.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/bezier-column.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/bezier-column.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/bottom-pattern.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/bottom-pattern.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/catalog.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/cdt-band.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/cdt-band.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/cdt-lib.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/curves.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/defaults.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/defaults.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/densify-stations.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/densify-stations.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/extract.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/faired-pattern.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/faired-pattern.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/height-xy.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/hermite.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/index.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/intersect.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/live-bottom-pattern.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/live-bottom-pattern.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/loft.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/measure.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/metrics.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/modifiers.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/modifiers.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/outline-clean.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/outline-clean.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/pattern-hygiene.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/pattern-hygiene.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/planform.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/plantar-cdt.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/plantar-cdt.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/posting-golden.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/preview-loft-queue.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/preview-loft-queue.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/preview-loft-ui.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/preview-loft-ui.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/preview-loft-worker.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/print-solid-compose.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/print-solid-compose.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/print-solid-correction-audit.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/print-solid-correction-audit.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/print-solid-parity.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/quad-grid.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/quad-grid.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/reconstruct-posting.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/reconstruct-sliver.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/reconstruct.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/ring-seam.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/ring-seam.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/sample-top-display.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/sample-top-display.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/sample-top-id.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/sample-top-preview.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/sample-top-preview.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/sha256.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/shipped-pattern.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/shipped-pattern.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/sole-uv.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/station-gates.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/station-gates.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/stations.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/stations.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/types.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/viewer-wall-flag.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/viewer-wall-flag.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/wall-spline.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/wall-spline.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/wall-style.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/wall-style.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/windows-trace-data.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/procedural-wall/windows-trace.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/registration.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-components.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-components.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-deviation.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-display.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-dorsal.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-landmark-suggest.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-manual-offset.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-marker-target.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-marker-target.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-pick-mesh.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-plane-slice.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-plane-slice.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-registration-phase2.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/scan-registration-wire.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/shape-finish-gates.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/shape-finish-modifiers.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/shape-finish-modifiers.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/shell-thickness-zonal.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/shell-thickness-zonal.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/shoe-size.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/shoe-size.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/shoe-width.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/shoe-width.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/sink.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/sink.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/stock-debug.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/stock-resolve-supabase.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/apply.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/boolean.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/bottom-engrave.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/constants.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/contours.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/cutter.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/errors.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/fit.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/fit.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/font.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/gates.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/hash.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/host-refine.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/index.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/place.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/qem-caps.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/quality.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/solid.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/soup-intersect.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/text-marking.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/types.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/text-marking/validate.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/thickness-datum-clearance.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/thickness-raise.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/track4-shared.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/trim-presets.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/trimline-mesh.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/trimline.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/trimline.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/viewport-side-layout.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/viewport-side-layout.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/wedge-topcount-diag.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/geometry/wedge.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/clip2.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/collect.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/export-3mf.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/fixtures.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/gcode-verify.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/hash.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/hash.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/index.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/manifold-runtime.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/mesh.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/pipeline.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/prism.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/report.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/resolve-bounds.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/resolve.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/split-overlay.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/hardness/validate.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/library/loaders-order.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/library/loaders.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/trpc-errors.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/lib/trpc-errors.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/base-bounds-store.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/base-outline-store.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/bottom-pattern-store.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/bottom-pattern-store.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/clinical-workflow-store.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/clinical-workflow-store.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/design-store.elements.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/design-store.stock-loading.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/issues-store.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/milling-profile-store.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/preview-loft-status-store.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/preview-loft-status-store.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/stores/scan-store.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/workers/procedural-wall.worker.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/tests/occt-dormant.test.ts` | original Vertex/OrthoCAD code | proprietary-header |
| `vertex/src/components/layout/KernelLoadingBanner.tsx` | substantially rewritten Vertex code | proprietary-header |
| `vertex/src/lib/geometry/geometry-kernel.ts` | substantially rewritten Vertex code | proprietary-header |
