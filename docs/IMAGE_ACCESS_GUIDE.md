# Guía de Acceso a Imágenes de Recibos desde la App

## Resumen
El backend provee múltiples formas de acceder a las imágenes de los recibos, optimizadas para aplicaciones móviles con soporte de thumbnails y caché.

## Endpoints Disponibles

### 1. **Acceso Directo Estático** (Más simple)
```
GET http://[servidor]:3000/uploads/[filename]
```
- ✅ No requiere autenticación
- ✅ Cacheable por CDN
- ⚠️ Necesitas extraer el filename de `imageUrl`
- Ejemplo: `http://localhost:3000/uploads/1234567890-987654321.jpg`

### 2. **API de Imágenes Autenticada** (Recomendado)
```
GET /api/images/receipt/{receiptId}
Headers: Authorization: Bearer [token]
```

#### Parámetros Query:
- `thumbnail`: `true` para obtener versión reducida
- `width`: Ancho del thumbnail (50-2000px, default: 300)

#### Ejemplos:
```dart
// Original
'http://servidor:3000/api/images/receipt/$receiptId'

// Thumbnail pequeño (150px)
'http://servidor:3000/api/images/receipt/$receiptId?thumbnail=true&width=150'

// Thumbnail mediano (300px)
'http://servidor:3000/api/images/receipt/$receiptId?thumbnail=true'

// Thumbnail grande (600px)
'http://servidor:3000/api/images/receipt/$receiptId?thumbnail=true&width=600'
```

### 3. **Información de Imagen**
```
GET /api/images/receipt/{receiptId}/info
Headers: Authorization: Bearer [token]
```

Respuesta:
```json
{
  "status": "success",
  "data": {
    "imageUrl": "http://servidor:3000/uploads/file.jpg",
    "thumbnailUrl": "http://servidor:3000/api/images/receipt/uuid?thumbnail=true",
    "hasImage": true,
    "imageType": "local",
    "endpoints": {
      "original": "...",
      "thumbnail": "...",
      "thumbnail_small": "...",
      "thumbnail_medium": "...",
      "thumbnail_large": "..."
    }
  }
}
```

## Implementación en Flutter

### Configuración Base
```dart
class ImageService {
  static const String baseUrl = 'http://servidor:3000';

  String getImageUrl(String receiptId, {bool thumbnail = false, int? width}) {
    String url = '$baseUrl/api/images/receipt/$receiptId';

    List<String> params = [];
    if (thumbnail) params.add('thumbnail=true');
    if (width != null) params.add('width=$width');

    if (params.isNotEmpty) {
      url += '?' + params.join('&');
    }

    return url;
  }
}
```

### Uso con CachedNetworkImage
```dart
import 'package:cached_network_image/cached_network_image.dart';

// En lista de recibos (thumbnails)
CachedNetworkImage(
  imageUrl: ImageService.getImageUrl(
    receipt.id,
    thumbnail: true,
    width: 150
  ),
  httpHeaders: {
    'Authorization': 'Bearer $token',
  },
  placeholder: (context, url) => CircularProgressIndicator(),
  errorWidget: (context, url, error) => Icon(Icons.receipt),
  cacheMaxAge: Duration(days: 7),
  maxWidthDiskCache: 300,
)

// Vista detallada (imagen completa)
CachedNetworkImage(
  imageUrl: ImageService.getImageUrl(receipt.id),
  httpHeaders: {
    'Authorization': 'Bearer $token',
  },
  placeholder: (context, url) =>
    // Mostrar thumbnail mientras carga
    CachedNetworkImage(
      imageUrl: ImageService.getImageUrl(
        receipt.id,
        thumbnail: true
      ),
      httpHeaders: {'Authorization': 'Bearer $token'},
    ),
  errorWidget: (context, url, error) => Icon(Icons.error),
)
```

### Vista con Zoom (PhotoView)
```dart
import 'package:photo_view/photo_view.dart';

PhotoView(
  imageProvider: CachedNetworkImageProvider(
    ImageService.getImageUrl(receipt.id),
    headers: {'Authorization': 'Bearer $token'},
  ),
  minScale: PhotoViewComputedScale.contained,
  maxScale: PhotoViewComputedScale.covered * 2,
)
```

## Optimizaciones Recomendadas

### 1. **Estrategia de Caché**
```dart
// Precargar thumbnails cuando se obtienen recibos
void precacheReceiptImages(List<Receipt> receipts) {
  for (var receipt in receipts) {
    precacheImage(
      CachedNetworkImageProvider(
        ImageService.getImageUrl(
          receipt.id,
          thumbnail: true,
          width: 150
        ),
        headers: {'Authorization': 'Bearer $token'},
      ),
      context,
    );
  }
}
```

### 2. **Manejo de Estados**
```dart
Widget buildReceiptImage(String receiptId) {
  return FutureBuilder<bool>(
    future: checkImageAvailability(receiptId),
    builder: (context, snapshot) {
      if (snapshot.hasData && snapshot.data!) {
        return CachedNetworkImage(
          imageUrl: ImageService.getImageUrl(receiptId),
          httpHeaders: {'Authorization': 'Bearer $token'},
        );
      } else {
        return Container(
          color: Colors.grey[200],
          child: Icon(Icons.receipt_long, size: 48),
        );
      }
    },
  );
}
```

### 3. **Hero Animation**
```dart
// Lista
Hero(
  tag: 'receipt-image-${receipt.id}',
  child: CachedNetworkImage(
    imageUrl: ImageService.getImageUrl(
      receipt.id,
      thumbnail: true,
      width: 150
    ),
    httpHeaders: {'Authorization': 'Bearer $token'},
  ),
)

// Detalle
Hero(
  tag: 'receipt-image-${receipt.id}',
  child: InteractiveViewer(
    child: CachedNetworkImage(
      imageUrl: ImageService.getImageUrl(receipt.id),
      httpHeaders: {'Authorization': 'Bearer $token'},
    ),
  ),
)
```

## Headers de Caché

El backend configura estos headers automáticamente:
- **Thumbnails**: `Cache-Control: public, max-age=86400` (1 día)
- **Originales**: `Cache-Control: public, max-age=604800` (7 días)

## Manejo de Errores

```dart
Widget buildReceiptImageWithFallback(Receipt receipt) {
  return CachedNetworkImage(
    imageUrl: ImageService.getImageUrl(receipt.id),
    httpHeaders: {'Authorization': 'Bearer $token'},
    errorWidget: (context, url, error) {
      // Fallback a información del recibo
      return Container(
        padding: EdgeInsets.all(16),
        color: Colors.grey[100],
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.receipt_long, size: 48, color: Colors.grey),
            SizedBox(height: 8),
            Text(receipt.merchantName ?? 'Recibo'),
            Text(
              receipt.amount != null
                ? '\$${receipt.amount.toStringAsFixed(2)}'
                : 'Sin monto',
              style: TextStyle(fontWeight: FontWeight.bold),
            ),
          ],
        ),
      );
    },
  );
}
```

## Seguridad

- ✅ El endpoint `/api/images/receipt/{id}` verifica que el usuario autenticado sea dueño del recibo
- ✅ Los tokens JWT son requeridos para acceso a través de la API
- ✅ Las imágenes estáticas en `/uploads` no tienen autenticación pero los nombres son únicos y difíciles de adivinar

## Rendimiento

1. **Usar thumbnails en listas**: Reduce ancho de banda y mejora velocidad
2. **Lazy loading**: Cargar imágenes solo cuando son visibles
3. **Precarga selectiva**: Precargar próximas imágenes en carrusel
4. **Límites de caché**: Configurar límites apropiados en `cached_network_image`

## Ejemplo Completo

```dart
class ReceiptImageWidget extends StatelessWidget {
  final String receiptId;
  final String token;
  final bool isThumbnail;
  final VoidCallback? onTap;

  const ReceiptImageWidget({
    Key? key,
    required this.receiptId,
    required this.token,
    this.isThumbnail = false,
    this.onTap,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Hero(
        tag: 'receipt-$receiptId',
        child: CachedNetworkImage(
          imageUrl: ImageService.getImageUrl(
            receiptId,
            thumbnail: isThumbnail,
            width: isThumbnail ? 300 : null,
          ),
          httpHeaders: {'Authorization': 'Bearer $token'},
          placeholder: (context, url) => Shimmer.fromColors(
            baseColor: Colors.grey[300]!,
            highlightColor: Colors.grey[100]!,
            child: Container(
              color: Colors.white,
              child: Center(
                child: Icon(Icons.receipt, color: Colors.grey),
              ),
            ),
          ),
          errorWidget: (context, url, error) => Container(
            color: Colors.grey[200],
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.broken_image, color: Colors.grey),
                Text('Error cargando imagen'),
              ],
            ),
          ),
          fadeInDuration: Duration(milliseconds: 200),
          fit: isThumbnail ? BoxFit.cover : BoxFit.contain,
        ),
      ),
    );
  }
}
```