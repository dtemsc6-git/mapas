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