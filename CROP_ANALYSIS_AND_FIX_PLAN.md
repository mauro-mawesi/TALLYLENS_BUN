# Análisis de Problemas en el Crop de Imágenes

## Problemas Identificados

### 📊 Resultados del Análisis Visual

| Archivo | Original | Procesado | Problema Identificado |
|---------|----------|-----------|----------------------|
| `1759070441380-498987396.jpg` | ❌ Recibo JUMBO horizontal sobre mesa de madera | ❌ **COMPLETAMENTE ROTO** - Muestra ruido/texto corrupto | **CRÍTICO: Procesamiento fallido** |
| `1759154598361-269663310.jpg` | ✅ Recibo JUMBO vertical, buena calidad | ✅ Crop correcto, buen contraste | **OK** |
| `1759061498181-589436146.jpg` | ⚠️ Recibo JUMBO horizontal sobre mesa | ✅ Crop OK, rotado correctamente | **OK pero con textura de fondo** |
| `1759063603011-174833084.jpg` | ⚠️ Recibo JUMBO horizontal sobre mesa | ✅ Crop OK, pero mantiene mucha textura de madera | **Fondo excesivo** |
| `1759059587951-867176210.jpg` | ⚠️ Recibo JUMBO horizontal sobre mesa | ✅ Crop y rotación OK, demasiada textura | **Fondo excesivo** |
| `1759060514067-883874788.jpg` | ⚠️ Recibo JUMBO horizontal sobre mesa | ⚠️ Crop correcto pero parte superior cortada | **Crop muy agresivo arriba** |

## Análisis de Problemas

### 🔴 **Problema CRÍTICO #1: Imagen Completamente Corrupta**

**Archivo:** `1759070441380-498987396.jpg`

**Síntomas:**
- La imagen original es un recibo horizontal sobre una mesa
- La imagen procesada muestra un patrón completamente diferente (ruido + texto corrupto)
- Parece que el procesamiento generó una imagen desde datos corruptos o aplicó múltiples transformaciones que destruyeron la imagen

**Causa Probable:**
1. **Auto-rotación + Orientación EXIF incorrecta**: La imagen tiene metadatos EXIF de orientación pero Sharp los interpreta mal
2. **Sobel Edge Detection en imagen horizontal con fondo complejo**: El algoritmo Sobel detectó los bordes de la textura de madera en lugar del recibo
3. **Composición de Sobel X+Y generando ruido**: La combinación de ambos kernels en una imagen con mucha textura generó un patrón de interferencia
4. **Threshold muy alto cortando información**: El threshold de 120 eliminó el contenido real y dejó solo ruido

### 🟡 **Problema #2: Recibos Horizontales sobre Mesa**

**Archivos afectados:** Casi todos los recibos de JUMBO

**Síntomas:**
- Los recibos están fotografiados horizontalmente sobre una mesa de madera
- El fondo de madera tiene textura con líneas verticales muy marcadas
- El edge detection detecta las vetas de la madera como bordes
- El crop incluye mucha área de fondo innecesaria

**Causa:**
- El algoritmo Sobel detecta las vetas verticales de la madera como bordes fuertes
- El trim automático no funciona porque el recibo no tiene fondo blanco uniforme
- El threshold adaptativo no distingue entre bordes del recibo y textura del fondo

### 🟡 **Problema #3: Crop Demasiado Agresivo en Algunas Imágenes**

**Síntoma:**
- En `1759060514067-883874788.jpg` se cortó información de la parte superior
- El padding del 2% no es suficiente para compensar la detección imprecisa

**Causa:**
- El algoritmo de detección de límites encuentra el primer borde fuerte
- No valida si está cortando contenido importante
- No hay verificación de que todo el texto esté incluido

### 🟢 **Casos que Funcionan Bien**

**Archivo:** `1759154598361-269663310.jpg`

**Por qué funciona:**
- ✅ Recibo vertical (orientación correcta)
- ✅ Fondo más uniforme
- ✅ No tiene textura compleja alrededor
- ✅ El trim automático funciona correctamente

## Plan de Corrección

### 🎯 **Objetivo:**
Lograr que el 95% de las imágenes se procesen correctamente, priorizando:
1. **NO destruir imágenes** (evitar el caso crítico)
2. **Detectar recibos sobre fondos complejos** (mesa de madera)
3. **Rotar correctamente recibos horizontales**
4. **Crop conservador** (mejor incluir de más que cortar contenido)

---

## 🔧 Soluciones Propuestas

### **Solución 1: Detección de Orientación Mejorada**

#### Problema que resuelve:
- Recibos horizontales que necesitan rotación
- Imágenes con EXIF que confunde a Sharp

#### Implementación:

```javascript
/**
 * Detecta la orientación del recibo analizando aspect ratio y contenido
 */
async detectReceiptOrientation(imageBuffer) {
    const metadata = await sharp(imageBuffer).metadata();
    const aspectRatio = metadata.width / metadata.height;

    // Si width > height significativamente, probablemente está horizontal
    // Los recibos suelen ser verticales (aspect ratio < 1)
    if (aspectRatio > 1.5) {
        return { needsRotation: true, angle: 90 };
    }

    return { needsRotation: false, angle: 0 };
}
```

#### Flujo actualizado:

```
1. Ignorar EXIF completamente (autoRotate: false SIEMPRE)
2. Analizar aspect ratio de la imagen
3. Si width >> height → rotar 90° para hacer vertical
4. Proceder con edge detection
```

---

### **Solución 2: Pre-filtrado para Fondos Complejos**

#### Problema que resuelve:
- Textura de madera/superficie interfiere con edge detection
- Sobel detecta vetas de madera en lugar de bordes del recibo

#### Implementación:

```javascript
/**
 * Aplica filtro bilateral o blur gaussiano fuerte para reducir textura
 * antes de edge detection
 */
async preprocessForComplexBackground(imageBuffer) {
    // Aplicar blur fuerte para eliminar texturas de alta frecuencia
    // pero mantener bordes grandes (el recibo)
    const blurred = await sharp(imageBuffer)
        .grayscale()
        .blur(5) // Blur fuerte (antes: 1)
        .normalize()
        .modulate({ brightness: 1.2 })
        .toBuffer();

    return blurred;
}
```

#### Por qué funciona:
- Las vetas de madera son de alta frecuencia → se eliminan con blur
- Los bordes del recibo son de baja frecuencia → se mantienen
- Sobel ahora detecta solo el recibo, no el fondo

---

### **Solución 3: Validación de Crop Multi-etapa**

#### Problema que resuelve:
- Crops que cortan contenido importante
- Detección de bordes que falla completamente

#### Implementación:

```javascript
/**
 * Intenta múltiples estrategias y valida resultados
 */
async intelligentCrop(imageBuffer) {
    const results = [];

    // Strategy 1: Trim simple
    try {
        const trimmed = await this.trimWhitespace(imageBuffer);
        results.push({ method: 'trim', buffer: trimmed, score: this.scoreCrop(trimmed) });
    } catch (e) {}

    // Strategy 2: Edge detection con blur bajo
    try {
        const edgeLow = await this.edgeDetectionCrop(imageBuffer, { blurSigma: 2 });
        results.push({ method: 'edge-low', buffer: edgeLow, score: this.scoreCrop(edgeLow) });
    } catch (e) {}

    // Strategy 3: Edge detection con blur alto (fondos complejos)
    try {
        const edgeHigh = await this.edgeDetectionCrop(imageBuffer, { blurSigma: 8 });
        results.push({ method: 'edge-high', buffer: edgeHigh, score: this.scoreCrop(edgeHigh) });
    } catch (e) {}

    // Strategy 4: Conservative crop (10% margin)
    try {
        const conservative = await this.conservativeCrop(imageBuffer, 0.10);
        results.push({ method: 'conservative', buffer: conservative, score: this.scoreCrop(conservative) });
    } catch (e) {}

    // Elegir el mejor resultado
    results.sort((a, b) => b.score - a.score);
    return results[0].buffer;
}

/**
 * Puntúa la calidad del crop
 */
scoreCrop(imageBuffer) {
    const meta = await sharp(imageBuffer).metadata();
    const stats = await sharp(imageBuffer).stats();

    let score = 0;

    // Penalizar imágenes muy pequeñas o muy grandes
    const area = meta.width * meta.height;
    if (area < 200000) score -= 10; // Muy pequeño
    if (area > 2000000) score -= 5; // Muy grande

    // Premiar buen contraste
    const contrast = this.calculateContrast(stats);
    score += contrast * 50;

    // Premiar aspect ratio vertical (recibos típicos)
    const aspectRatio = meta.width / meta.height;
    if (aspectRatio > 0.3 && aspectRatio < 0.8) score += 20;

    // Penalizar si hay mucho blanco/negro (señal de corrupción)
    const brightness = this.calculateBrightness(stats);
    if (brightness < 0.1 || brightness > 0.95) score -= 20;

    return score;
}
```

---

### **Solución 4: Deshabilitar Auto-rotate EXIF**

#### Problema que resuelve:
- EXIF incorrecto en fotos de móviles
- Sharp rota dos veces (EXIF + nuestra rotación)

#### Implementación Simple:

```javascript
// En enhanceReceiptImage(), cambiar:
if (opts.autoRotate) {
    // REMOVER COMPLETAMENTE ESTE BLOQUE
}

// Y en todas las llamadas a Sharp:
sharp(imageBuffer, {
    failOnError: false,
    autoRotate: false // ← SIEMPRE false
})
```

---

### **Solución 5: Fallback Conservador Siempre Disponible**

#### Implementación:

```javascript
/**
 * Crop conservador que SIEMPRE funciona
 * Simplemente recorta un margen fijo del 5-10%
 */
async conservativeCrop(imageBuffer, marginPercent = 0.08) {
    const meta = await sharp(imageBuffer).metadata();

    const marginX = Math.floor(meta.width * marginPercent);
    const marginY = Math.floor(meta.height * marginPercent);

    return await sharp(imageBuffer)
        .extract({
            left: marginX,
            top: marginY,
            width: meta.width - (marginX * 2),
            height: meta.height - (marginY * 2)
        })
        .toBuffer();
}
```

#### Usar como último fallback:

```javascript
// Si TODOS los métodos fallan, usar conservative crop
if (!croppedBuffer) {
    log.warn('All crop methods failed, using conservative crop');
    croppedBuffer = await this.conservativeCrop(resized, 0.08);
}
```

---

### **Solución 6: Mejorar Sobel para Fondos Complejos**

#### Implementación:

```javascript
async edgeDetectionCrop(imageBuffer, options = {}) {
    const { blurSigma = 5 } = options; // Default más alto

    // Preprocesamiento MÁS agresivo
    const preprocessed = await sharp(imageBuffer)
        .grayscale()
        .blur(blurSigma) // ← Blur variable según contexto
        .normalize()
        .modulate({ brightness: 1.3, contrast: 1.2 }) // Más contraste
        .toBuffer();

    // Aplicar morfología (erosión/dilatación) antes de Sobel
    const morphed = await sharp(preprocessed)
        .median(5) // Eliminar ruido pequeño
        .toBuffer();

    // Sobel X + Y (sin cambios)
    // ...

    // Threshold MÁS BAJO para no perder información
    .threshold(80) // Antes: 120
}
```

---

## 📋 Plan de Implementación Priorizado

### **Fase 1: Fixes Críticos (Evitar corrupción)** 🔴

**Prioridad: CRÍTICA**

1. ✅ **Deshabilitar auto-rotate EXIF completamente**
   - Cambiar `autoRotate: false` en todas las llamadas a Sharp
   - Remover el bloque de auto-rotación en `enhanceReceiptImage()`
   - Testing: Verificar que `1759070441380-498987396.jpg` no se corrompa

2. ✅ **Reducir threshold de Sobel**
   - De 120 → 80
   - Evita perder información en el threshold

3. ✅ **Aumentar blur en preprocesamiento**
   - De `blur(1)` → `blur(5)`
   - Elimina texturas de fondo complejas

**Tiempo estimado:** 30 minutos
**Archivos a modificar:** `imageEnhancementService.js`

---

### **Fase 2: Detección de Orientación** 🟡

**Prioridad: ALTA**

4. ✅ **Implementar `detectReceiptOrientation()`**
   - Analiza aspect ratio
   - Rota 90° si width > 1.5 * height
   - Testing: Verificar con recibos horizontales

**Tiempo estimado:** 45 minutos
**Archivos a modificar:** `imageEnhancementService.js`

---

### **Fase 3: Crop Inteligente Multi-estrategia** 🟢

**Prioridad: MEDIA**

5. ✅ **Implementar `intelligentCrop()` con scoring**
   - Intenta múltiples métodos
   - Puntúa cada resultado
   - Elige el mejor

6. ✅ **Implementar `conservativeCrop()` como fallback final**
   - Crop simple con margen del 8%
   - SIEMPRE funciona

**Tiempo estimado:** 1.5 horas
**Archivos a modificar:** `imageEnhancementService.js`

---

### **Fase 4: Testing y Ajustes** 🔵

**Prioridad: MEDIA**

7. ✅ **Crear script de validación visual**
   - Genera HTML con comparación lado a lado
   - Permite validar visualmente todos los crops

8. ✅ **Ajustar parámetros basándose en resultados**

**Tiempo estimado:** 1 hora
**Archivos nuevos:** `scripts/validate_crops.js`

---

## 🎬 Comandos para Implementar

### Paso 1: Backup de seguridad
```bash
cp /home/mauricio/projects/LAB/RECIBOS_APP/backend/src/services/imageEnhancementService.js /home/mauricio/projects/LAB/RECIBOS_APP/backend/src/services/imageEnhancementService.js.backup
```

### Paso 2: Aplicar fixes críticos (Fase 1)
```bash
# Ejecutar dentro del devcontainer después de las modificaciones
bun run dev
```

### Paso 3: Re-procesar recibos de prueba
```bash
# Dentro del devcontainer
bun run scripts/reprocess_all_receipts.js
```

### Paso 4: Validar resultados
```bash
# Comparar manualmente uploads/ vs tests/
# O crear script de validación HTML
```

---

## 🎯 Métricas de Éxito

| Métrica | Objetivo |
|---------|----------|
| Imágenes sin corrupción | 100% |
| Crops correctos (todo el texto visible) | 95% |
| Orientación correcta | 98% |
| Remoción de fondo excesivo | 80% |
| Tiempo de procesamiento | < 3 segundos por imagen |

---

## 🔄 Testing Plan

### Test 1: Caso Crítico (Corrupción)
```
Archivo: 1759070441380-498987396.jpg
Antes: ❌ Imagen corrupta/ruido
Después: ✅ Recibo legible (aunque sea horizontal)
```

### Test 2: Recibos Horizontales
```
Archivos: 1759061498181, 1759063603011, 1759059587951
Antes: ⚠️ Incluyen mucha madera
Después: ✅ Solo recibo con margen mínimo
```

### Test 3: Recibos Verticales
```
Archivo: 1759154598361-269663310.jpg
Antes: ✅ Ya funciona bien
Después: ✅ Debe seguir funcionando igual o mejor
```

### Test 4: Crop Agresivo
```
Archivo: 1759060514067-883874788.jpg
Antes: ⚠️ Parte superior cortada
Después: ✅ Todo el contenido visible
```

---

## 📊 Resumen Ejecutivo

### Problemas Principales:
1. 🔴 **1 imagen completamente corrupta** por auto-rotation + Sobel en fondo complejo
2. 🟡 **~80% de imágenes con fondo excesivo** (textura de madera)
3. 🟡 **~20% con crops agresivos** cortando contenido

### Soluciones:
1. ✅ Deshabilitar EXIF auto-rotate
2. ✅ Blur más fuerte antes de Sobel (5 vs 1)
3. ✅ Threshold más bajo (80 vs 120)
4. ✅ Detección de orientación por aspect ratio
5. ✅ Sistema multi-estrategia con scoring
6. ✅ Fallback conservador que SIEMPRE funciona

### Tiempo estimado total: **3-4 horas**

### Riesgo: **BAJO** (todas las soluciones tienen fallbacks)