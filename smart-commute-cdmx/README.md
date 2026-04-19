# Smart Commute CDMX

MVP frontend con `MapLibre + Vite` y un ETL local que genera `public/data/mvp-data.json`.

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
