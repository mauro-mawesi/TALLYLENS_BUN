# 📊 Analytics API - Endpoints Inteligentes para Estadísticas de Productos

## 🎯 Funcionalidades Avanzadas

Los endpoints de analytics proporcionan **insights valiosos** para que los usuarios tomen mejores decisiones de compra:

### ✨ **Características Principales:**
- 📈 **Estadísticas mensuales** por producto
- 💰 **Comparación de precios** entre tiendas
- 🔮 **Predicciones de compra** basadas en patrones
- 📊 **Análisis de gastos** por categoría
- 🚨 **Alertas inteligentes** automáticas
- 💡 **Recomendaciones personalizadas**

---

## 📋 Endpoints Disponibles

### 1. **📊 Estadísticas Mensuales del Producto**
```http
GET /api/analytics/products/{productId}/monthly-stats?months=12
```

**Casos de uso:**
- Ver cuánto gasta mensualmente en un producto específico
- Identificar patrones estacionales de compra
- Analizar fluctuaciones de precio a lo largo del tiempo

**Respuesta ejemplo:**
```json
{
  "status": "success",
  "data": {
    "product": {
      "id": "123",
      "name": "Leche Entera 1L",
      "category": "Alimentos"
    },
    "monthlyStats": [
      {
        "month": "2024-01-01T00:00:00.000Z",
        "purchaseCount": 4,
        "totalQuantity": 8,
        "totalSpent": 32.50,
        "avgPrice": 4.06,
        "minPrice": 3.90,
        "maxPrice": 4.25,
        "merchantCount": 2,
        "priceVariation": "8.97"
      }
    ]
  }
}
```

### 2. **💰 Comparación de Precios entre Tiendas**
```http
GET /api/analytics/products/{productId}/price-comparison?days=90
```

**Casos de uso:**
- Encontrar la tienda más barata para un producto
- Ver cuánto ahorrarías comprando en otro lugar
- Identificar las mejores ofertas

**Respuesta ejemplo:**
```json
{
  "status": "success",
  "data": {
    "merchants": [
      {
        "name": "Supermercado A",
        "purchaseCount": 6,
        "avgPrice": 3.95,
        "minPrice": 3.80,
        "maxPrice": 4.10,
        "totalSpent": 23.70,
        "savingsVsBest": "0.00",
        "isBestPrice": true
      },
      {
        "name": "Supermercado B",
        "avgPrice": 4.25,
        "savingsVsBest": "7.59",
        "isBestPrice": false
      }
    ]
  }
}
```

### 3. **🔮 Análisis de Frecuencia y Predicciones**
```http
GET /api/analytics/products/{productId}/frequency-analysis
```

**Casos de uso:**
- Saber cuándo necesitarás comprar el producto nuevamente
- Recibir alertas cuando se te esté acabando
- Planificar compras futuras

**Respuesta ejemplo:**
```json
{
  "status": "success",
  "data": {
    "product": {
      "name": "Leche Entera 1L"
    },
    "frequency": {
      "purchaseCount": 12,
      "avgDaysBetween": 8,
      "lastPurchase": "2024-09-20",
      "daysSinceLastPurchase": 8,
      "nextPurchasePrediction": "2024-09-28",
      "consumptionRate": 0.125,
      "isOverdue": false,
      "urgencyLevel": "low"
    },
    "statistics": {
      "totalSpent": 48.75,
      "avgQuantityPerPurchase": 1.0
    }
  }
}
```

### 4. **📈 Análisis de Gastos por Categoría**
```http
GET /api/analytics/spending-analysis?months=6
```

**Casos de uso:**
- Ver en qué categorías gastas más dinero
- Identificar tendencias de gasto mensuales
- Planificar presupuestos por categoría

**Respuesta ejemplo:**
```json
{
  "status": "success",
  "data": {
    "period": "6 months",
    "totalSpent": 1250.75,
    "categories": [
      {
        "category": "Alimentos",
        "totalSpent": 625.30,
        "percentage": "50.00",
        "itemCount": 156,
        "avgItemPrice": 4.01,
        "uniqueProducts": 45
      },
      {
        "category": "Limpieza",
        "totalSpent": 187.25,
        "percentage": "15.00",
        "itemCount": 23,
        "avgItemPrice": 8.14,
        "uniqueProducts": 12
      }
    ],
    "monthlyTrends": [
      {
        "month": "2024-04-01T00:00:00.000Z",
        "category": "Alimentos",
        "spent": 104.50
      }
    ]
  }
}
```

### 5. **🚨 Alertas Inteligentes**
```http
GET /api/analytics/smart-alerts
```

**Casos de uso:**
- Recibir alertas cuando los precios suben
- Saber cuándo se te está acabando un producto
- Detectar gastos excesivos en una categoría
- Encontrar oportunidades de ahorro

**Respuesta ejemplo:**
```json
{
  "status": "success",
  "data": {
    "alertCount": 4,
    "alerts": [
      {
        "type": "budget_exceeded",
        "severity": "high",
        "title": "Alerta de Presupuesto",
        "message": "El gasto en Alimentos está 25% por encima del promedio este mes",
        "data": {
          "category": "Alimentos",
          "current_month": 156.25,
          "avg_monthly": 125.00
        }
      },
      {
        "type": "running_low",
        "severity": "medium",
        "title": "Stock Bajo",
        "message": "No has comprado Leche Entera 1L en 12 días",
        "data": {
          "name": "Leche Entera 1L",
          "days_since_last": 12,
          "avg_days_between": 8
        }
      },
      {
        "type": "price_increase",
        "severity": "medium",
        "title": "Alerta de Precio",
        "message": "Pan Integral ha aumentado un 15% recientemente",
        "data": {
          "name": "Pan Integral",
          "recent_avg": 2.30,
          "historical_avg": 2.00
        }
      },
      {
        "type": "savings_opportunity",
        "severity": "low",
        "title": "Oportunidad de Ahorro",
        "message": "Podrías ahorrar 12% en Yogur Griego comprando en otro lugar en vez de Supermercado B",
        "data": {
          "name": "Yogur Griego",
          "merchant_name": "Supermercado B",
          "merchant_avg": 5.60,
          "overall_avg": 5.00
        }
      }
    ]
  }
}
```

### 6. **💡 Recomendaciones Personalizadas**
```http
GET /api/analytics/recommendations
```

**Casos de uso:**
- Descubrir productos que sueles comprar juntos
- Identificar tendencias estacionales
- Obtener sugerencias basadas en tus hábitos

**Respuesta ejemplo:**
```json
{
  "status": "success",
  "data": {
    "frequentlyBoughtTogether": [
      {
        "productA": "Leche Entera 1L",
        "productB": "Pan Integral",
        "frequency": 8,
        "recommendation": "Los clientes que compran Leche Entera 1L también compran Pan Integral"
      }
    ],
    "seasonalTrends": [
      {
        "product": "Helado",
        "category": "Alimentos",
        "month": 7,
        "frequency": 12,
        "recommendation": "Helado se compra frecuentemente en julio"
      }
    ]
  }
}
```

---

## 🔐 Autenticación

Todos los endpoints requieren autenticación:
```http
Authorization: Bearer <access_token>
```

---

## 🌍 Soporte Multiidioma

Los endpoints respetan el idioma del usuario:
- **Header**: `X-Locale: es` (español), `en` (inglés), `nl` (holandés)
- **Usuario autenticado**: Usa `preferredLanguage` del perfil
- **Default**: Inglés

---

## 📱 Casos de Uso en Flutter

### **Dashboard Principal**
```dart
// Obtener alertas para la pantalla principal
final alerts = await apiService.get('/analytics/smart-alerts');

// Mostrar notificaciones importantes
if (alerts.data.alertCount > 0) {
  showSmartAlerts(alerts.data.alerts);
}
```

### **Pantalla de Producto Individual**
```dart
// Mostrar estadísticas completas del producto
final productId = 'uuid-del-producto';

final monthlyStats = await apiService.get('/analytics/products/$productId/monthly-stats');
final priceComparison = await apiService.get('/analytics/products/$productId/price-comparison');
final frequency = await apiService.get('/analytics/products/$productId/frequency-analysis');

// Crear gráficos y visualizaciones
buildMonthlyChart(monthlyStats.data.monthlyStats);
buildPriceComparisonChart(priceComparison.data.merchants);
buildFrequencyIndicator(frequency.data.frequency);
```

### **Pantalla de Análisis de Gastos**
```dart
// Dashboard de gastos por categoría
final spendingAnalysis = await apiService.get('/analytics/spending-analysis?months=6');

buildCategoryPieChart(spendingAnalysis.data.categories);
buildMonthlyTrendsChart(spendingAnalysis.data.monthlyTrends);
```

### **Centro de Recomendaciones**
```dart
// Sugerencias personalizadas
final recommendations = await apiService.get('/analytics/recommendations');

buildRecommendationCards(recommendations.data.frequentlyBoughtTogether);
buildSeasonalSuggestions(recommendations.data.seasonalTrends);
```

---

## 🎨 Ideas de UI/UX

### **Cards de Alertas Inteligentes**
- 🔴 **Alta prioridad**: Presupuesto excedido
- 🟡 **Media prioridad**: Productos agotándose
- 🟢 **Baja prioridad**: Oportunidades de ahorro

### **Gráficos Recomendados**
- 📊 **Líneas**: Tendencias mensuales de precio
- 🥧 **Circular**: Distribución de gastos por categoría
- 📈 **Barras**: Comparación de precios entre tiendas
- 🎯 **Medidor**: Nivel de urgencia para recompra

### **Notificaciones Push**
- "🚨 Has gastado 25% más en Alimentos este mes"
- "🛒 Es hora de comprar Leche Entera 1L"
- "💰 Supermercado A tiene mejor precio en Pan Integral"

---

## ⚡ Características Avanzadas

### **Algoritmos Inteligentes**
- **Detección de anomalías**: Precios fuera de rango normal
- **Predicción de consumo**: Basada en histórico de compras
- **Análisis de tendencias**: Patrones estacionales automáticos
- **Optimización de gastos**: Sugerencias de ahorro personalizadas

### **Performance**
- **Consultas optimizadas**: Uso de índices y agregaciones SQL
- **Caching inteligente**: Resultados cacheados por período
- **Paginación**: Para datasets grandes
- **Rate limiting**: Protección contra abuso

¡Con estos endpoints, los usuarios tendrán insights súper valiosos para optimizar sus compras y ahorrar dinero! 🚀💰