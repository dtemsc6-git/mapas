/*
Funciones comunes de mapas 
*/
/*

*/


function encuadrarTrazado(regionId) {
    const region = apex.region(regionId);
    // Registrar antes del refresh y evitar manejadores duplicados.
    region.element.off("apexafterrefresh.encuadrarTrazado")
        .one("apexafterrefresh.encuadrarTrazado", function () {

            const bbox = region.mapData?.map?.bbox;
            const map = region.getMapObject();
            if (!map || !Array.isArray(bbox)) {
                console.log("no es array", bbox);
                return;
            }
            // Coordenadas WGS 84: longitud, latitud; sin transformacion.
            const coordinates = bbox.flat();
            if (coordinates.length !== 4 ||
                !coordinates.every(Number.isFinite)) {
                console.log("Las coordenadas");
                return;
            }
            const [west, south, east, north] = coordinates;
            if (west < -180 || east > 180 || west > east ||
                south < -90 || north > 90 || south > north) {
                console.log("Otra vez las coordenadas.");
                return;
            }
            map.fitBounds([[west, south], [east, north]], {
                padding: 40,
                maxZoom: 14,
                duration: 1000,
                bearing: map.getBearing()
            });
            
        })

}

/**
 * Analiza un GeoJSON o un array de coordenadas en busca de puntos duplicados o similares.
 * @param {Object|Array} geojson - Objeto GeoJSON (FeatureCollection, Feature, Geometry) o un Array de [x, y, z].
 * @param {number} tol - Tolerancia en grados (~0.000001 ≈ 0.1 metros; 0 para coincidencia exacta).
 * 
 * La idea ahora es partir una linea en lineas más manejables cuando la cantidad de vertices supere un cierto umbral
 * Supongamos 300 coordenadas por lineas, entonces generar nuevos features por cada linea adicional
 * Las propiedades se compartiran.
*/
function analizarCoordenadasDuplicadas(geojson, tol = 0.0005) {

    logEventToItem("analizarCoordenadasDuplicadas ", "Inicio");
    
    let coords = [];
    // Extract de coordenadas según el tipo de estructura GeoJSON
    if (Array.isArray(geojson)) {
        coords = geojson;
    } else if (geojson.type === 'FeatureCollection') {
       
        geojson.features.forEach(f => {
            if (f.geometry && f.geometry.coordinates) {
                coords = coords.concat(f.geometry.coordinates);
            }
        });
    } else if (geojson.type === 'Feature') {
        coords = geojson.geometry.coordinates;
    } else if (geojson.coordinates) {
        coords = geojson.coordinates;
    }

    console.log(`Total de puntos analizados: ${coords.length}`);
    logEventToItem("analizarCoordenadasDuplicadas ", `Total de puntos a analizar: ${coords.length}`);

    const indicesAEliminar = new Set();
    const duplicadosConsecutivos = [];
    const duplicadosGlobales = [];

    for (let i = 0; i < coords.length; i++) {
        const [x1, y1] = coords[i];
        // 1. Detección de duplicados CONSECUTIVOS (Punto A_i idéntico o muy cercano al Punto A_i+1)
        // Esto es lo que más corrompe las LineStrings en SDO_UTIL.FROM_GEOJSON
        if (i < coords.length - 1) {
            const [x2, y2] = coords[i + 1];
            const dist2D = Math.hypot(x1 - x2, y1 - y2);

            if (dist2D <= tol) {
                duplicadosConsecutivos.push({
                    indiceA: i,
                    indiceB: i + 1,
                    distanciaGrados: dist2D,
                    puntoA: coords[i],
                    puntoB: coords[i + 1],
                    esExacto: dist2D === 0
                });

            }
        }
        // 2. Detección de duplicados GLOBALES (El mismo punto repetido en cualquier otra parte del trazado)
        // Si el punto i ya fue marcado para eliminar omitir compararlo
        if (indicesAEliminar.has(i)) continue;
        for (let j = i + 1; j < coords.length; j++) {
            const [x2, y2] = coords[j];
            const dist2D = Math.hypot(x1 - x2, y1 - y2);

            if (dist2D <= tol && j !== i + 1) {
                duplicadosGlobales.push({
                    indiceOriginal: i,
                    indiceDuplicado: j,
                    distanciaGrados: dist2D,
                    punto: coords[i]
                });
                indicesAEliminar.add(j);
            }
        }
    }
    // Reporte en Consola
    console.group('--- RESULTADOS DEL ANÁLISIS ---');
    

    // Filtrar la lista original excluyendo los índices duplicados
    const coordsLimpias = coords.filter((_, index) => !indicesAEliminar.has(index));
    
    console.warn(`Puntos Duplicados/Similares CONSECUTIVOS: ${duplicadosConsecutivos.length}`);
    logEventToItem("analizarCoordenadasDuplicadas ", `RPuntos Duplicados/Similares CONSECUTIVOS: ${duplicadosConsecutivos.length}`);
    if (duplicadosConsecutivos.length > 0) {
        console.table(duplicadosConsecutivos);
    }

    console.warn(`Puntos Duplicados GLOBALES (Cruces/Lazos): ${duplicadosGlobales.length}`);
    if (duplicadosGlobales.length > 0) {
        console.table(duplicadosGlobales);
    }
    console.groupEnd();
    return coordsLimpias;
}

