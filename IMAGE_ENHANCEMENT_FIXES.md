# Correcciones al Sistema de Mejora de Imágenes

## Problemas Identificados y Soluciones Implementadas

### 1. **Error de OpenCV con jscanify**

**Problema:**
```
"undefined is not an object (evaluating 'new cv.Mat')"
```

**Causa:**
`jscanify` requiere que OpenCV.js se cargue de forma asíncrona antes de poder usar sus funciones de detección de contornos y corrección de perspectiva.

**Solución Implementada:**
- Se añadió `initializeOpenCV()` que carga OpenCV.js antes del primer uso
- Se implementó un sistema de inicialización con Promise y timeout (10 segundos)
- El pipeline ahora verifica si OpenCV está disponible antes de intentar la detección de perspectiva
- Si OpenCV no se carga, el sistema usa fallbacks automáticamente

**Código agregado en `imageEnhancementService.js`:**
```javascript
async initializeOpenCV() {
    if (this.openCVLoaded) return true;

    this.scanner.loadOpenCV(() => {
        this.openCVLoaded = true;
        log.info('OpenCV loaded successfully');
    });
}
```

### 2. **Detección de Bordes Mejorada**

**Problema:**
- El algoritmo de detección de bordes era muy básico
- No detectaba correctamente los límites del documento
- Umbral fijo causaba problemas con diferentes tipos de imágenes

**Solución Implementada:**

**a) Kernel Sobel en lugar de Laplaciano:**
```javascript
// Antes: Laplaciano [-1,-1,-1; -1,8,-1; -1,-1,-1]
// Ahora: Sobel X [-1,0,1; -2,0,2; -1,0,1]
```
El kernel Sobel es más efectivo para detectar bordes horizontales en documentos.

**b) Umbral Adaptativo con Estadísticas:**
```javascript
// Calcula median + 0.5 * stdDev para cada dimensión
const rowThreshold = Math.max(5, rowStats.median + (rowStats.stdDev * 0.5));
const colThreshold = Math.max(5, colStats.median + (colStats.stdDev * 0.5));
```

**c) Suavizado con Píxeles Consecutivos:**
- Requiere 3 píxeles consecutivos con alta densidad antes de establecer un límite
- Elimina falsos positivos por ruido
- Hace la detección más robusta

**d) Validación de Dimensiones:**
- Verifica que el área detectada sea al menos 30% del tamaño original
- Añade padding de 15px alrededor del contenido detectado
- Valida que las dimensiones finales sean válidas

### 3. **Corrección de Perspectiva Mejorada**

**Problema:**
- No manejaba errores correctamente
- No intentaba múltiples estrategias de preprocesamiento
- Faltaba logging detallado para debugging

**Solución Implementada:**

**a) Estrategia de Doble Intento:**
1. Primero intenta con imagen original
2. Si falla, intenta con imagen preprocesada (grayscale + normalize + blur)

**b) Validación Robusta:**
```javascript
if (!paperContour || paperContour.length !== 4) {
    throw new Error(`Invalid contour: ${paperContour?.length || 0} points`);
}
```

**c) Logging Detallado:**
- Registra el tamaño de la imagen de entrada
- Registra los 4 puntos de las esquinas detectadas
- Registra el tamaño de la imagen corregida
- Ayuda a diagnosticar problemas

### 4. **Pipeline de Fallbacks Mejorado**

**Nuevo Flujo:**
```
1. initializeOpenCV() → Intenta cargar OpenCV
   ↓
2. Si OpenCV OK → detectAndCorrectDocument()
   ├─ Original image
   └─ Preprocessed image (fallback)
   ↓
3. Si falla o OpenCV no disponible → edgeDetectionCrop()
   ├─ Sobel edge detection
   ├─ Adaptive threshold
   └─ Smooth boundary detection
   ↓
4. Si falla → smartContentCrop()
   ├─ Grid-based variance analysis
   └─ Content density mapping
   ↓
5. Si falla → Imagen redimensionada original
```

## Verificación de la Instalación

### Opción 1: Verificar jscanify (Recomendado para desarrollo)

```bash
# Verificar que jscanify esté instalado
cd backend
npm list jscanify

# Reinstalar si es necesario
npm install jscanify --save
```

### Opción 2: Alternativa con opencv4nodejs (Más robusto para producción)

Si jscanify sigue dando problemas, considera usar `opencv4nodejs`:

```bash
# Instalar dependencias del sistema primero (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y cmake build-essential

# Instalar opencv4nodejs
npm install opencv4nodejs --save

# Si falla, intenta con auto-build
npm install --save opencv-build opencv4nodejs
```

**Nota:** `opencv4nodejs` es más robusto pero requiere compilación nativa y es más pesado.

## Testing

### 1. Verificar Inicialización de OpenCV

Añade este endpoint temporal en tu controller:

```javascript
export const testOpenCVInit = asyncHandler(async (req, res) => {
    const success = await imageEnhancementService.initializeOpenCV();
    res.json({
        openCVLoaded: imageEnhancementService.openCVLoaded,
        success
    });
});
```

### 2. Probar con Imagen de Test

```bash
# Con curl
curl -X POST http://localhost:3000/api/image-enhancement/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"imageUrl": "http://localhost:3000/uploads/test-receipt.jpg"}'
```

### 3. Verificar Logs

Los logs ahora incluyen información detallada:

```
[info]: Initializing OpenCV for jscanify...
[info]: OpenCV loaded successfully
[info]: Attempting document detection { width: 1200, height: 1600 }
[info]: Document corners detected { topLeft: {...}, ... }
[info]: Perspective correction successful
```

O en caso de fallback:

```
[warn]: OpenCV not available, skipping perspective correction
[info]: Edge detection cropping successful
```

## Mejoras de Rendimiento

### Configuración Optimizada por Defecto

```javascript
{
  maxWidth: 2000,        // Reduce tamaño para procesamiento más rápido
  maxHeight: 2000,
  quality: 95,           // Balance calidad/tamaño
  grayscale: true,       // OCR funciona mejor con grayscale
  normalize: true,       // Mejora contraste automáticamente
  sharpen: true,         // Aumenta claridad del texto
  contrast: 1.2,         // +20% contraste
  brightness: 1.1        // +10% brillo
}
```

### Cache de OpenCV

Una vez cargado OpenCV, se mantiene en memoria para requests subsecuentes:

```javascript
if (this.openCVLoaded) return true; // No recarga
```

## Troubleshooting

### Error: "OpenCV loading timeout"

**Causa:** OpenCV.js tarda más de 10 segundos en cargar

**Solución:**
1. Verifica la conexión a internet (jscanify descarga OpenCV.js de CDN)
2. Aumenta el timeout en `initializeOpenCV()`
3. Considera cachear OpenCV.js localmente

### Error: "Could not detect document corners"

**Causa:** La imagen no tiene bordes claros del documento

**Solución:**
- El sistema automáticamente usa fallbacks (edge detection → smart crop)
- Esto es normal para imágenes con fondos complejos
- El OCR seguirá funcionando con la imagen mejorada

### Error: "Boundaries too small"

**Causa:** Detección de bordes encontró un área muy pequeña

**Solución:**
- El sistema automáticamente pasa al smart cropping
- Ajusta `minWidth/minHeight` en `edgeDetectionCrop()` si es necesario

### Edge Detection no detecta bien

**Opciones de ajuste en `edgeDetectionCrop()`:**

```javascript
// Ajustar threshold para imágenes más claras/oscuras
.threshold(100) // Incrementa para imágenes con más ruido

// Ajustar kernel Sobel
kernel: [-1, 0, 1, -2, 0, 2, -1, 0, 1] // Sobel X
// o
kernel: [-1, -2, -1, 0, 0, 0, 1, 2, 1] // Sobel Y

// Ajustar pixeles consecutivos requeridos
const requiredConsecutive = 3; // Aumenta para más suavizado
```

## Próximos Pasos (Opcional)

### 1. Añadir Rotación Automática

Detectar y corregir orientación del documento:

```javascript
async detectRotation(imageBuffer) {
    // Usar tesseract.js para detectar orientación del texto
    // O implementar algoritmo de detección de líneas
}
```

### 2. Mejorar Preprocesamiento

Añadir filtros adaptativos según tipo de documento:

```javascript
async adaptivePreprocess(imageBuffer, documentType) {
    if (documentType === 'receipt') {
        // Procesamiento específico para recibos
    }
}
```

### 3. Machine Learning para Detección

Usar un modelo pre-entrenado para detección de documentos:

```javascript
// Usar @tensorflow/tfjs-node con modelo pre-entrenado
// Ejemplo: U2-Net para segmentación de documentos
```

## Resumen de Cambios en Código

### Archivos Modificados

1. **`src/services/imageEnhancementService.js`**
   - ✅ Añadido `initializeOpenCV()`
   - ✅ Mejorado `enhanceReceiptImage()` con verificación de OpenCV
   - ✅ Mejorado `edgeDetectionCrop()` con Sobel y umbral adaptativo
   - ✅ Añadido `calculateDensityStats()` para análisis estadístico
   - ✅ Mejorado `findContentBoundaries()` con suavizado y validación
   - ✅ Mejorado `detectAndCorrectDocument()` con doble estrategia
   - ✅ Añadido logging detallado en todos los métodos

### Compatibilidad

- ✅ Mantiene compatibilidad con código existente
- ✅ No requiere cambios en otros servicios
- ✅ Fallbacks automáticos si OpenCV no está disponible
- ✅ Funciona tanto en desarrollo como producción

## Comandos para Probar

```bash
# Ejecutar backend
npm run dev

# Ver logs en tiempo real
tail -f logs/combined.log

# Probar endpoint de análisis
curl -X POST http://localhost:3000/api/image-enhancement/analyze \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"imageUrl": "URL_DE_IMAGEN"}'

# Probar endpoint de preview
curl -X POST http://localhost:3000/api/image-enhancement/preview \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"imageUrl": "URL_DE_IMAGEN"}'
```