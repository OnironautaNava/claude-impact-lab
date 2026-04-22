# Smart Commute CDMX

MVP frontend con `MapLibre + Vite` y un ETL local que genera `public/data/mvp-data.json`.

## Sprint 1 (ETL + contratos de salida)

Se agrego un generador de artefactos para el backlog del PRD (Sprint 1):

```bash
npm run generate:sprint1
```

Este comando genera en `public/data/`:

- `stations.json` (catalogo de estaciones para cierres)
- `routes.json` (tramos de red para visualizacion)
- `precomputed_impact.json` (lookup por estacion para impacto)
- `etl-manifest.json` (trazabilidad de fuentes detectadas)

Reglas de fuente:

1. Si encuentra GTFS (`stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt`) usa modo `gtfs`
2. Si no encuentra GTFS usa fallback desde `public/data/mvp-data.json` y marca `sourceMode=fallback`
3. Si encuentra AGEB (`ageb_urbanas.geojson`) y censo (`censo_2020_ageb.csv` o equivalentes), calcula poblacion por buffer de 800m usando centroides de AGEB

Nota: este sprint deja listo el contrato de datos y el pipeline incremental. El calculo AGEB actual es aproximado por centroides; la interseccion areal-weighted exacta queda para el siguiente incremento.

## ETL multimodal (Metro + Metrobus + Transportes Electricos)

Para cobertura completa de estaciones y contexto de demanda multimodal, se agrego un ETL en Python que usa GTFS oficial, cartografia SHP/KMZ y afluencia operativa:

```bash
npm run generate:multimodal
```

Entradas requeridas en `SMART_COMMUTE_DATA_DIR`:

- `raw-data/gtfs/gtfs_cdmx.zip`
- `stcmetro_kmz/STC_Metro_estaciones.kmz`
- `mb_kmz/Metrobus_estaciones.kmz`
- `afluenciastc_desglosado_03_2026.csv`
- `afluenciamb_desglosado_03_2026.csv`

Entradas opcionales ya integradas para Transportes Electricos:

- `raw-data/transportes-electricos/ste-trolebus/ridership/afluencia_desglosada_trolebus_03_2026.csv`
- `raw-data/transportes-electricos/cablebus/ridership/afluencia_desglosada_cb_03_2026.csv`
- `raw-data/transportes-electricos/tren-ligero/ridership/afluencia_desglosada_tl_03_2026.csv`
- `raw-data/transportes-electricos/cartography/` para KMZ compartidos de estaciones y lineas de los 3 subsistemas

Salidas generadas en `public/data/`:

- `multimodal-data.json` (dataset principal para frontend)
- `stations.json`
- `routes.json`
- `precomputed_impact.json`
- `etl-manifest.json`
- `network-diagnostics.json` (reporte tecnico de topologia y lineas sospechosas)

Ajustes ETL documentados:

- `GTFS` define variantes, secuencia y sentido por linea usando `routes.txt`, `trips.txt`, `stop_times.txt` y `shapes.txt`.
- `SHP` local se usa como fuente primaria de geometria/catalogo cuando existe; `KMZ` queda como fallback para no romper flujos existentes.
- Se parsea KMZ/KML y se extraen atributos desde `description` (tabla HTML embebida) para recuperar `NOMBRE` y `LINEA`.
- Metro: ridership por estacion desde STC (promedio ultimos 90 dias).
- Metrobus y Transportes Electricos: cuando la afluencia viene por linea, se distribuye el promedio por linea entre las estaciones cartografiadas como aproximacion operativa.
- Topologia de rutas: las estaciones se ordenan por `snapping` contra la geometria oficial, separando variantes por `RUTA`, `TRAMO` y `circuito` antes de conectar estaciones consecutivas.
- Se colapsan nodos duplicados cercanos dentro de la misma linea para evitar sobreconexiones por sentidos opuestos o paradas homonimas casi coincidentes.
- Se aplica un guardrail de distancia maxima entre estaciones consecutivas para evitar saltos espurios en lineas con ramales o geometria fragmentada.
- Si existe afluencia de Transportes Electricos pero aun no hay KMZ compartido, la demanda se incorpora al resumen del sistema y el manifest deja trazabilidad de la cobertura geoespacial faltante.
- El frontend intenta cargar `multimodal-data.json` primero y cae a `mvp-data.json` como fallback.

Dependencias Python del ETL:

```bash
python -m pip install -r requirements.txt
```

Reporte complementario:

- `NETWORK_TOPOLOGY_REPORT.md` resume el diagnostico humano de las lineas mas sospechosas despues de aplicar la correccion.

Ajuste de grafo en frontend:

- La propagacion de impacto de red usa adyacencia multimodal (Metro + Metrobus) a partir de `metroNetwork.features`.
- Se pondera por modo de transporte y penaliza cambios de modo en saltos de propagacion para evitar sobreestimar impacto de segundo orden.

## Separar raw-data del repo

Para evitar que el editor y el tooling indexen datasets pesados dentro del workspace, mueve la carpeta cruda fuera del repo y apunta el ETL con una variable de entorno.

Estructura recomendada del dataset externo (por sistema de transporte):

```text
D:\data_CDMX\
└─ raw-data\
   ├─ stc-metro\
   │  ├─ ridership\afluenciastc_desglosado_03_2026.csv
   │  ├─ cartography\kmz\STC_Metro_estaciones.kmz
   │  ├─ cartography\kmz\STC_Metro_lineas.kmz
   │  └─ gtfs\(opcional: stops.txt, routes.txt, trips.txt, stop_times.txt)
   ├─ metrobus\
   │  ├─ ridership\afluenciamb_desglosado_03_2026.csv
   │  ├─ cartography\kmz\Metrobus_estaciones.kmz
   │  └─ cartography\kmz\Metrobus_lineas.kmz
   ├─ transportes-electricos\
   │  ├─ ste-trolebus\ridership\afluencia_desglosada_trolebus_03_2026.csv
   │  ├─ cablebus\ridership\afluencia_desglosada_cb_03_2026.csv
   │  ├─ tren-ligero\ridership\afluencia_desglosada_tl_03_2026.csv
   │  └─ cartography\(KMZ compartidos de estaciones y lineas para los 3 subsistemas)
   ├─ ecobici\inventory\cicloestaciones_ecobici.csv
   ├─ cycling-infra\network\infraestructura-vial-ciclista.json
   └─ urban-context\ageb\(opcional: ageb_urbanas.geojson + censo_2020_ageb.csv)
```

Compatibilidad: los scripts siguen soportando la estructura plana anterior para no romper flujos existentes.

### Opcion recomendada (sin exportar variable cada vez)

Crea `smart-commute-cdmx/data-source.local` con la ruta absoluta del dataset:

```text
D:\data_CDMX
```

`data-source.local` ya queda ignorado por Git (`*.local`).

### Opcion temporal por terminal

#### PowerShell

```powershell
$env:SMART_COMMUTE_DATA_DIR = "D:\data_CDMX"
npm run generate:data
```

### CMD

```bat
set SMART_COMMUTE_DATA_DIR=D:\data_CDMX
npm run generate:data
```

### Compatibilidad

Prioridad de rutas del ETL:

1. `SMART_COMMUTE_DATA_DIR`
2. `data-source.local`
3. `../docs/data` (fallback para no romper flujo existente)

`docs/data/` esta ignorado por Git para que puedas mantener la data cruda de forma local sin ensuciar el repo.

### Archivos requeridos

- `raw-data/stc-metro/ridership/afluenciastc_desglosado_03_2026.csv`
- `raw-data/metrobus/ridership/afluenciamb_desglosado_03_2026.csv`
- `raw-data/ecobici/inventory/cicloestaciones_ecobici.csv`
- `raw-data/cycling-infra/network/infraestructura-vial-ciclista.json`
