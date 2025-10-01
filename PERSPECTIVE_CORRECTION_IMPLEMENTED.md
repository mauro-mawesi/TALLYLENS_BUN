# ✅ Corrección de Perspectiva Implementada

## Resumen

Se ha implementado **corrección de perspectiva** en el backend usando `@techstark/opencv-js` para replicar el comportamiento de `google_mlkit_document_scanner`.

---

## 📦 Archivos Creados/Modificados

### 1. **Nuevo Servicio: `perspectiveCorrectionService.js`**

Ubicación: `src/services/perspectiveCorrectionService.js`

**Funcionalidades:**
- ✅ Detección automática de 4 esquinas del documento
- ✅ Corrección de perspectiva (warp transformation)
- ✅ Ordenamiento inteligente de puntos (TL, TR, BR, BL)
- ✅ Manejo robusto de errores con fallbacks
- ✅ Limpieza automática de memoria (evita memory leaks)

**Métodos principales:**
```javascript
correctPerspective(imageBuffer)  // Método principal
extractPoints(contour)           // Extrae puntos del contorno
orderPoints(pts)                 // Ordena 4 esquinas
distance(p1, p2)                 // Calcula distancia euclidiana
matToBuffer(mat)                 // Convierte Mat a Buffer
cleanupMats(mats)                // Libera memoria
```

---

### 2. **Actualizado: `imageEnhancementService.js`**

**Cambios:**

#### a) Import agregado:
```javascript
import perspectiveCorrectionService from './perspectiveCorrectionService.js';
```

#### b) Nueva opción en defaultOptions:
```javascript
skipPerspectiveCorrection: false  // Set to true if processed by ML Kit
```

#### c) Nuevo Step 4 en pipeline:
```javascript
// Step 4: Perspective correction (if needed)
if (!opts.skipPerspectiveCorrection) {
    perspectiveCorrected = await perspectiveCorrectionService.correctPerspective(resized);
}
```

**Pipeline actualizado:**
```
1. Load Image
2. Detect Orientation → Rotate if needed
3. Resize (max 4000x4000)
4. Perspective Correction ← NUEVO
5. Intelligent Crop
6. Minimal Enhancements (quality preserving)
```

---

### 3. **Actualizado: `ocrService.js`**

**Cambios:**

```javascript
// Detecta si debe skip perspective correction
const skipPerspectiveCorrection = false; // TODO: Detect from metadata

// Pasa opción al enhancement
let processedImage = await imageEnhancementService.enhanceReceiptImage(
    imageBytes,
    { skipPerspectiveCorrection }
);
```

---

## 🎯 Cómo Funciona

### **Flujo Completo**

```
Imagen de entrada (en ángulo)
    ↓
1. Convertir a escala de grises
    ↓
2. Aplicar Gaussian Blur (reduce ruido)
    ↓
3. Detección de bordes con Canny
    ↓
4. Dilatar bordes (cerrar gaps)
    ↓
5. Encontrar contornos
    ↓
6. Ordenar por área (documento = más grande)
    ↓
7. Buscar contorno con 4 esquinas
    ↓
8. Aproximar con approxPolyDP
    ↓
9. Validar que tiene exactamente 4 puntos
    ↓
10. Ordenar puntos: TL, TR, BR, BL
    ↓
11. Calcular dimensiones del rectángulo de salida
    ↓
12. Calcular matriz de transformación de perspectiva
    ↓
13. Aplicar warpPerspective
    ↓
Imagen de salida (documento plano, como escaneado)
```

---

## 🔧 Algoritmo de Detección de Esquinas

### **Paso 1: Preprocesamiento**
```javascript
grayscale → GaussianBlur(5x5) → Canny(50, 200) → dilate(3x3, iterations: 2)
```

### **Paso 2: Encontrar Contornos**
```javascript
findContours(RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)
```

### **Paso 3: Filtrar por Forma**
```javascript
// Para cada contorno (ordenados por área descendente):
1. Calcular perímetro
2. Aproximar con tolerance = 0.02 * perímetro
3. Si tiene 4 puntos → ¡Documento encontrado!
4. Si no, intentar con tolerance = 0.04 (más tolerante)
```

### **Paso 4: Ordenar Esquinas**

**Método inteligente:**
```javascript
// Suma (x + y):
//   - Menor suma → Top-Left
//   - Mayor suma → Bottom-Right

// Diferencia (y - x):
//   - Menor diff → Top-Right
//   - Mayor diff → Bottom-Left
```

### **Paso 5: Transformación de Perspectiva**

```javascript
// Puntos de origen (esquinas detectadas)
src = [TL, TR, BR, BL]

// Puntos de destino (rectángulo perfecto)
dst = [[0, 0], [width, 0], [width, height], [0, height]]

// Calcular matriz de transformación
M = getPerspectiveTransform(src, dst)

// Aplicar warp
warped = warpPerspective(image, M, (width, height))
```

---

## 📊 Validaciones Implementadas

### 1. **Validación de Contornos**
```javascript
if (contours.size() === 0) {
    return original;  // No hay contornos
}
```

### 2. **Validación de Puntos**
```javascript
if (approx.rows !== 4) {
    // Intentar con tolerancia mayor
    // Si aún falla, retornar original
}
```

### 3. **Validación de Dimensiones**
```javascript
if (maxWidth < 100 || maxHeight < 100) {
    return original;  // Documento demasiado pequeño
}
```

### 4. **Validación de Puntos Suficientes**
```javascript
if (points.length < 4) {
    return original;  // Insuficientes puntos
}
```

---

## 🚀 Testing

### **Comando para probar:**

```bash
bun run dev
```

### **Logs esperados (éxito):**

```
[info]: Starting image enhancement with Sharp-only pipeline
[info]: Analyzing receipt orientation { aspectRatio: "0.75" }
[info]: Attempting perspective correction
[info]: OpenCV.js initialized successfully
[info]: Starting perspective correction
[debug]: Image dimensions { width: 3024, height: 4032 }
[debug]: Contours found { count: 15 }
[info]: Document contour found { points: 4, area: 10234567 }
[debug]: Ordered corner points { points: [[234,123], [2890,156], ...] }
[info]: Perspective correction successful {
  originalSize: "3024x4032",
  correctedSize: "2800x3600"
}
[info]: Intelligent crop selected best strategy {
  method: "edge-high-blur",
  score: "72.50"
}
[info]: Image enhancement completed successfully
```

### **Logs esperados (fallback):**

```
[info]: Attempting perspective correction
[warn]: No 4-corner document found, trying more tolerant approximation
[warn]: No document detected, returning original image
[warn]: Perspective correction failed, using original
[info]: Intelligent crop selected best strategy { ... }
```

---

## ⚙️ Configuración

### **Parámetros Ajustables**

En `perspectiveCorrectionService.js`:

#### 1. **Canny Edge Detection**
```javascript
cv.Canny(blurred, edges, 50, 200, 3, false);
//                        ^^  ^^^
//                        lowThreshold highThreshold

// Ajustar según calidad de imagen:
// - Imágenes nítidas: 50, 200
// - Imágenes con ruido: 30, 150
// - Imágenes muy limpias: 75, 225
```

#### 2. **Tolerancia de Aproximación**
```javascript
cv.approxPolyDP(contour, approx, 0.02 * peri, true);
//                                ^^^^
//                                tolerance

// Más tolerante → 0.04 (detecta más casos, menos preciso)
// Menos tolerante → 0.01 (más preciso, puede no detectar)
```

#### 3. **Dilate Iterations**
```javascript
cv.dilate(edges, dilated, kernel, new cv.Point(-1, -1), 2);
//                                                       ^
//                                                       iterations

// Más iteraciones → cierra gaps más grandes
// Menos iteraciones → preserva detalles finos
```

#### 4. **Gaussian Blur**
```javascript
const ksize = new cv.Size(5, 5);
//                        ^  ^
//                        width height

// Valores más altos → más suavizado (menos ruido, menos detalle)
// Valores más bajos → menos suavizado (más detalle, más ruido)
```

---

## 🔍 Troubleshooting

### **Problema: "No contours found"**

**Causa:** Imagen muy limpia sin bordes detectables.

**Solución:**
- Reducir threshold de Canny: `cv.Canny(blurred, edges, 30, 150)`
- Aumentar dilate iterations: `cv.dilate(..., 3)`

---

### **Problema: "No 4-corner document found"**

**Causa:** Documento con bordes curvos o parcialmente oculto.

**Solución:**
- Aumentar tolerancia: `cv.approxPolyDP(contour, approx, 0.04 * peri)`
- Buscar contornos con 4-10 puntos y aproximar a 4

---

### **Problema: "Detected document too small"**

**Causa:** Detección incorrecta de objeto pequeño.

**Solución:**
- Ajustar validación mínima:
```javascript
if (maxWidth < 50 || maxHeight < 50) {  // Más permisivo
```

---

### **Problema: Memory leak / crash**

**Causa:** Mats de OpenCV no liberados.

**Solución:**
- Verificar que `cleanupMats()` se llama en todos los paths
- Usar try/finally:
```javascript
try {
    // procesamiento
} finally {
    this.cleanupMats([mat1, mat2, ...]);
}
```

---

## 🎓 Comparación con ML Kit

| Característica | ML Kit (Flutter) | Nuestro Backend |
|----------------|------------------|-----------------|
| **Detección de esquinas** | ✅ ML-powered | ✅ Algoritmo tradicional |
| **Corrección de perspectiva** | ✅ | ✅ |
| **Normalización** | ✅ | ✅ |
| **Limpieza de manchas** | ✅ (SCANNER_MODE_FULL) | ❌ |
| **Filtros automáticos** | ✅ | ❌ |
| **Velocidad** | ⚡ Muy rápido (on-device) | 🐢 Más lento (backend) |
| **Costo** | ✅ Gratis | ✅ Gratis |
| **Precisión** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## 📈 Próximos Pasos

### **Fase 1: Testing** ✅ (AHORA)
```bash
bun run dev
bun run scripts/reprocess_all_receipts.js
```

### **Fase 2: Integrar con Upload Controller** (PRÓXIMO)

Detectar origen de imagen desde Flutter:

```javascript
// En uploadController.js
const processedByMLKit = req.body.processed === 'true';

const options = {
    skipPerspectiveCorrection: processedByMLKit
};

await imageEnhancementService.enhanceReceiptImage(imageBuffer, options);
```

### **Fase 3: Actualizar Flutter App** (DESPUÉS)

```dart
// Enviar metadata al subir
FormData.fromMap({
  'image': imageFile,
  'processed': scanResult.processed,  // true si viene de ML Kit
  'source': 'camera' o 'gallery'
});
```

### **Fase 4: Optimizaciones** (OPCIONAL)

- ⚠️ Cache de detección de esquinas
- ⚠️ Procesamiento en paralelo para batch
- ⚠️ Usar Web Workers para no bloquear event loop

---

## ✅ Checklist de Implementación

- [x] Instalar `@techstark/opencv-js`
- [x] Crear `perspectiveCorrectionService.js`
- [x] Integrar en `imageEnhancementService.js`
- [x] Actualizar `ocrService.js`
- [x] Agregar opción `skipPerspectiveCorrection`
- [ ] Testing con imágenes reales
- [ ] Ajustar parámetros según resultados
- [ ] Integrar detección de origen desde Flutter
- [ ] Documentar en README principal

---

## 🎉 Resultado Esperado

### Antes:
```
Recibo fotografiado en ángulo → Crop básico → OCR lee mal
```

### Ahora:
```
Recibo fotografiado en ángulo
    ↓
Detección de 4 esquinas
    ↓
Corrección de perspectiva (warp)
    ↓
Documento plano (como escaneado)
    ↓
Crop inteligente
    ↓
OCR perfecto ✅
```

---

**Status:** ✅ IMPLEMENTADO
**Fecha:** 2025-09-30
**Versión:** 1.0.0
**Librería:** @techstark/opencv-js@latest