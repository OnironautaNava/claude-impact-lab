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

## ETL multimodal (Metro + Metrobus)

Para cobertura completa de estaciones en ambos servicios, se agrego un ETL en Python que usa cartografia oficial KMZ:

```bash
npm run generate:multimodal
```

Entradas requeridas en `SMART_COMMUTE_DATA_DIR`:

- `stcmetro_kmz/STC_Metro_estaciones.kmz`
- `mb_kmz/Metrobus_estaciones.kmz`
- `afluenciastc_desglosado_03_2026.csv`
- `afluenciamb_desglosado_03_2026.csv`

Salidas generadas en `public/data/`:

- `multimodal-data.json` (dataset principal para frontend)
- `stations.json`
- `routes.json`
- `precomputed_impact.json`
- `etl-manifest.json`

Ajustes ETL documentados:

- Se parsea KMZ/KML y se extraen atributos desde `description` (tabla HTML embebida) para recuperar `NOMBRE` y `LINEA`.
- Metro: ridership por estacion desde STC (promedio ultimos 90 dias).
- Metrobus: el CSV disponible viene por linea, no por estacion; se distribuye afluencia promedio por linea entre sus estaciones como aproximacion operativa.
- Topologia de rutas: las estaciones se ordenan por `snapping` contra la geometria de linea oficial (KMZ de lineas), no por orden geografico simple.
- Se aplica un guardrail de distancia maxima entre estaciones consecutivas para evitar saltos espurios en lineas con ramales o geometria fragmentada.
- El frontend intenta cargar `multimodal-data.json` primero y cae a `mvp-data.json` como fallback.

Ajuste de grafo en frontend:

- La propagacion de impacto de red usa adyacencia multimodal (Metro + Metrobus) a partir de `metroNetwork.features`.
- Se pondera por modo de transporte y penaliza cambios de modo en saltos de propagacion para evitar sobreestimar impacto de segundo orden.

## Separar raw-data del repo

Para evitar que el editor y el tooling indexen datasets pesados dentro del workspace, mueve la carpeta cruda fuera del repo y apunta el ETL con una variable de entorno.

### Opcion recomendada (sin exportar variable cada vez)

Crea `smart-commute-cdmx/data-source.local` con la ruta absoluta del dataset:

```text
D:\data_CDMX
```

`data-source.local` ya queda ignorado por Git (`*.local`).

### Opcion temporal por terminal

#### PowerShell

```powershell
$env:SMART_COMMUTE_DATA_DIR = "D:\raw-data\smart-commute-cdmx"
npm run generate:data
```

### CMD

```bat
set SMART_COMMUTE_DATA_DIR=D:\raw-data\smart-commute-cdmx
npm run generate:data
```

### Compatibilidad

Prioridad de rutas del ETL:

1. `SMART_COMMUTE_DATA_DIR`
2. `data-source.local`
3. `../docs/data` (fallback para no romper flujo existente)

`docs/data/` esta ignorado por Git para que puedas mantener la data cruda de forma local sin ensuciar el repo.

### Archivos requeridos

- `afluenciastc_desglosado_03_2026.csv`
- `afluenciamb_desglosado_03_2026.csv`
- `cicloestaciones_ecobici.csv`
- `infraestructura-vial-ciclista.json`
