# Solución: Corrección de Perspectiva para Recibos

## Problema Actual

Eliminamos `jscanify` porque causaba corrupción, pero **SÍ necesitamos corrección de perspectiva** para recibos fotografiados en ángulo.

## ¿Qué hace google_mlkit_document_scanner?

1. ✅ **Detección de 4 esquinas** del documento
2. ✅ **Transformación de perspectiva** (warp)
3. ✅ **Normalización** (documento alineado como escaneado)
4. ✅ **Crop** automático

**Resultado:** Documento plano, como si fuera escaneado.

---

## Nuestro Problema Actual

### Pipeline Actual:
```
1. Detectar orientación (aspect ratio) ✅
2. Rotar si horizontal ✅
3. Crop inteligente ⚠️ (no funciona bien)
4. Guardar sin pérdida ✅
```

### Lo que FALTA:
- ❌ **Corrección de perspectiva** (documento en ángulo → documento plano)
- ❌ **Detección precisa de 4 esquinas**
- ❌ **Transformación warp**

---

## Opciones de Solución

### **Opción 1: OpenCV4NodeJS** ⭐⭐⭐⭐⭐

**Librería:** `opencv4nodejs`

**Ventajas:**
- ✅ OpenCV completo en Node.js
- ✅ Funciones de detección de contornos
- ✅ Transformación de perspectiva (warpPerspective)
- ✅ Muy robusto y probado
- ✅ Activamente mantenido

**Desventajas:**
- ⚠️ Requiere compilación nativa
- ⚠️ Dependencias del sistema (cmake, build-tools)
- ⚠️ Más pesado (~200MB)

**Instalación:**
```bash
# Dependencias del sistema
apt-get install -y cmake build-essential

# NPM package
npm install opencv4nodejs
```

**Código ejemplo:**
```javascript
import cv from 'opencv4nodejs';

async function detectAndCorrectPerspective(imageBuffer) {
    // Cargar imagen
    const img = cv.imdecode(imageBuffer);

    // Convertir a grayscale
    const gray = img.cvtColor(cv.COLOR_BGR2GRAY);

    // Aplicar blur y threshold
    const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);
    const edged = blurred.canny(75, 200);

    // Encontrar contornos
    const contours = edged.findContours(cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    // Ordenar por área (el documento será el contorno más grande)
    const sorted = contours.sort((c1, c2) => c2.area - c1.area);

    // Buscar contorno con 4 esquinas
    let docContour = null;
    for (const contour of sorted.slice(0, 5)) {
        const peri = contour.arcLength(true);
        const approx = contour.approxPolyDP(0.02 * peri, true);

        if (approx.rows === 4) {
            docContour = approx;
            break;
        }
    }

    if (!docContour) {
        throw new Error('No se detectaron 4 esquinas');
    }

    // Ordenar puntos (top-left, top-right, bottom-right, bottom-left)
    const points = orderPoints(docContour.getDataAsArray());

    // Calcular dimensiones del documento corregido
    const [tl, tr, br, bl] = points;
    const widthA = Math.sqrt(Math.pow(br[0] - bl[0], 2) + Math.pow(br[1] - bl[1], 2));
    const widthB = Math.sqrt(Math.pow(tr[0] - tl[0], 2) + Math.pow(tr[1] - tl[1], 2));
    const maxWidth = Math.max(widthA, widthB);

    const heightA = Math.sqrt(Math.pow(tr[0] - br[0], 2) + Math.pow(tr[1] - br[1], 2));
    const heightB = Math.sqrt(Math.pow(tl[0] - bl[0], 2) + Math.pow(tl[1] - bl[1], 2));
    const maxHeight = Math.max(heightA, heightB);

    // Definir puntos de destino
    const dst = [
        [0, 0],
        [maxWidth - 1, 0],
        [maxWidth - 1, maxHeight - 1],
        [0, maxHeight - 1]
    ];

    // Calcular matriz de transformación
    const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, points.flat());
    const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, dst.flat());
    const M = cv.getPerspectiveTransform(srcMat, dstMat);

    // Aplicar transformación
    const warped = img.warpPerspective(M, new cv.Size(maxWidth, maxHeight));

    // Convertir a buffer
    return cv.imencode('.png', warped);
}

function orderPoints(pts) {
    // Ordenar puntos: top-left, top-right, bottom-right, bottom-left
    const sorted = pts.sort((a, b) => a[1] - b[1]);
    const top = sorted.slice(0, 2).sort((a, b) => a[0] - b[0]);
    const bottom = sorted.slice(2, 4).sort((a, b) => a[0] - b[0]);
    return [top[0], top[1], bottom[1], bottom[0]];
}
```

---

### **Opción 2: Sharp + Algoritmo Manual** ⭐⭐⭐

**Sin librerías adicionales**, implementar detección de esquinas manualmente con Sharp.

**Ventajas:**
- ✅ Sin dependencias adicionales
- ✅ Más ligero
- ✅ Ya tenemos Sharp

**Desventajas:**
- ❌ Transformación de perspectiva limitada en Sharp
- ❌ No tiene warpPerspective nativo
- ❌ Tendríamos que implementar warp manualmente (complejo)

**Conclusión:** Sharp NO tiene funciones de corrección de perspectiva.

---

### **Opción 3: Llamar a Python desde Node.js** ⭐⭐

**Usar Python con OpenCV** desde Node.js vía `child_process`.

**Ventajas:**
- ✅ OpenCV de Python es muy robusto
- ✅ Muchos ejemplos disponibles

**Desventajas:**
- ❌ Requiere Python instalado
- ❌ Comunicación inter-proceso (lento)
- ❌ Más complejo de mantener
- ❌ Menos portable

---

### **Opción 4: Usar API de Google Vision Document AI** ⭐⭐⭐⭐

**Usar Google Cloud Document AI** que ya tiene detección y corrección.

**Ventajas:**
- ✅ Ya usamos Google Cloud
- ✅ Muy preciso (ML)
- ✅ Sin dependencias locales
- ✅ Mantenido por Google

**Desventajas:**
- ⚠️ Costo adicional por API call
- ⚠️ Requiere conexión a internet
- ⚠️ Latencia de red

---

### **Opción 5: Procesar en Flutter, Enviar Procesado** ⭐⭐⭐⭐⭐

**La mejor solución:** Usar `google_mlkit_document_scanner` en Flutter.

**Flujo:**
```
Flutter App
    ↓
google_mlkit_document_scanner
    ↓ (corrección de perspectiva on-device)
Imagen corregida
    ↓
Upload al backend
    ↓
Backend solo hace OCR (sin procesamiento)
```

**Ventajas:**
- ✅ **GRATIS** (on-device, no API costs)
- ✅ **RÁPIDO** (procesamiento local)
- ✅ **PRECISO** (ML Kit de Google)
- ✅ **SIMPLE** backend (solo OCR)
- ✅ **YA TIENES** Flutter app
- ✅ **MEJOR UX** (usuario ve preview antes de subir)

**Desventajas:**
- ⚠️ Solo funciona en Android/iOS (no web)
- ⚠️ Requiere cambios en Flutter

---

## Recomendación

### **Solución Híbrida (MEJOR):**

#### **Para App Móvil (Flutter):**
```dart
// Usar google_mlkit_document_scanner
import 'package:google_mlkit_document_scanner/google_mlkit_document_scanner.dart';

Future<File> scanDocument() async {
  final options = DocumentScannerOptions(
    documentFormat: DocumentFormat.jpeg,
    mode: ScannerMode.full, // ML-powered cleaning
  );

  final scanner = DocumentScanner(options: options);
  final result = await scanner.scanDocument();

  // Imagen ya viene corregida, cropped, y optimizada
  return result.images.first;
}
```

#### **Para Backend (Node.js):**
```javascript
// OPCIÓN A: opencv4nodejs (si necesitamos procesar en backend)
// OPCIÓN B: NO procesar, asumir que viene del Flutter scanner
```

---

## Plan de Implementación

### **Estrategia 1: Flutter First** ⭐⭐⭐⭐⭐ (RECOMENDADO)

**Para nuevas imágenes:**
1. ✅ Flutter usa `google_mlkit_document_scanner`
2. ✅ Sube imagen ya procesada
3. ✅ Backend solo hace OCR
4. ✅ **CERO cambios en backend necesarios**

**Para reprocesar imágenes existentes:**
1. ⚠️ Backend necesita opencv4nodejs
2. ⚠️ O aceptar que no se corrige perspectiva

**Pros:**
- Mejor UX (usuario ve preview)
- Gratis (on-device)
- Más rápido
- Backend más simple

**Contras:**
- Requiere actualizar Flutter app
- No funciona para imágenes viejas

---

### **Estrategia 2: Backend con OpenCV4NodeJS** ⭐⭐⭐⭐

**Implementación completa en backend.**

**Instalación:**
```bash
# En devcontainer
apt-get update
apt-get install -y cmake build-essential

# NPM
npm install opencv4nodejs
```

**Integración:**
```javascript
// src/services/perspectiveCorrectionService.js
import cv from 'opencv4nodejs';

class PerspectiveCorrectionService {
    async correctPerspective(imageBuffer) {
        try {
            // Implementar detección + warp
            // (código completo arriba)
        } catch (error) {
            // Si falla, devolver original
            return imageBuffer;
        }
    }
}
```

**Pros:**
- Funciona para todo (nuevas + viejas)
- No requiere cambios en Flutter
- Procesamiento centralizado

**Contras:**
- Dependencias pesadas (~200MB)
- Compilación nativa requerida
- Más complejo

---

## Decisión Recomendada

### **Implementar AMBAS:**

#### **Fase 1: Backend con OpenCV4NodeJS** (AHORA)
Para que funcione inmediatamente y para reprocesar imágenes existentes.

```bash
npm install opencv4nodejs
```

#### **Fase 2: Flutter con ML Kit** (PRÓXIMO)
Para mejor experiencia de usuario y reducir carga del backend.

```yaml
# pubspec.yaml
dependencies:
  google_mlkit_document_scanner: ^latest
```

#### **Fase 3: Detección Inteligente** (FUTURO)
```javascript
// Si imagen viene de Flutter scanner (metadatos)
if (req.headers['x-processed-by'] === 'mlkit') {
    // NO procesar, ya viene lista
    skipPerspectiveCorrection = true;
}
```

---

## Comandos de Instalación

### **Para instalar opencv4nodejs en devcontainer:**

```bash
# Actualizar Dockerfile o ejecutar en terminal:
apt-get update
apt-get install -y cmake build-essential

# Instalar opencv4nodejs
npm install opencv4nodejs

# Esperar ~5 minutos (compila OpenCV)
```

### **Si falla la instalación:**

```bash
# Alternativa: usar pre-build
npm install opencv4nodejs --build-from-source=false

# O especificar versión de OpenCV
OPENCV4NODEJS_DISABLE_AUTOBUILD=1 npm install opencv4nodejs
```

---

## Código Completo para Backend

Crear archivo: `src/services/perspectiveCorrectionService.js`

```javascript
import cv from 'opencv4nodejs';
import { log } from '../utils/logger.js';

class PerspectiveCorrectionService {
    /**
     * Detecta y corrige la perspectiva de un documento
     * @param {Buffer} imageBuffer - Imagen de entrada
     * @returns {Promise<Buffer>} Imagen corregida
     */
    async correctPerspective(imageBuffer) {
        try {
            log.info('Starting perspective correction');

            // Cargar imagen
            const img = cv.imdecode(imageBuffer);
            const { rows, cols } = img;

            // Crear copia en escala de grises para detección
            const gray = img.cvtColor(cv.COLOR_BGR2GRAY);
            const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);
            const edged = blurred.canny(50, 200);

            // Dilatar para cerrar gaps
            const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
            const dilated = edged.dilate(kernel);

            // Encontrar contornos
            const contours = dilated.findContours(
                cv.RETR_EXTERNAL,
                cv.CHAIN_APPROX_SIMPLE
            );

            // Ordenar por área
            const sortedContours = contours
                .sort((a, b) => b.area - a.area)
                .slice(0, 5);

            // Buscar contorno rectangular (4 esquinas)
            let docContour = null;
            for (const contour of sortedContours) {
                const peri = contour.arcLength(true);
                const approx = contour.approxPolyDP(0.02 * peri, true);

                if (approx.rows === 4) {
                    docContour = approx;
                    log.info('Document contour found', {
                        points: approx.rows,
                        area: contour.area
                    });
                    break;
                }
            }

            if (!docContour) {
                log.warn('No 4-corner contour found, returning original');
                return imageBuffer;
            }

            // Extraer y ordenar puntos
            const points = this.orderPoints(docContour.getDataAsArray());

            // Calcular dimensiones de salida
            const [tl, tr, br, bl] = points;
            const width = Math.max(
                this.distance(br, bl),
                this.distance(tr, tl)
            );
            const height = Math.max(
                this.distance(tr, br),
                this.distance(tl, bl)
            );

            // Puntos de destino
            const dst = [
                [0, 0],
                [width - 1, 0],
                [width - 1, height - 1],
                [0, height - 1]
            ];

            // Crear matrices
            const srcMat = new cv.Mat(points.map(p => [p]), cv.CV_32FC2);
            const dstMat = new cv.Mat(dst.map(p => [p]), cv.CV_32FC2);

            // Calcular transformación de perspectiva
            const M = cv.getPerspectiveTransform(srcMat, dstMat);

            // Aplicar transformación
            const warped = img.warpPerspective(M, new cv.Size(width, height));

            // Codificar a buffer
            const corrected = cv.imencode('.png', warped);

            log.info('Perspective correction successful', {
                originalSize: `${cols}x${rows}`,
                correctedSize: `${width}x${height}`
            });

            return corrected;

        } catch (error) {
            log.error('Perspective correction failed', {
                error: error.message,
                stack: error.stack
            });
            // Devolver original si falla
            return imageBuffer;
        }
    }

    /**
     * Ordena puntos: top-left, top-right, bottom-right, bottom-left
     */
    orderPoints(pts) {
        const points = pts.map(p => p[0]);

        // Suma: top-left tendrá menor suma, bottom-right mayor
        const sums = points.map((p, i) => ({ idx: i, sum: p[0] + p[1] }));
        sums.sort((a, b) => a.sum - b.sum);
        const tl = points[sums[0].idx];
        const br = points[sums[3].idx];

        // Diferencia: top-right tendrá menor diff, bottom-left mayor
        const diffs = points.map((p, i) => ({ idx: i, diff: p[1] - p[0] }));
        diffs.sort((a, b) => a.diff - b.diff);
        const tr = points[diffs[0].idx];
        const bl = points[diffs[3].idx];

        return [tl, tr, br, bl];
    }

    /**
     * Calcula distancia euclidiana entre dos puntos
     */
    distance(p1, p2) {
        return Math.sqrt(
            Math.pow(p2[0] - p1[0], 2) +
            Math.pow(p2[1] - p1[1], 2)
        );
    }
}

export default new PerspectiveCorrectionService();
```

---

## Integración en imageEnhancementService

```javascript
// En enhanceReceiptImage(), ANTES del crop:

// Step 4: Perspective correction (si está disponible)
try {
    const perspectiveCorrectionService = await import('./perspectiveCorrectionService.js');
    const corrected = await perspectiveCorrectionService.default.correctPerspective(resized);
    resized = corrected;
    log.info('Perspective correction applied');
} catch (error) {
    log.warn('Perspective correction not available or failed', {
        error: error.message
    });
    // Continuar sin corrección de perspectiva
}

// Step 5: Intelligent crop
...
```

---

## Testing

```bash
# Instalar
npm install opencv4nodejs

# Restart server
bun run dev

# Test
bun run scripts/reprocess_all_receipts.js
```

---

## Resultado Esperado

### Antes:
```
Recibo fotografiado en ángulo
    ↓
Crop (pero sigue en ángulo)
    ↓
OCR lee mal
```

### Después:
```
Recibo fotografiado en ángulo
    ↓
Detección de 4 esquinas
    ↓
Corrección de perspectiva (warp)
    ↓
Documento plano (como escaneado)
    ↓
Crop
    ↓
OCR perfecto
```