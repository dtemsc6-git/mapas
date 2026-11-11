/* Pagina 2: controles Terra Draw sobre la region APEX MAPA-GL.
 * GeoJSON en WGS 84: longitud, latitud; sin transformacion del CRS.
 * Los cambios son locales al navegador hasta implementar su persistencia.
 */
(function (window, apex) {
    
    "use strict";

    const regionId = "MAPA-GL";
    const coordinatePrecision = 9;
    const initializedMaps = new WeakSet();

    function initializeMap() {
        const region = apex.region(regionId);
        const map = region?.getMapObject?.();
        if (!map || initializedMaps.has(map)) return;

        const Control = window.MaplibreTerradrawControl?.MaplibreTerradrawControl;
        if (!Control) {
            apex.debug.error("No se cargo WaterGIS para la pagina 2.");
            return;
        }
        const control = new Control({
            adapterOptions: { coordinatePrecision },
            modes: ["render", "marker", "linestring", "select", "delete"],
            open: true
        });
        map.addControl(control, "top-left");
        initializedMaps.add(map);

        const draw = control.getTerraDrawInstance();
        const editing = new Map();
        // Conservar el GeoJSON terminado aunque ya no se renderice en Terra Draw.
        const completed = new Map();
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
            apex.item("P2_GEOJSON").setValue(JSON.stringify({
                type: "FeatureCollection",
                features: [...Array.from(completed.values()).flat(), ...liveFeatures()]
            }), null, true);
        }

        function validPosition(position) {
            return Array.isArray(position) && position.length >= 2 &&
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
                    completed.delete(key);
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
        function deferFinish() {
            const generation = refreshGeneration;
            window.setTimeout(() => {
                if (generation === refreshGeneration) finishUnselected();
            }, 0);
        }

        region.on("spatialmapobjectclick.page2", (event, data) => {
            if (data?.id == null || !["render", "select"].includes(draw.getMode())) return;
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
        draw.on("change", () => {
            if (synchronizing) return;
            // Durante el arrastre se actualiza el JSON, sin volver a mostrar el original.
            updateGeoJSON();
            deferFinish();
        });
        draw.on("finish", () => {
            if (!synchronizing) updateGeoJSON();
        });

        region.element.on("apexbeforerefresh.page2", () => {
            refreshGeneration++;
            // Restaurar la representacion por si el refresco falla; la consulta recargara la BD.
            for (const [key, entry] of editing) finishEntry(key, entry);
            completed.clear();
            selected.clear();
            updateGeoJSON();
        });
        region.element.on("apexafterrefresh.page2", () => {
            synchronizing = true;
            try {
                draw.setMode("render");
            } finally {
                synchronizing = false;
            }
            updateGeoJSON();
        });
    }

    function init() {
        apex.jQuery(document)
            .off("spatialmapinitialized.page2", "#" + regionId)
            .on("spatialmapinitialized.page2", "#" + regionId, initializeMap);
        initializeMap();
    }

    window.page2 = { init };
})(window, apex);
