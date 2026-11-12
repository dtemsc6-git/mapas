/* Pagina 2: controles Terra Draw sobre la region APEX MAPA-GL.
 * GeoJSON en WGS 84: longitud, latitud; sin transformacion del CRS.
 * Guardar persiste el lote mediante SAVE_MAP_FEATURES en la pagina 2.
 * 2026-11-11: Se cambia el proceso de validación.
 */
(function (window, apex) {
    
    "use strict";

    const regionId = "MAPA-GL";
    const coordinatePrecision = 9;
    const initializedMaps = new WeakSet();

    // Implementa TerraDrawSessionUndoRedoInterface. WaterGIS conserva sus botones
    // y atajos nativos; cada entrada incluye tambien los cambios en capas APEX.
    function createHistory(capture, restore, canEdit = () => true) {
        let draw, notify, current;
        const undo = [], redo = [];
        function emit(cause) {
            notify?.({ cause, stack: "session",
                undoStackSize: undo.length, redoStackSize: redo.length });
        }
        function replay(from, to, cause) {
            if (!canEdit() || !from.length || draw.getModeState() === "drawing") return false;
            const target = from[from.length - 1];
            restore(JSON.parse(JSON.stringify(target)));
            from.pop();
            to.push(current);
            current = target;
            emit(cause);
            return true;
        }
        return {
            register(options) { draw = options.draw; notify = options.onHistoryChange; },
            canUndo: () => canEdit() && undo.length > 0 && draw.getModeState() !== "drawing",
            canRedo: () => canEdit() && redo.length > 0 && draw.getModeState() !== "drawing",
            undoSize: () => undo.length,
            redoSize: () => redo.length,
            undo: () => replay(undo, redo, "undo"),
            redo: () => replay(redo, undo, "redo"),
            clearHistory() { undo.length = redo.length = 0; current = undefined; },
            commit() {
                if (draw.getModeState() === "drawing") return;
                const next = capture();
                if (current && JSON.stringify(current) !== JSON.stringify(next)) {
                    undo.push(current);
                    if (undo.length > 100) undo.shift();
                    redo.length = 0;
                }
                current = next;
                emit("push");
            }
        };
    }

    function initializeMap() {
        const region = apex.region(regionId);
        const map = region?.getMapObject?.();
        if (!map || initializedMaps.has(map)) return;

        const Control = window.MaplibreTerradrawControl?.MaplibreTerradrawControl;
        if (!Control) {
            apex.debug.error("No se cargo WaterGIS para la pagina 2.");
            return;
        }
        let saving = false;
        let pendingSave;
        let loadedFoId = String(apex.item("P2_TRAZADO_ID").getValue() || "");
        let saveButton;
        const history = createHistory(captureState, restoreState, () => !saving);
        // Extender onAdd (IControl) permite insertar Guardar en la misma barra
        // sin acceder a propiedades privadas del control WaterGIS.
        class Page2DrawControl extends Control {
            onAdd(mapObject) {
                const container = super.onAdd(mapObject);
                saveButton = window.document.createElement("button");
                saveButton.type = "button";
                saveButton.title = "Guardar cambios";
                saveButton.setAttribute("aria-label", "Guardar cambios");
                saveButton.className = "maplibregl-terradraw-add-control";
                if (!this.isExpanded) saveButton.classList.add("hidden");
                const icon = window.document.createElement("span");
                icon.className = "fa fa-save";
                icon.setAttribute("aria-hidden", "true");
                saveButton.appendChild(icon);
                saveButton.addEventListener("click", saveFeatures);
                container.appendChild(saveButton);
                return container;
            }
        }
        const control = new Page2DrawControl({
            adapterOptions: { coordinatePrecision },
            modes: ["render", "marker", "linestring", "select", "delete", "undo", "redo"],
            undoRedo: { sessionLevel: history },
            open: true
        });
        map.addControl(control, "top-left");
        initializedMaps.add(map);

        const draw = control.getTerraDrawInstance();
        const editing = new Map();
        // Conservar el GeoJSON terminado aunque ya no se renderice en Terra Draw.
        const completed = new Map();
        const originals = new Map();
        const selected = new Set();
        let synchronizing = false;
        let refreshGeneration = 0;

        function liveFeatures() {
            return draw.getSnapshot().filter(feature =>
                !feature.properties?.midPoint &&
                !feature.properties?.selectionPoint &&
                !feature.properties?.coordinatePoint &&
                !feature.properties?.snappingPoint);
        }

        function updateGeoJSON() {
            const live = liveFeatures();
            const importedIds = new Set([...editing.values()].flatMap(entry => entry.ids));
            const features = live.filter(feature => !importedIds.has(feature.id));
            const deletedRecordIds = [];
            for (const [key, entry] of originals) {
                const active = editing.get(key);
                const parts = active
                    ? active.ids.map(id => live.find(feature => feature.id === id)).filter(Boolean)
                    : completed.get(key);
                if (parts && !parts.length) {
                    deletedRecordIds.push(String(entry.original.id));
                    continue;
                }
                features.push({
                    ...entry.original,
                    geometry: parts ? geometryFor(entry, parts) : entry.original.geometry,
                    properties: { ...entry.original.properties,
                        apexRecordId: String(entry.original.id) }
                });
            }
            const collection = JSON.parse(JSON.stringify({
                type: "FeatureCollection",
                features,
                deletedRecordIds
            }));
            collection.features.forEach(feature => { delete feature.properties?.selected; });
            apex.item("P2_GEOJSON").setValue(JSON.stringify(collection), null, true);
        }

        function showSaveError(message) {
            apex.message.showErrors([{ type: "error", location: "page",
                message, unsafe: true }]);
        }

        function validateCollection(collection) {
            if (collection?.type !== "FeatureCollection" || !Array.isArray(collection.features) ||
                !Array.isArray(collection.deletedRecordIds)) {
                throw new Error("P2_GEOJSON debe contener una FeatureCollection valida.");
            }
            if (!collection.features.length && !collection.deletedRecordIds.length) {
                throw new Error("No hay elementos para guardar.");
            }
            if (collection.features.length + collection.deletedRecordIds.length > 10000) {
                throw new Error("El lote supera el limite de 10000 elementos.");
            }
            const records = new Set();
            collection.features.forEach((feature, index) => {
                const label = `El elemento ${index + 1}`;
                // Los registros APEX no necesitan declarar type: "Feature".
                if (!feature?.geometry || typeof feature.geometry.type !== "string") {
                    throw new Error(`${label} no tiene una geometria con type valido.`);
                }
                if (!["Point", "LineString", "MultiPoint", "MultiLineString"].includes(feature.geometry.type)) {
                    throw new Error(`${label} tiene un tipo de geometria no admitido.`);
                }
                const parts = geometryParts(feature.geometry);
                if (!parts.length) {
                    throw new Error(`${label} no contiene partes: revise el array coordinates.`);
                }
                parts.forEach((part, partIndex) => {
                    const partLabel = `${label}, parte ${partIndex + 1}`;
                    function checkPosition(position, positionIndex) {
                        const positionLabel = `${partLabel}, posicion ${positionIndex + 1}`;
                        if (!Array.isArray(position)) {
                            throw new Error(`${positionLabel}: las coordenadas deben ser un array.`);
                        }
                        if (![2, 3].includes(position.length)) {
                            throw new Error(`${positionLabel}: se requieren 2 o 3 coordenadas.`);
                        }
                        position.forEach((value, coordinateIndex) => {
                            if (!Number.isFinite(value)) {
                                throw new Error(`${positionLabel}, coordenada ${coordinateIndex + 1}: debe ser un numero finito, no texto ni null.`);
                            }
                        });
                        if (Math.abs(position[0]) > 180) {
                            throw new Error(`${positionLabel}: longitud fuera del rango -180 a 180.`);
                        }
                        if (Math.abs(position[1]) > 90) {
                            throw new Error(`${positionLabel}: latitud fuera del rango -90 a 90.`);
                        }
                    }
                    if (part.type === "Point") {
                        checkPosition(part.coordinates, 0);
                    } else {
                        if (!Array.isArray(part.coordinates)) {
                            throw new Error(`${partLabel}: las coordenadas de linea deben ser un array.`);
                        }
                        if (part.coordinates.length < 2) {
                            throw new Error(`${partLabel}: una linea requiere al menos dos posiciones.`);
                        }
                        part.coordinates.forEach(checkPosition);
                    }
                });
                const dimensions = new Set(parts.flatMap(part => part.type === "Point"
                    ? [part.coordinates.length] : part.coordinates.map(position => position.length)));
                if (dimensions.size !== 1) {
                    throw new Error(`El elemento ${index + 1} mezcla coordenadas 2D y 3D.`);
                }
                const recordId = feature.properties?.apexRecordId;
                if (recordId != null) {
                    if (!/^[0-9]+$/.test(String(recordId)) || records.has(String(recordId))) {
                        throw new Error("El lote contiene un ID de registro invalido o repetido.");
                    }
                    records.add(String(recordId));
                }
            });
            collection.deletedRecordIds.forEach(id => {
                if (!/^[0-9]+$/.test(String(id)) || records.has(String(id))) {
                    throw new Error("La lista de eliminaciones tiene IDs invalidos o repetidos.");
                }
                records.add(String(id));
            });
        }

        function saveFeatures() {
            if (saving) return;
            let foId, payload;
            try {
                foId = String(apex.item("P2_TRAZADO_ID").getValue() || "");
                if (!/^[0-9]+$/.test(foId) || foId !== loadedFoId) {
                    throw new Error("Seleccione un trazado y espere a que termine de cargar el mapa.");
                }
                if (draw.getModeState() === "drawing") {
                    throw new Error("Termine el dibujo antes de guardar.");
                }
                // Finalizar tambien la geometria que todavia esta seleccionada.
                refreshGeneration++;
                synchronizing = true;
                try { draw.setMode("render"); } finally { synchronizing = false; }
                for (const [key, entry] of editing) finishEntry(key, entry);
                selected.clear();
                updateGeoJSON();
                history.commit();
                payload = apex.item("P2_GEOJSON").getValue();
                validateCollection(JSON.parse(payload));
                if (payload.length > 5 * 1024 * 1024) {
                    throw new Error("El GeoJSON supera el limite de 5 242 880 caracteres.");
                }
            } catch (error) {
                showSaveError(error.message);
                return;
            }

            // Un reintento del mismo lote conserva su token para evitar duplicar INSERTs.
            if (!pendingSave || pendingSave.foId !== foId || pendingSave.payload !== payload) {
                pendingSave = { foId, payload,
                    token: window.crypto?.randomUUID?.() ||
                        `${Date.now()}-${Math.random().toString(36).slice(2)}` };
            }
            const foItem = apex.item("P2_TRAZADO_ID");
            const wasDisabled = foItem.isDisabled();
            const mapElement = region.element[0];
            const wasInert = mapElement.inert;
            function unlock() {
                saving = false;
                saveButton.disabled = false;
                mapElement.inert = wasInert;
                if (!wasDisabled) foItem.enable();
            }
            saving = true;
            saveButton.disabled = true;
            mapElement.inert = true;
            foItem.disable();
            apex.message.clearErrors();
            try {
                apex.server.process("SAVE_MAP_FEATURES", {
                    x01: foId,
                    x02: pendingSave.token,
                    // chunk/f01 evita truncar GeoJSON grandes en un item VARCHAR2.
                    f01: apex.server.chunk(payload),
                    pageItems: ["P2_TRAZADO_ID"]
                }, {
                    dataType: "json",
                    loadingIndicator: region.element,
                    success(data) {
                        if (!data?.success) {
                            showSaveError(data?.message || "No se pudieron guardar los elementos.");
                            return;
                        }
                        // La BD es ahora la referencia: retirar dibujos guardados para no duplicarlos.
                        synchronizing = true;
                        try {
                            draw.setMode("render");
                            const ids = liveFeatures().map(feature => feature.id);
                            if (ids.length) draw.removeFeatures(ids);
                            editing.clear();
                            completed.clear();
                            originals.clear();
                            selected.clear();
                            draw.clearUndoRedoHistory();
                        } finally { synchronizing = false; }
                        pendingSave = undefined;
                        updateGeoJSON();
                        history.commit();
                        const counts = ["inserted", "updated", "deleted"].map(key => Number(data[key]) || 0);
                        apex.message.showPageSuccess(
                            `Guardado: ${counts[0]} nuevos, ${counts[1]} actualizados, ` +
                            `${counts[2]} eliminados.`);
                        region.refresh();
                    },
                    error() {
                        showSaveError("No se pudo confirmar el guardado. Puede reintentar el mismo lote.");
                    }
                }).always(unlock);
            } catch (error) {
                unlock();
                showSaveError("No se pudo enviar la peticion de guardado.");
            }
        }

        function validPosition(position) {
            return Array.isArray(position) && [2, 3].includes(position.length) &&
                position.every(Number.isFinite) &&
                Math.abs(position[0]) <= 180 && Math.abs(position[1]) <= 90;
        }

        function editableCoordinates(coordinates) {
            return coordinates.map(value => Array.isArray(value)
                ? editableCoordinates(value)
                : Number(value.toFixed(coordinatePrecision)));
        }

        function geometryParts(geometry) {
            if (!geometry || typeof geometry.type !== "string") return [];
            const type = geometry.type.replace(/^Multi/, "");
            if (!["Point", "LineString"].includes(type)) return [];
            const coordinates = geometry.type.startsWith("Multi")
                ? geometry.coordinates : [geometry.coordinates];
            if (!Array.isArray(coordinates)) return [];
            return coordinates.map(part => ({ type, coordinates: part }));
        }

        function geometryFor(entry, parts) {
            return entry.original.geometry.type.startsWith("Multi")
                ? { type: entry.original.geometry.type,
                    coordinates: parts.map(part => part.geometry.coordinates) }
                : parts[0].geometry;
        }

        function captureState() {
            const live = liveFeatures();
            const importedIds = new Set([...editing.values()].flatMap(entry => entry.ids));
            const changes = [];
            for (const [key, entry] of originals) {
                const active = editing.get(key);
                const parts = active
                    ? active.ids.map(id => live.find(feature => feature.id === id)).filter(Boolean)
                    : completed.get(key);
                if (!parts) continue;
                const geometry = parts.length ? geometryFor(entry, parts) : null;
                // Seleccionar o devolver una geometria a APEX no constituye un cambio.
                if (!geometry || geometry.type !== entry.baseline.type ||
                    JSON.stringify(geometry.coordinates) !== JSON.stringify(entry.baseline.coordinates)) {
                    changes.push([key, parts]);
                }
            }
            const state = {
                features: live.filter(feature => !importedIds.has(feature.id)),
                changes: changes.sort(([a], [b]) => a.localeCompare(b))
            };
            const copy = JSON.parse(JSON.stringify(state));
            for (const feature of [...copy.features, ...copy.changes.flatMap(([, parts]) => parts)]) {
                delete feature.properties.selected;
            }
            // Al reabrir una geometria APEX, TerraDraw asigna otros IDs temporales.
            for (const [, parts] of copy.changes) parts.forEach(feature => { delete feature.id; });
            copy.features.sort((a, b) => String(a.id).localeCompare(String(b.id)));
            return copy;
        }

        function restoreState(state) {
            refreshGeneration++; // Cancelar selecciones/finalizaciones pendientes.
            synchronizing = true;
            try {
                draw.setMode("render");
                const ids = liveFeatures().map(feature => feature.id);
                if (ids.length) draw.removeFeatures(ids);
                editing.clear();
                selected.clear();
                completed.clear();
                const changes = new Map(state.changes);
                for (const [key, entry] of originals) {
                    if (region.getFeature(entry.layerId, entry.original.id)) {
                        region.removeFeature(entry.layerId, entry.original.id);
                    }
                    const parts = changes.get(key);
                    if (!parts) {
                        region.addFeature(entry.layerId, entry.original);
                    } else {
                        completed.set(key, parts);
                        if (parts.length) {
                            region.addFeature(entry.layerId, {
                                ...entry.original, geometry: geometryFor(entry, parts)
                            });
                        }
                    }
                }
                const results = draw.addFeatures(state.features);
                if (results.some(result => !result.valid)) {
                    throw new Error("TerraDraw rechazo una geometria del historial");
                }
            } finally {
                synchronizing = false;
                updateGeoJSON();
            }
        }

        function finishEntry(key, entry) {
            const features = new Map(liveFeatures().map(feature => [feature.id, feature]));
            const parts = entry.ids.map(id => features.get(id)).filter(Boolean);
            synchronizing = true;
            try {
                if (parts.length) {
                    const geometry = entry.original.geometry.type.startsWith("Multi")
                        ? { type: entry.original.geometry.type,
                            coordinates: parts.map(part => part.geometry.coordinates) }
                        : parts[0].geometry;
                    // El original se retiro al comenzar: agregarlo ahora con su geometria final.
                    region.addFeature(entry.layerId, { ...entry.original, geometry });
                    completed.set(key, JSON.parse(JSON.stringify(parts)));
                } else {
                    // Eliminar en Terra Draw mantiene el elemento fuera de la capa APEX.
                    completed.set(key, []); // Conservar la eliminacion para poder deshacerla.
                }
                editing.delete(key);
                entry.ids.forEach(id => selected.delete(id));
                draw.removeFeatures(entry.ids.filter(id => features.has(id)));
            } finally {
                synchronizing = false;
            }
        }

        function finishUnselected() {
            const existing = new Set(liveFeatures().map(feature => feature.id));
            for (const [key, entry] of editing) {
                if (entry.pendingSelection) continue;
                if (!entry.ids.some(id => selected.has(id) && existing.has(id))) {
                    finishEntry(key, entry);
                }
            }
            updateGeoJSON();
        }

        // La deseleccion puede ir seguida de la seleccion de otra parte de una MultiLineString.
        function deferFinish(recordChange = false) {
            const generation = refreshGeneration;
            window.setTimeout(() => {
                if (generation === refreshGeneration) {
                    finishUnselected();
                    if (recordChange) history.commit();
                }
            }, 0);
        }

        region.on("spatialmapobjectclick.page2", (event, data) => {
            if (saving || data?.id == null || !["render", "select"].includes(draw.getMode())) return;
            for (const name of ["MapaTrazados", "Puntos"]) {
                const layerId = region.getLayerIdByName(name);
                const original = region.getFeature(layerId, String(data.id));
                const parts = geometryParts(original?.geometry);
                if (!parts.length) continue;
                // Ambas capas usan la misma tabla; editar desde la capa que realmente lo dibuja.
                if (name === "MapaTrazados" && parts[0].type !== "LineString") continue;
                if (name === "Puntos" && parts[0].type !== "Point") continue;
                if (!parts.every(part => part.type === "Point"
                    ? validPosition(part.coordinates)
                    : Array.isArray(part.coordinates) && part.coordinates.length >= 2 &&
                        part.coordinates.every(validPosition))) {
                    apex.debug.warn("Geometria no editable: coordenadas invalidas", data.id);
                    return;
                }

                // El identificador de capa evita colisiones entre registros de distintas capas.
                const key = `${layerId}:${data.id}`;
                if (editing.has(key)) return;
                const entry = {
                    layerId,
                    original: JSON.parse(JSON.stringify(original)),
                    ids: [],
                    pendingSelection: true
                };
                entry.original.id = original.id ?? String(data.id);
                const features = parts.map((part, index) => ({
                    type: "Feature",
                    geometry: {
                        type: part.type,
                        coordinates: editableCoordinates(part.coordinates)
                    },
                    properties: {
                        mode: part.type === "Point" ? "marker" : "linestring",
                        apexRecordId: String(data.id),
                        apexLayerName: name,
                        apexPartIndex: index,
                        apexGeometryType: original.geometry.type
                    }
                }));

                synchronizing = true;
                try {
                    const results = draw.addFeatures(features);
                    entry.ids = results.filter(result => result.valid).map(result => result.id);
                    if (results.some(result => !result.valid)) {
                        draw.removeFeatures(entry.ids);
                        apex.debug.warn("Terra Draw rechazo la geometria", results);
                        return;
                    }
                    // Ocultar solo este elemento, manteniendo las demas geometrias y capas.
                    region.removeFeature(layerId, entry.original.id);
                    editing.set(key, entry);
                    if (!originals.has(key)) {
                        originals.set(key, {
                            layerId,
                            original: JSON.parse(JSON.stringify(entry.original)),
                            baseline: {
                                ...entry.original.geometry,
                                coordinates: editableCoordinates(entry.original.geometry.coordinates)
                            }
                        });
                    }
                    completed.delete(key);
                } catch (error) {
                    draw.removeFeatures(entry.ids);
                    if (!region.getFeature(layerId, entry.original.id)) {
                        region.addFeature(layerId, entry.original);
                    }
                    apex.debug.error("No se pudo iniciar la edicion", error);
                    return;
                } finally {
                    synchronizing = false;
                }

                // El mismo clic tambien lo recibe Terra Draw: seleccionar al terminar el evento.
                const generation = refreshGeneration;
                window.setTimeout(() => {
                    if (generation !== refreshGeneration || !editing.has(key)) return;
                    entry.pendingSelection = false;
                    draw.setMode("select");
                    const existing = new Set(liveFeatures().map(feature => feature.id));
                    const firstId = entry.ids.find(id => existing.has(id));
                    if (firstId != null) draw.selectFeature(firstId);
                    else finishEntry(key, entry);
                    updateGeoJSON();
                }, 0);
                return;
            }
        });

        draw.on("select", id => {
            if (synchronizing) return;
            selected.clear();
            selected.add(id);
            deferFinish();
        });
        draw.on("deselect", () => {
            if (synchronizing) return;
            selected.clear();
            deferFinish();
        });
        draw.on("change", (ids, type) => {
            if (synchronizing) return;
            // Durante el arrastre se actualiza el JSON, sin volver a mostrar el original.
            updateGeoJSON();
            deferFinish(type === "delete");
        });
        draw.on("finish", () => {
            if (!synchronizing) {
                updateGeoJSON();
                history.commit();
            }
        });

        region.element.on("apexbeforerefresh.page2", () => {
            refreshGeneration++;
            // Restaurar la representacion por si el refresco falla; la consulta recargara la BD.
            for (const [key, entry] of editing) finishEntry(key, entry);
            completed.clear();
            originals.clear();
            selected.clear();
            draw.clearUndoRedoHistory();
            history.commit();
            updateGeoJSON();
        });
        history.commit();
        region.element.on("apexafterrefresh.page2", () => {
            loadedFoId = String(apex.item("P2_TRAZADO_ID").getValue() || "");
            synchronizing = true;
            try {
                draw.setMode("render");
            } finally {
                synchronizing = false;
            }
            updateGeoJSON();
        });
        window.page2.save = saveFeatures;
    }

    function init() {
        apex.jQuery(document)
            .off("spatialmapinitialized.page2", "#" + regionId)
            .on("spatialmapinitialized.page2", "#" + regionId, initializeMap);
        initializeMap();
    }

    window.page2 = { init };
})(window, apex);
