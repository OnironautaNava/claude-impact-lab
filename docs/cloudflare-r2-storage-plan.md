# Plan de almacenamiento en Cloudflare R2

## Objetivo

Mover la data local a Cloudflare R2 para poder acceder a ella desde cualquier equipo, con una estructura simple, barata y preparada para crecer hasta al menos 1 GB.

La organizacion contemplada es:

- `raw-data/`
- `processed-data/`
- `backup/`

---

## Por que Cloudflare R2

Para este caso, Cloudflare R2 es la opcion con mejor costo-beneficio porque:

- la data es pequena y estatica
- no necesitas una base de datos real, sino almacenamiento de archivos
- puedes acceder desde cualquier equipo usando API compatible con S3
- evita el sobrecosto y complejidad de usar una plataforma mas grande solo para guardar archivos

---

## Arquitectura recomendada

Usar **un bucket** con un prefijo raiz del dataset y tres subprefijos operativos:

```text
smart-commute-sim-data/
  data_CDMX/
    raw-data/
    processed-data/
    backup/
```

### Por que un solo bucket

- mas simple de administrar
- suficiente para el volumen actual
- mas facil de automatizar
- si luego crece el proyecto, siempre puedes separar en tres buckets

Nombre actual del bucket:

```text
smart-commute-sim-data
```

---

## Estructura sugerida

```text
smart-commute-sim-data/
  data_CDMX/
    raw-data/source-a/file1.csv
    raw-data/source-b/file2.parquet
    processed-data/model-v1/output.parquet
    backup/2026-04-20/raw-data.zip
```

Convenciones recomendadas:

- `raw-data/` contiene solo archivos originales
- `processed-data/` contiene datasets transformados o salidas intermedias/finales
- `backup/` contiene snapshots o exportaciones comprimidas con fecha

---

## Implementacion paso a paso

## Paso 1 - Crear cuenta y habilitar R2

1. Ingresar a Cloudflare.
2. Abrir el panel principal.
3. Ir a **R2 Object Storage**.
4. Activar el servicio si todavia no esta habilitado.

---

## Paso 2 - Crear el bucket principal

1. Hacer clic en **Create bucket**.
2. Crear el bucket con el nombre:

```text
smart-commute-sim-data
```

3. Confirmar la creacion.

No hace falta crear manualmente las carpetas. Los prefijos se generan automaticamente al subir archivos con esas rutas.

---

## Paso 3 - Definir la estructura local

Antes de subir nada, organizar localmente tus carpetas asi:

```text
D:\data_CDMX\
  raw-data/
  processed-data/
  backup/
```

Si ya tienes otra estructura, no hace falta mover todo ahora, pero SI conviene definir desde el inicio que carpeta local mapea a cada prefijo remoto.

Mapeo sugerido:

- carpeta local `D:\data_CDMX\raw-data\` -> `smart-commute-sim-data/data_CDMX/raw-data/`
- carpeta local `D:\data_CDMX\processed-data\` -> `smart-commute-sim-data/data_CDMX/processed-data/`
- carpeta local `D:\data_CDMX\backup\` -> `smart-commute-sim-data/data_CDMX/backup/`

---

## Paso 4 - Crear credenciales S3 para acceso programatico

1. Dentro de R2, ir a la seccion de API tokens o S3 credentials.
2. Crear una nueva credencial.
3. Guardar estos datos:

- `Access Key ID`
- `Secret Access Key`
- `S3 endpoint`

### Recomendacion importante

No guardar estas credenciales dentro del repositorio ni en archivos versionados.

Guardarlas en:

- variables de entorno
- administrador de contrasenas
- archivo local ignorado por git si realmente hace falta

---

## Paso 5 - Instalar rclone en cada equipo

`rclone` es la forma mas simple y estable de trabajar con Cloudflare R2 desde varias maquinas.

Nota operativa actual: el bucket ya contiene un prefijo raiz `data_CDMX/`. Ese prefijo debe mantenerse para no mezclar datasets ni romper la estructura remota existente.

Instalarlo desde la web oficial o con tu gestor de paquetes.

Verificar instalacion:

```bash
rclone version
```

---

## Paso 6 - Configurar un remote de rclone para R2

Ejecutar:

```bash
rclone config
```

Configurar un remote nuevo con estos criterios:

- nombre actual: `r2-smart-commute`
- tipo de storage: `s3`
- provider: `Cloudflare`
- endpoint: pegar el endpoint S3 de tu cuenta R2
- access key: pegar `Access Key ID`
- secret key: pegar `Secret Access Key`

En este proyecto, las credenciales estan limitadas al bucket `smart-commute-sim-data`, asi que NO siempre podras listar todos los buckets.

Cuando termine, validar el acceso contra el bucket permitido:

```bash
rclone lsd "r2-smart-commute:smart-commute-sim-data"
```

Si todo esta bien, deberias ver los prefijos remotos o al menos confirmar que el bucket responde sin error de configuracion.

---

## Paso 7 - Probar carga inicial sin riesgo

Antes de sincronizar, hacer una prueba con `copy`.

### Subir raw-data

```bash
rclone copy "D:\data_CDMX\raw-data" "r2-smart-commute:smart-commute-sim-data/data_CDMX/raw-data" --progress
```

### Subir processed-data

```bash
rclone copy "D:\data_CDMX\processed-data" "r2-smart-commute:smart-commute-sim-data/data_CDMX/processed-data" --progress
```

### Subir backup

```bash
rclone copy "D:\data_CDMX\backup" "r2-smart-commute:smart-commute-sim-data/data_CDMX/backup" --progress
```

### Por que usar copy primero

Porque `copy` NO borra archivos en destino. Eso evita desastres al principio.

---

## Paso 8 - Verificar que la data quedo bien subida

Listar el contenido remoto:

```bash
rclone ls "r2-smart-commute:smart-commute-sim-data/data_CDMX/raw-data"
rclone ls "r2-smart-commute:smart-commute-sim-data/data_CDMX/processed-data"
rclone ls "r2-smart-commute:smart-commute-sim-data/data_CDMX/backup"
```

Tambien puedes revisar desde el panel web de Cloudflare.

### Estado verificado hoy

- `rclone lsd "r2-smart-commute:smart-commute-sim-data/data_CDMX"` muestra `raw-data`, `processed-data` y `backup`
- `raw-data/` ya contiene los datasets operativos del proyecto
- `processed-data/` y `backup/` responden correctamente; hoy contienen archivos de placeholder (`README_processed-data.txt` y `README_backup.txt`)

---

## Paso 9 - Habilitar acceso desde otro equipo

En el segundo equipo:

1. Instalar `rclone`.
2. Ejecutar `rclone config`.
3. Crear el remote `r2-smart-commute` con el mismo endpoint de Cloudflare R2.
4. Usar credenciales con permiso sobre el bucket `smart-commute-sim-data`.
5. Probar lectura contra el bucket, no contra la lista global de buckets.

Comando de prueba:

```bash
rclone ls "r2-smart-commute:smart-commute-sim-data/data_CDMX/raw-data"
```

Si quieres un acceso mas seguro, crear credenciales distintas por equipo.

### Criterio para dar el Paso 9 por completado

Considera completado este paso en el segundo equipo si se cumplen estas dos validaciones:

```bash
rclone lsd "r2-smart-commute:smart-commute-sim-data"
rclone ls "r2-smart-commute:smart-commute-sim-data/data_CDMX/raw-data"
```

La primera valida acceso al bucket restringido. La segunda valida lectura real de datos.

### Estado actual de este proyecto

- el remote configurado es `r2-smart-commute`
- las credenciales actuales tienen alcance restringido al bucket `smart-commute-sim-data`
- la estructura remota observada hoy usa el prefijo raiz `data_CDMX/`
- por eso `rclone lsd r2-smart-commute:` puede devolver `AccessDenied` aunque el acceso al bucket funcione correctamente

---

## Paso 10 - Pasar de copy a sync cuando el flujo ya sea estable

Una vez que confirmes que la estructura y el flujo estan correctos, puedes usar `sync` para mantener origen y destino alineados.

Ejemplo:

```bash
rclone sync "D:\data_CDMX\raw-data" "r2-smart-commute:smart-commute-sim-data/data_CDMX/raw-data" --progress
```

### Advertencia critica

`sync` puede borrar en destino archivos que ya no existan en origen.

Por eso el orden correcto es:

1. empezar con `copy`
2. validar estructura y contenido
3. usar `sync` solo cuando ya tengas confianza en el proceso

### Recomendacion operativa para este proyecto

Empieza usando `sync` solo para `raw-data/`, porque es el prefijo que hoy tiene carga real y es el mas facil de validar.

`processed-data/` y `backup/` pueden seguir con `copy` hasta que definas una politica de generacion y retencion mas estable.

---

## Paso 11 - Definir estrategia de backups reales

No confundas almacenamiento con backup.

Aunque R2 sea confiable, igual conviene guardar snapshots fechados dentro de `backup/`.

Ejemplo:

```text
backup/2026-04-20/raw-data.zip
backup/2026-04-20/processed-data.zip
backup/2026-04-27/raw-data.zip
```

### Estrategia minima recomendada

- un backup semanal
- un backup mensual
- mantener varios puntos de restauracion

---

## Paso 12 - Convenciones de nombres

Usar nombres consistentes desde el inicio.

Ejemplos recomendados:

```text
raw-data/source-name/2026-04-20/dataset.csv
processed-data/pipeline-name/v1/output.parquet
backup/2026-04-20/raw-data.zip
```

### Regla clave

La carpeta `raw-data/` no deberia contener archivos modificados manualmente. Si transformas algo, debe ir a `processed-data/`.

---

## Paso 13 - Automatizar el flujo

Cuando el proceso manual ya funcione, automatizarlo.

Orden recomendado:

1. script de subida de `raw-data`
2. script de publicacion de `processed-data`
3. script de backup periodico

Esto puede correrse con:

- Task Scheduler en Windows
- cron en Linux/macOS
- GitHub Actions si luego centralizas el flujo en CI

---

## Paso 14 - Politica de permisos recomendada

Si el proyecto crece, separar permisos:

- un acceso de lectura/escritura para tu equipo principal
- un acceso de solo lectura para otros equipos
- un acceso dedicado para automatizaciones

Esto reduce el riesgo de borrados accidentales.

---

## Paso 15 - Checklist de implementacion

- [ ] Crear cuenta en Cloudflare
- [ ] Activar R2
- [ ] Crear bucket `smart-commute-sim-data`
- [ ] Crear credenciales S3
- [ ] Instalar `rclone`
- [ ] Configurar remote `r2-smart-commute`
- [ ] Subir `raw-data` con `copy`
- [ ] Subir `processed-data` con `copy`
- [ ] Subir `backup` con `copy`
- [ ] Validar acceso desde otro equipo
- [ ] Definir convencion de nombres
- [ ] Automatizar backups

---

## Costos esperados

Para 140 MB hoy y alrededor de 1 GB en el corto plazo, el costo sera muy bajo.

Lo importante en este escenario NO es optimizar centavos, sino elegir una arquitectura que sea:

- simple
- segura
- accesible desde cualquier equipo
- facil de automatizar despues

R2 cumple bien con eso.

---

## Recomendacion final

La mejor implementacion inicial para este proyecto es:

- Cloudflare R2
- un bucket llamado `smart-commute-sim-data`
- un prefijo raiz `data_CDMX/` con tres subprefijos: `raw-data/`, `processed-data/` y `backup/`
- `rclone` para acceder y sincronizar desde cualquier equipo usando el remote `r2-smart-commute`

Esa decision te da el mejor equilibrio entre simplicidad, costo y crecimiento futuro.

---

## Comandos de referencia rapida

### Validar acceso al bucket

```bash
rclone lsd "r2-smart-commute:smart-commute-sim-data"
```

### Subir raw-data

```bash
rclone copy "D:\data_CDMX\raw-data" "r2-smart-commute:smart-commute-sim-data/data_CDMX/raw-data" --progress
```

### Subir processed-data

```bash
rclone copy "D:\data_CDMX\processed-data" "r2-smart-commute:smart-commute-sim-data/data_CDMX/processed-data" --progress
```

### Subir backup

```bash
rclone copy "D:\data_CDMX\backup" "r2-smart-commute:smart-commute-sim-data/data_CDMX/backup" --progress
```

### Sincronizar raw-data

```bash
rclone sync "D:\data_CDMX\raw-data" "r2-smart-commute:smart-commute-sim-data/data_CDMX/raw-data" --progress
```

### Listar archivos remotos

```bash
rclone ls "r2-smart-commute:smart-commute-sim-data/data_CDMX/raw-data"
```
