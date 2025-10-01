# Solución Híbrida: Flutter + Backend

## El Problema Real

En la app móvil hay **2 flujos**:

### 1. **Foto desde Cámara** ✅
```
Usuario abre cámara
    ↓
google_mlkit_document_scanner (live)
    ↓
Perspectiva corregida automáticamente
    ↓
Upload al backend
    ↓
Backend: SOLO OCR (ya está procesada)
```

### 2. **Seleccionar de Galería** ❌
```
Usuario elige foto existente
    ↓
google_mlkit_document_scanner NO FUNCIONA (requiere cámara live)
    ↓
Upload imagen SIN procesar
    ↓
Backend: DEBE procesar (corrección + crop)
```

---

## Solución Híbrida

### **Flutter App**

```dart
// lib/services/receipt_scanner_service.dart

class ReceiptScannerService {
  /// Escanea desde cámara con ML Kit
  Future<ScanResult> scanFromCamera() async {
    final options = DocumentScannerOptions(
      documentFormat: DocumentFormat.jpeg,
      mode: ScannerMode.full,
    );

    final scanner = DocumentScanner(options: options);
    final result = await scanner.scanDocument();

    if (result != null && result.images.isNotEmpty) {
      return ScanResult(
        file: File(result.images.first),
        source: ImageSource.camera,
        processed: true,  // ✅ Ya procesada por ML Kit
      );
    }

    throw Exception('Scan cancelled');
  }

  /// Selecciona de galería (SIN procesamiento)
  Future<ScanResult> pickFromGallery() async {
    final picker = ImagePicker();
    final image = await picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 100,  // Máxima calidad
    );

    if (image != null) {
      return ScanResult(
        file: File(image.path),
        source: ImageSource.gallery,
        processed: false,  // ❌ Requiere procesamiento en backend
      );
    }

    throw Exception('No image selected');
  }
}

class ScanResult {
  final File file;
  final ImageSource source;
  final bool processed;  // Indica si ya fue procesada por ML Kit

  ScanResult({
    required this.file,
    required this.source,
    required this.processed,
  });
}
```

### **Upload con Metadatos**

```dart
// lib/services/receipt_upload_service.dart

Future<void> uploadReceipt(ScanResult scanResult) async {
  final formData = FormData.fromMap({
    'image': await MultipartFile.fromFile(scanResult.file.path),
    // 🔑 IMPORTANTE: Enviar metadata
    'processed': scanResult.processed.toString(),
    'source': scanResult.source == ImageSource.camera ? 'camera' : 'gallery',
  });

  final response = await dio.post('/api/receipts', data: formData);
  return response.data;
}
```

---

## Backend (Node.js)

### **1. Middleware para Detectar Origen**

```javascript
// src/middlewares/imageSourceDetector.js

export const detectImageSource = (req, res, next) => {
    // Leer metadatos del request
    const processed = req.body.processed === 'true';
    const source = req.body.source; // 'camera' o 'gallery'

    // Agregar al request para uso posterior
    req.imageMetadata = {
        processed: processed,
        source: source,
        needsProcessing: !processed  // Si NO está procesada, necesita procesamiento
    };

    log.info('Image source detected', req.imageMetadata);
    next();
};
```

### **2. Actualizar Upload Controller**

```javascript
// src/controllers/uploadController.js

import perspectiveCorrectionService from '../services/perspectiveCorrectionService.js';

export const uploadReceipt = asyncHandler(async (req, res) => {
    const { file } = req;
    const { processed, source, needsProcessing } = req.imageMetadata;

    // Guardar imagen original primero
    const originalPath = file.path;

    // 🔑 DECISIÓN INTELIGENTE
    if (needsProcessing) {
        log.info('Image needs processing (from gallery)', {
            source,
            originalPath
        });

        try {
            // Leer imagen
            const imageBuffer = await fs.readFile(originalPath);

            // Aplicar corrección de perspectiva + crop
            const processedBuffer = await perspectiveCorrectionService.correctPerspective(imageBuffer);

            // Aplicar intelligent crop
            const croppedBuffer = await imageEnhancementService.intelligentCrop(processedBuffer);

            // Guardar calidad preservada
            const enhancedBuffer = await imageEnhancementService.applyEnhancements(croppedBuffer);

            // Reemplazar archivo original
            await fs.writeFile(originalPath, enhancedBuffer);

            log.info('Image processed successfully', {
                operations: 'perspective + crop',
                source: 'gallery'
            });

        } catch (error) {
            log.error('Image processing failed, using original', {
                error: error.message
            });
            // Continuar con original si falla
        }
    } else {
        log.info('Image already processed by ML Kit (from camera)', {
            source,
            skipping: 'backend processing'
        });
        // NO procesar, ya viene lista desde Flutter
    }

    // Crear registro en DB
    const receipt = await Receipt.create({
        userId: req.user.id,
        imageUrl: file.path,
        processedByMLKit: processed,
        source: source
    });

    res.json({
        success: true,
        receipt
    });
});
```

### **3. OCR Service Actualizado**

```javascript
// src/services/ocrService.js

export async function extractTextFromImage(imageUrl) {
    try {
        const filePath = imageUrl.replace('http://localhost:3000', './public');
        const imageBytes = await fs.readFile(filePath);

        // Verificar si fue procesada por ML Kit
        const receipt = await Receipt.findOne({ where: { imageUrl } });

        if (receipt?.processedByMLKit) {
            log.info('Image already processed by ML Kit, skipping enhancement');
            // Usar directamente sin más procesamiento
        } else {
            log.info('Image from gallery, was already processed in upload');
            // Ya fue procesada en el upload, usar directamente
        }

        // Enviar a Google Vision
        const request = {
            image: { content: imageBytes }
        };

        const [result] = await client.textDetection(request);
        return result.textAnnotations?.[0]?.description || "";

    } catch (err) {
        log.error("Error en OCR:", err);
        return "";
    }
}
```

---

## Flujo Completo

### **Escenario 1: Foto desde Cámara** 📷

```
Flutter App
    ↓
Usuario presiona "Tomar Foto"
    ↓
google_mlkit_document_scanner.scanDocument()
    ↓ (ML Kit procesa)
    - Detecta 4 esquinas
    - Corrige perspectiva
    - Crop automático
    - Optimiza
    ↓
Upload con metadata: { processed: true, source: 'camera' }
    ↓
Backend detecta: processed = true
    ↓
Backend: SKIP procesamiento ⏭️
    ↓
Guardar imagen tal cual
    ↓
OCR directo
    ✅ LISTO
```

### **Escenario 2: Foto de Galería** 🖼️

```
Flutter App
    ↓
Usuario presiona "Seleccionar de Galería"
    ↓
ImagePicker (imagen sin procesar)
    ↓
Upload con metadata: { processed: false, source: 'gallery' }
    ↓
Backend detecta: processed = false
    ↓
Backend: PROCESAR ⚙️
    ↓
opencv4nodejs: Detectar esquinas + Corregir perspectiva
    ↓
Intelligent crop
    ↓
Guardar con calidad preservada
    ↓
OCR
    ✅ LISTO
```

---

## Instalación opencv4nodejs en Backend

### **Paso 1: Actualizar Dockerfile**

```dockerfile
# En tu Dockerfile (o devcontainer.json)
RUN apt-get update && apt-get install -y \
    cmake \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*
```

### **Paso 2: Instalar npm package**

```bash
npm install opencv4nodejs
```

### **Paso 3: Verificar instalación**

```bash
node -e "const cv = require('opencv4nodejs'); console.log('OpenCV version:', cv.version);"
```

---

## Código del Servicio de Corrección de Perspectiva

```javascript
// src/services/perspectiveCorrectionService.js

import cv from 'opencv4nodejs';
import { log } from '../utils/logger.js';

class PerspectiveCorrectionService {
    /**
     * Corrige perspectiva de documento (como ML Kit)
     * @param {Buffer} imageBuffer
     * @returns {Promise<Buffer>}
     */
    async correctPerspective(imageBuffer) {
        try {
            log.info('Starting perspective correction with OpenCV');

            // Decodificar imagen
            const img = cv.imdecode(imageBuffer);
            const { rows, cols } = img;

            // Convertir a grayscale para detección
            const gray = img.cvtColor(cv.COLOR_BGR2GRAY);

            // Aplicar blur para reducir ruido
            const blurred = gray.gaussianBlur(new cv.Size(5, 5), 0);

            // Detección de bordes con Canny
            const edged = blurred.canny(50, 200);

            // Dilatar para cerrar gaps en los bordes
            const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
            const dilated = edged.dilate(kernel, new cv.Point2(-1, -1), 2);

            // Encontrar contornos
            const contours = dilated.findContours(
                cv.RETR_EXTERNAL,
                cv.CHAIN_APPROX_SIMPLE
            );

            if (contours.length === 0) {
                log.warn('No contours found');
                return imageBuffer;
            }

            // Ordenar contornos por área (el documento será el más grande)
            const sortedContours = contours
                .sort((a, b) => b.area - a.area)
                .slice(0, 5);  // Tomar los 5 más grandes

            // Buscar contorno con 4 esquinas (rectangular)
            let docContour = null;
            for (const contour of sortedContours) {
                const peri = contour.arcLength(true);
                const approx = contour.approxPolyDP(0.02 * peri, true);

                if (approx.rows === 4) {
                    docContour = approx;
                    log.info('Document contour found', {
                        points: 4,
                        area: contour.area,
                        perimeter: peri
                    });
                    break;
                }
            }

            if (!docContour) {
                log.warn('No 4-corner document found, trying with 5-10 points');

                // Fallback: Buscar contornos con más puntos y aproximar
                for (const contour of sortedContours) {
                    const peri = contour.arcLength(true);
                    const approx = contour.approxPolyDP(0.04 * peri, true);  // Más tolerante

                    if (approx.rows >= 4 && approx.rows <= 10) {
                        // Tomar solo 4 esquinas principales
                        const points = approx.getDataAsArray().map(p => p[0]);
                        const ordered = this.orderPoints(points);
                        docContour = { points: ordered };
                        log.info('Document approximated to 4 corners', {
                            originalPoints: approx.rows
                        });
                        break;
                    }
                }
            }

            if (!docContour) {
                log.warn('No document detected, returning original image');
                return imageBuffer;
            }

            // Extraer puntos del contorno
            const points = docContour.points || docContour.getDataAsArray().map(p => p[0]);
            const orderedPoints = this.orderPoints(points);

            // Calcular dimensiones del documento de salida
            const [tl, tr, br, bl] = orderedPoints;

            const widthTop = this.distance(tl, tr);
            const widthBottom = this.distance(bl, br);
            const maxWidth = Math.max(widthTop, widthBottom);

            const heightLeft = this.distance(tl, bl);
            const heightRight = this.distance(tr, br);
            const maxHeight = Math.max(heightLeft, heightRight);

            // Validar dimensiones
            if (maxWidth < 100 || maxHeight < 100) {
                log.warn('Detected document too small', { maxWidth, maxHeight });
                return imageBuffer;
            }

            // Puntos de destino (documento plano)
            const dst = [
                [0, 0],
                [maxWidth - 1, 0],
                [maxWidth - 1, maxHeight - 1],
                [0, maxHeight - 1]
            ];

            // Crear matrices para transformación
            const srcPoints = orderedPoints.map(p => [p]);
            const dstPoints = dst.map(p => [p]);

            const srcMat = new cv.Mat(srcPoints, cv.CV_32FC2);
            const dstMat = new cv.Mat(dstPoints, cv.CV_32FC2);

            // Calcular matriz de transformación de perspectiva
            const M = cv.getPerspectiveTransform(srcMat, dstMat);

            // Aplicar transformación warp
            const warped = img.warpPerspective(
                M,
                new cv.Size(Math.round(maxWidth), Math.round(maxHeight)),
                cv.INTER_LINEAR
            );

            // Codificar de vuelta a buffer
            const correctedBuffer = cv.imencode('.png', warped);

            log.info('Perspective correction successful', {
                originalSize: `${cols}x${rows}`,
                correctedSize: `${Math.round(maxWidth)}x${Math.round(maxHeight)}`,
                corners: orderedPoints
            });

            return correctedBuffer;

        } catch (error) {
            log.error('Perspective correction failed', {
                error: error.message,
                stack: error.stack
            });

            // Devolver imagen original si falla
            return imageBuffer;
        }
    }

    /**
     * Ordena puntos: top-left, top-right, bottom-right, bottom-left
     */
    orderPoints(pts) {
        // Asegurar que son arrays de [x, y]
        const points = pts.map(p => Array.isArray(p[0]) ? p[0] : p);

        // Ordenar por suma (x + y): TL tendrá menor suma, BR mayor suma
        const sums = points.map((p, i) => ({ idx: i, sum: p[0] + p[1] }));
        sums.sort((a, b) => a.sum - b.sum);

        const tl = points[sums[0].idx];
        const br = points[sums[sums.length - 1].idx];

        // Ordenar por diferencia (y - x): TR tendrá menor diff, BL mayor diff
        const diffs = points.map((p, i) => ({ idx: i, diff: p[1] - p[0] }));
        diffs.sort((a, b) => a.diff - b.diff);

        const tr = points[diffs[0].idx];
        const bl = points[diffs[diffs.length - 1].idx];

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

## Base de Datos: Añadir Campos

```javascript
// En migration de receipts
await queryInterface.addColumn('receipts', 'processed_by_mlkit', {
    type: Sequelize.BOOLEAN,
    defaultValue: false,
    comment: 'Indica si fue procesada por ML Kit en Flutter'
});

await queryInterface.addColumn('receipts', 'source', {
    type: Sequelize.ENUM('camera', 'gallery'),
    allowNull: true,
    comment: 'Origen de la imagen'
});
```

---

## Ventajas de Esta Solución

### ✅ **Mejor UX**
- Cámara: Escaneo en vivo con preview
- Galería: Procesamiento automático en backend

### ✅ **Óptimo Performance**
- Cámara: Procesamiento on-device (gratis, rápido)
- Galería: Procesamiento en backend (solo cuando necesario)

### ✅ **Máxima Calidad**
- Ambos flujos producen imágenes perfectamente procesadas
- Backend preserva calidad con PNG lossless

### ✅ **Robusto**
- ML Kit para casos ideales (cámara)
- OpenCV para casos complejos (galería)
- Fallbacks en cada paso

---

## Comandos para Implementar

```bash
# 1. Instalar OpenCV en backend
apt-get update && apt-get install -y cmake build-essential python3
npm install opencv4nodejs

# 2. Ejecutar en devcontainer
bun run dev
```

---

## Testing

### **Test 1: Desde Cámara (ML Kit)**
```
1. Abrir app → "Tomar Foto"
2. Escanear recibo con ML Kit
3. Verificar que se ve plano
4. Subir
5. Backend: debería loggear "already processed by ML Kit, skipping"
```

### **Test 2: Desde Galería (Backend OpenCV)**
```
1. Abrir app → "Seleccionar de Galería"
2. Elegir foto en ángulo
3. Subir
4. Backend: debería loggear "Starting perspective correction with OpenCV"
5. Verificar imagen procesada está plana
```

---

Esta es la **solución definitiva** que combina lo mejor de ambos mundos. ¿Quieres que implemente el código del servicio de perspectiva y actualice los controllers?